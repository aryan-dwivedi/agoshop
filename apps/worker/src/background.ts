import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';

import { expiredLeases, syncSlotGauge } from '@shop/api/ai/admission.js';
import { stopConversation } from '@shop/api/ai/conversations.js';
import { getProvider } from '@shop/api/ai/providers/index.js';
import { listPollableRecordingSessionIds, pollRecording } from '@shop/api/agora/recording.js';
import { startRtt } from '@shop/api/agora/rtt.js';
import { db, pool } from '@shop/db';
import {
  aiConversations,
  analyticsEvents,
  liveSessions,
  products,
  sessionTranscripts,
  users,
} from '@shop/db/schema';
import { flushOpenPolls } from '@shop/api/domain/polls.js';
import { flushReactions } from '@shop/api/domain/reactions.js';
import {
  flushViewers,
  listLiveSessionIds,
  startDuePremieres,
  viewerCount,
} from '@shop/api/domain/sessions.js';
import { captureOrder, expireStaleOrders } from '@shop/api/domain/ordersAsync.js';
import { getProductById } from '@shop/api/domain/catalog.js';
import { indexCatalogProduct } from '@shop/api/domain/searchBridge.js';
import { env } from '@shop/api/env.js';
import { track } from '@shop/api/lib/analytics.js';
import { logger } from '@shop/api/lib/logger.js';
import { analyticsStreamBacklog, searchIndexFailuresTotal } from '@shop/api/lib/metrics.js';
import { deleteRecordingObject, keyFromUrl } from '@shop/api/lib/objectStore.js';
import { closeRedis, keys, redis } from '@shop/api/lib/redis.js';

import {
  getIsLeader,
  releaseLeaderLock,
  startLeaderElection,
  tryAcquireOrRenewLeader,
} from './leader.js';

/**
 * Horizontally scalable worker process: stream consumers partition across replicas
 * via dedicated consumer groups, while singleton timers (aggregates, sampling, sweeps,
 * retention) run only on the Redis-elected leader (`worker:leader`, 30 s TTL).
 */

const GROUP_ANALYTICS = 'analytics';
const GROUP_CAPTURE = 'capture';
const GROUP_SEARCH = 'search-index';
const GROUP_SUMMARIES = 'session-summaries';

const CONSUMER = `worker-${process.pid}`;
const AGGREGATE_INTERVAL_MS = 1_000;
const VIEWER_SAMPLE_INTERVAL_MS = 60_000;
const SWEEP_INTERVAL_MS = 30_000;
const RECORDING_POLL_INTERVAL_MS = 30_000;
const PREMIERE_INTERVAL_MS = 5_000;
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SUMMARY_BATCH = 4;

let stopping = false;
let leaderElection: { stop: () => void } | null = null;

const ensureGroup = async (stream: string, group: string): Promise<void> => {
  try {
    await redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
  } catch (err) {
    if (!(err as Error).message.includes('BUSYGROUP')) throw err;
  }
};

type StreamEntry = [id: string, fields: string[]];

const fieldsToRecord = (fields: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) out[fields[i]!] = fields[i + 1]!;
  return out;
};

const readBatch = async (stream: string, group: string, count: number): Promise<StreamEntry[]> => {
  try {
    const claimed = (await redis.xautoclaim(
      stream,
      group,
      CONSUMER,
      60_000,
      '0',
      'COUNT',
      count,
    )) as [string, StreamEntry[], string[]];
    const pending = claimed?.[1] ?? [];
    if (pending.length >= count) return pending;

    const fresh = (await redis.xreadgroup(
      'GROUP',
      group,
      CONSUMER,
      'COUNT',
      count - pending.length,
      'STREAMS',
      stream,
      '>',
    )) as [string, StreamEntry[]][] | null;

    return [...pending, ...(fresh?.[0]?.[1] ?? [])];
  } catch (err) {
    if (!(err as Error).message.includes('NOGROUP')) throw err;
    await ensureGroup(stream, group);
    return [];
  }
};

type AnalyticsRow = {
  occurredAt: Date;
  userId: string | null;
  sessionId: string | null;
  productId: string | null;
  type: string;
  payload: Record<string, unknown>;
};

const resolveRefs = async (rows: AnalyticsRow[]): Promise<AnalyticsRow[]> => {
  const userIds = [...new Set(rows.map((r) => r.userId).filter((id) => id !== null))];
  const sessionIds = [...new Set(rows.map((r) => r.sessionId).filter((id) => id !== null))];
  const productIds = [...new Set(rows.map((r) => r.productId).filter((id) => id !== null))];

  const [userRows, sessionRows, productRows] = await Promise.all([
    userIds.length === 0
      ? []
      : db.select({ id: users.id }).from(users).where(inArray(users.id, userIds)),
    sessionIds.length === 0
      ? []
      : db
          .select({ id: liveSessions.id })
          .from(liveSessions)
          .where(inArray(liveSessions.id, sessionIds)),
    productIds.length === 0
      ? []
      : db.select({ id: products.id }).from(products).where(inArray(products.id, productIds)),
  ]);

  const liveUsers = new Set(userRows.map((r) => r.id));
  const liveSessionIds = new Set(sessionRows.map((r) => r.id));
  const liveProducts = new Set(productRows.map((r) => r.id));

  let orphaned = 0;
  const resolved = rows.map((row) => {
    const missing: Record<string, string> = {};
    if (row.userId !== null && !liveUsers.has(row.userId)) missing.userId = row.userId;
    if (row.sessionId !== null && !liveSessionIds.has(row.sessionId))
      missing.sessionId = row.sessionId;
    if (row.productId !== null && !liveProducts.has(row.productId))
      missing.productId = row.productId;
    if (Object.keys(missing).length === 0) return row;
    orphaned += 1;
    return {
      ...row,
      userId: 'userId' in missing ? null : row.userId,
      sessionId: 'sessionId' in missing ? null : row.sessionId,
      productId: 'productId' in missing ? null : row.productId,
      payload: { ...row.payload, orphanedRefs: missing },
    };
  });

  if (orphaned > 0) {
    logger.warn({ orphaned, batch: rows.length }, 'analytics rows kept with unresolved references');
  }
  return resolved;
};

export const drainAnalyticsOnce = async (): Promise<number> => {
  const entries = await readBatch(keys.analyticsStream, GROUP_ANALYTICS, env.ANALYTICS_DRAIN_BATCH);
  if (entries.length === 0) {
    analyticsStreamBacklog.set(await redis.xlen(keys.analyticsStream));
    return 0;
  }

  const rows = entries.map(([, fields]): AnalyticsRow => {
    const record = fieldsToRecord(fields);
    let payload: Record<string, unknown> = {};
    try {
      payload = record.payload ? (JSON.parse(record.payload) as Record<string, unknown>) : {};
    } catch {
      payload = { raw: record.payload ?? null };
    }
    return {
      occurredAt: record.occurredAt ? new Date(record.occurredAt) : new Date(),
      userId: record.userId || null,
      sessionId: record.sessionId || null,
      productId: record.productId || null,
      type: record.type ?? 'unknown',
      payload,
    };
  });

  await db.insert(analyticsEvents).values(await resolveRefs(rows));
  const ids = entries.map(([id]) => id);
  await redis.xack(keys.analyticsStream, GROUP_ANALYTICS, ...ids);
  await redis.xdel(keys.analyticsStream, ...ids);
  analyticsStreamBacklog.set(await redis.xlen(keys.analyticsStream));
  return rows.length;
};

export const summarizeSession = async (sessionId: string): Promise<string | null> => {
  const lines = await db
    .select({ speaker: sessionTranscripts.speaker, text: sessionTranscripts.text })
    .from(sessionTranscripts)
    .where(eq(sessionTranscripts.sessionId, sessionId))
    .orderBy(sessionTranscripts.startMs)
    .limit(400);
  if (lines.length === 0) return null;

  const [session] = await db
    .select({ title: liveSessions.title })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!session) return null;

  const transcript = lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
  const provider = getProvider();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let summary = '';
  try {
    for await (const chunk of provider.streamChat({
      model: env.LLM_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You summarise live-shopping sessions for a replay page. Write one paragraph of at most 120 words: which products were shown, the prices and key specs mentioned, any offer that was stated, and what the host committed to. Plain prose, no bullet points, no preamble.',
        },
        { role: 'user', content: `Session: ${session.title}\n\nTranscript:\n${transcript}` },
      ],
      signal: controller.signal,
    })) {
      if (chunk.contentDelta) summary += chunk.contentDelta;
    }
  } finally {
    clearTimeout(timeout);
  }

  const text = summary.trim();
  if (text.length === 0) return null;
  await db
    .update(liveSessions)
    .set({ transcriptSummary: text })
    .where(eq(liveSessions.id, sessionId));
  return text;
};

const consumeSummariesOnce = async (): Promise<number> => {
  const entries = await readBatch(keys.summaryStream, GROUP_SUMMARIES, SUMMARY_BATCH);
  let done = 0;
  for (const [id, fields] of entries) {
    const record = fieldsToRecord(fields);
    const sessionId = record.sessionId ?? '';
    try {
      if (sessionId) {
        const summary = await summarizeSession(sessionId);
        logger.info(
          { sessionId, summarized: summary !== null },
          summary === null
            ? 'session summary skipped (no transcript rows)'
            : 'session summary written',
        );
      }
      await redis.xack(keys.summaryStream, GROUP_SUMMARIES, id);
      await redis.xdel(keys.summaryStream, id);
      done += 1;
    } catch (err) {
      logger.error({ err, sessionId }, 'session summary failed; leaving entry pending for retry');
    }
  }
  return done;
};

const consumeOrderCaptureOnce = async (): Promise<number> => {
  const entries = await readBatch(keys.orderCaptureStream, GROUP_CAPTURE, 8);
  let done = 0;
  for (const [id, fields] of entries) {
    const record = fieldsToRecord(fields);
    const orderId = record.orderId ?? '';
    try {
      if (orderId) await captureOrder(orderId);
      await redis.xack(keys.orderCaptureStream, GROUP_CAPTURE, id);
      await redis.xdel(keys.orderCaptureStream, id);
      done += 1;
    } catch (err) {
      logger.error({ err, orderId }, 'order capture failed; leaving entry pending for retry');
    }
  }
  return done;
};

const consumeSearchIndexOnce = async (): Promise<number> => {
  const entries = await readBatch(keys.searchIndexStream, GROUP_SEARCH, 8);
  let done = 0;
  for (const [id, fields] of entries) {
    const record = fieldsToRecord(fields);
    const productId = record.productId ?? '';
    try {
      if (productId) {
        const product = await getProductById(productId);
        if (product) {
          try {
            await indexCatalogProduct(product);
          } catch (indexErr) {
            searchIndexFailuresTotal.inc();
            throw indexErr;
          }
        }
      }
      await redis.xack(keys.searchIndexStream, GROUP_SEARCH, id);
      await redis.xdel(keys.searchIndexStream, id);
      done += 1;
    } catch (err) {
      logger.error({ err, productId }, 'search index failed; leaving entry pending for retry');
    }
  }
  return done;
};

const flushAggregatesOnce = async (): Promise<void> => {
  const sessionIds = await listLiveSessionIds();
  await Promise.allSettled([
    ...sessionIds.map((id) => flushReactions(id)),
    ...sessionIds.map((id) => flushViewers(id)),
    flushOpenPolls(),
  ]);
};

const sampleViewersOnce = async (): Promise<void> => {
  const sessionIds = await listLiveSessionIds();
  for (const sessionId of sessionIds) {
    const viewers = await viewerCount(sessionId);
    track({ type: 'viewer_sample', sessionId, payload: { viewers } });
  }
};

export const sweepLeasesOnce = async (): Promise<number> => {
  const fromLeases = await expiredLeases();

  const stale = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        inArray(aiConversations.status, ['created', 'running']),
        lt(aiConversations.callbackExpiresAt, new Date()),
      ),
    )
    .limit(200);

  const ids = [...new Set([...fromLeases, ...stale.map((r) => r.id)])];
  for (const id of ids) {
    try {
      await stopConversation(id, { status: 'stopped', reason: 'lease_expired' });
    } catch (err) {
      logger.warn({ err, conversationId: id }, 'lease sweep could not stop conversation');
    }
  }
  await syncSlotGauge();
  if (ids.length > 0) logger.info({ swept: ids.length }, 'convoai leases swept');
  return ids.length;
};

const pollRecordingsOnce = async (): Promise<void> => {
  const sessionIds = await listPollableRecordingSessionIds();
  for (const sessionId of sessionIds) {
    try {
      await pollRecording(sessionId);
    } catch (err) {
      logger.warn({ err, sessionId }, 'recording query failed');
    }
  }
};

export const startDuePremieresOnce = async (): Promise<number> => {
  const started = await startDuePremieres();
  if (started > 0) logger.info({ started }, 'premieres auto-started');
  return started;
};

export const runRetentionPurge = async (): Promise<{
  transcripts: number;
  recordings: number;
  analytics: number;
}> => {
  const cutoff = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1_000);

  const transcripts = await db
    .delete(sessionTranscripts)
    .where(lt(sessionTranscripts.createdAt, cutoff(env.TRANSCRIPT_RETENTION_DAYS)))
    .returning({ id: sessionTranscripts.id });

  const expiredRecordings = await db
    .select({ id: liveSessions.id, recordingUrl: liveSessions.recordingUrl })
    .from(liveSessions)
    .where(
      and(
        isNotNull(liveSessions.recordingUrl),
        isNotNull(liveSessions.endedAt),
        lt(liveSessions.endedAt, cutoff(env.RECORDING_RETENTION_DAYS)),
      ),
    );

  for (const row of expiredRecordings) {
    if (env.RECORDING_LOCAL_FILE_PURGE) {
      const url = row.recordingUrl ?? '';
      if (!url.startsWith('/media/recordings/')) {
        const key = keyFromUrl(url);
        if (key) await deleteRecordingObject(key);
      } else {
        const name = basename(url);
        if (name && name.includes('.')) {
          try {
            await unlink(join(env.RECORDING_LOCAL_DIR, name));
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              logger.warn({ err, sessionId: row.id, name }, 'recording file unlink failed');
            }
          }
        }
      }
    }
    await db
      .update(liveSessions)
      .set({
        recordingUrl: null,
        recordingStatus: 'none',
        recordingSid: null,
        recordingResourceId: null,
      })
      .where(eq(liveSessions.id, row.id));
  }

  const analytics = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.occurredAt, cutoff(env.ANALYTICS_RETENTION_DAYS)))
    .returning({ id: analyticsEvents.id });

  const result = {
    transcripts: transcripts.length,
    recordings: expiredRecordings.length,
    analytics: analytics.length,
  };
  logger.info(result, 'retention purge complete');
  return result;
};

export const resumeLiveRttOnce = async (): Promise<number> => {
  if (env.TRANSCRIPTION_PROVIDER !== 'agora') return 0;
  const rows = await db
    .select({ id: liveSessions.id, rtcChannel: liveSessions.rtcChannel })
    .from(liveSessions)
    .where(
      and(eq(liveSessions.status, 'live'), inArray(liveSessions.rttStatus, ['off', 'failed'])),
    );
  for (const row of rows) await startRtt(row);
  return rows.length;
};

const loop = (name: string, intervalMs: number, body: () => Promise<unknown>): void => {
  const tick = async (): Promise<void> => {
    if (stopping) return;
    try {
      await body();
    } catch (err) {
      logger.error({ err, loop: name }, 'background loop iteration failed');
    }
    if (!stopping) setTimeout(() => void tick(), intervalMs).unref();
  };
  void tick();
};

/** Runs the body only while this replica holds the leader lock. */
const leaderLoop = (name: string, intervalMs: number, body: () => Promise<unknown>): void => {
  loop(name, intervalMs, async () => {
    if (!getIsLeader()) return;
    await body();
  });
};

export const startBackground = async (): Promise<void> => {
  await ensureGroup(keys.analyticsStream, GROUP_ANALYTICS);
  await ensureGroup(keys.summaryStream, GROUP_SUMMARIES);
  await ensureGroup(keys.orderCaptureStream, GROUP_CAPTURE);
  await ensureGroup(keys.searchIndexStream, GROUP_SEARCH);

  await tryAcquireOrRenewLeader();
  leaderElection = startLeaderElection((next) => {
    logger.info({ leader: next }, next ? 'became worker leader' : 'relinquished worker leadership');
  });

  if (getIsLeader()) await resumeLiveRttOnce();

  logger.info(
    {
      consumer: CONSUMER,
      drainBatch: env.ANALYTICS_DRAIN_BATCH,
      drainIntervalMs: env.ANALYTICS_DRAIN_INTERVAL_MS,
      groups: {
        analytics: GROUP_ANALYTICS,
        capture: GROUP_CAPTURE,
        search: GROUP_SEARCH,
        summaries: GROUP_SUMMARIES,
      },
      provider: env.LLM_PROVIDER,
      retentionDays: {
        transcripts: env.TRANSCRIPT_RETENTION_DAYS,
        recordings: env.RECORDING_RETENTION_DAYS,
        analytics: env.ANALYTICS_RETENTION_DAYS,
      },
    },
    'worker started — stream consumers on every replica, singleton loops on leader',
  );

  loop('analytics-drain', env.ANALYTICS_DRAIN_INTERVAL_MS, drainAnalyticsOnce);
  leaderLoop('aggregates', AGGREGATE_INTERVAL_MS, flushAggregatesOnce);
  leaderLoop('viewer-sample', VIEWER_SAMPLE_INTERVAL_MS, sampleViewersOnce);
  loop('session-summaries', 2_000, consumeSummariesOnce);
  loop('order-capture', 500, consumeOrderCaptureOnce);
  loop('search-index', 2_000, consumeSearchIndexOnce);
  leaderLoop('reservation-expiry', 30_000, expireStaleOrders);
  leaderLoop('lease-sweep', SWEEP_INTERVAL_MS, sweepLeasesOnce);
  leaderLoop('recording-poll', RECORDING_POLL_INTERVAL_MS, pollRecordingsOnce);
  leaderLoop('premiere-start', PREMIERE_INTERVAL_MS, startDuePremieresOnce);
  leaderLoop('retention', RETENTION_INTERVAL_MS, runRetentionPurge);
};

export const stopBackground = async (signal: string): Promise<void> => {
  stopping = true;
  leaderElection?.stop();
  await releaseLeaderLock();
  logger.info({ signal }, 'worker shutting down');
  await closeRedis();
  await pool.end();
};
