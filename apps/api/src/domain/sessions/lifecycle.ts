import { and, eq, isNotNull, lte } from 'drizzle-orm';

import { EVENTS, MAX_CHAT_SHARDS } from '@shop/shared';

import { getCart } from '../cart.js';
import { revokeObsIngest } from '../../agora/mediagateway.js';
import { createConverter, deleteConverter } from '../../agora/mediapush.js';
import { startRecording, stopRecording } from '../../agora/recording.js';
import { startRtt, stopRtt } from '../../agora/rtt.js';
import { db } from '../../db/client.js';
import { cartItems, carts, liveSessions } from '../../db/schema.js';
import { env } from '../../env.js';
import { track } from '../../lib/analytics.js';
import { logger } from '../../lib/logger.js';
import { keys, redis } from '../../lib/redis.js';
import { publishToSession, publishToUser } from '../../lib/sse.js';
import { conflict, notFound } from '../../lib/errors.js';
import { getSessionById } from './queries.js';

export const frozenShardCount = (expectedPeakViewers: number): number =>
  Math.min(
    MAX_CHAT_SHARDS,
    Math.max(1, Math.ceil(expectedPeakViewers / env.RTM_CHAT_SHARD_TARGET)),
  );

const publishStatus = async (row: typeof liveSessions.$inferSelect): Promise<void> => {
  await publishToSession(row.id, EVENTS.sessionStatusChanged, {
    sessionId: row.id,
    slug: row.slug,
    status: row.status,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    chatShardCount: row.chatShardCount,
    deliveryTier: row.deliveryTier,
  });
};

export const startSession = async (
  sessionId: string,
  options: { consentAcknowledged?: boolean; actorUserId?: string } = {},
) => {
  const [current] = await db
    .select({
      status: liveSessions.status,
      expectedPeakViewers: liveSessions.expectedPeakViewers,
    })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!current) throw notFound('session_not_found');
  if (current.status === 'ended') throw conflict('session_already_ended');

  const shardCount = frozenShardCount(current.expectedPeakViewers);

  const won = await db
    .update(liveSessions)
    .set({
      status: 'live',
      startedAt: new Date(),
      chatShardCount: shardCount,
      deliveryTier: 'rtc',
      ...(options.consentAcknowledged ? { recordingConsentAt: new Date() } : {}),
    })
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.status, 'scheduled')))
    .returning();

  const winner = won[0];
  if (!winner) {
    const dto = await getSessionById(sessionId);
    if (!dto) throw notFound('session_not_found');
    if (dto.status !== 'live') throw conflict('session_not_startable');
    return { session: dto, transitioned: false };
  }

  await redis
    .pipeline()
    .set(keys.sessionStatus(sessionId), 'live')
    .set(keys.sessionTier(sessionId), 'rtc')
    .del(keys.sessionViewers(sessionId))
    .exec();

  await publishStatus(winner);
  track({ type: 'session_started', sessionId });
  if (options.consentAcknowledged) {
    track({ type: 'recording_consent', sessionId, userId: options.actorUserId ?? null });
  }

  const results = await Promise.allSettled([
    startRecording({ id: winner.id, rtcChannel: winner.rtcChannel }),
    startRtt({ id: winner.id, rtcChannel: winner.rtcChannel }),
    createConverter({ id: winner.id, slug: winner.slug, rtcChannel: winner.rtcChannel }),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason, sessionId }, 'session side service start failed');
    }
  }

  const dto = await getSessionById(sessionId);
  if (!dto) throw notFound('session_not_found');
  return { session: dto, transitioned: true };
};

export const endSession = async (sessionId: string) => {
  const won = await db
    .update(liveSessions)
    .set({ status: 'ended', endedAt: new Date() })
    .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.status, 'live')))
    .returning();

  const winner = won[0];
  if (!winner) {
    const dto = await getSessionById(sessionId);
    if (!dto) throw notFound('session_not_found');
    if (dto.status !== 'ended') throw conflict('session_not_live');
    return { session: dto, transitioned: false };
  }

  await redis
    .pipeline()
    .set(keys.sessionStatus(sessionId), 'ended')
    .del(keys.sessionViewers(sessionId))
    .exec();

  await publishStatus(winner);

  const holders = await db
    .selectDistinct({ userId: carts.userId })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(eq(cartItems.liveSessionId, sessionId));
  // Push the repriced cart so clients can update immediately without waiting on a refetch.
  await Promise.all(
    holders.map(async (h) => {
      const cart = await getCart(h.userId);
      await publishToUser(h.userId, EVENTS.cartUpdated, cart);
    }),
  );

  await redis.xadd(keys.summaryStream, '*', 'sessionId', sessionId);
  track({ type: 'session_ended', sessionId });

  const results = await Promise.allSettled([
    stopRecording(sessionId),
    stopRtt(sessionId),
    deleteConverter(sessionId),
    revokeObsIngest(sessionId),
  ]);
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.error({ err: result.reason, sessionId }, 'session side service cleanup failed');
    }
  }

  const dto = await getSessionById(sessionId);
  if (!dto) throw notFound('session_not_found');
  return { session: dto, transitioned: true };
};

export const startDuePremieres = async (): Promise<number> => {
  const due = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(
      and(
        eq(liveSessions.status, 'scheduled'),
        eq(liveSessions.autoStart, true),
        isNotNull(liveSessions.scheduledFor),
        lte(liveSessions.scheduledFor, new Date()),
      ),
    );
  if (due.length === 0) return 0;

  const results = await Promise.allSettled(due.map((row) => startSession(row.id)));
  let started = 0;
  results.forEach((result, index) => {
    const sessionId = due[index]?.id;
    if (result.status === 'rejected') {
      logger.error({ err: result.reason, sessionId }, 'premiere auto-start failed');
      return;
    }
    if (result.value.transitioned) {
      started += 1;
      logger.info({ sessionId }, 'premiere auto-started');
    }
  });
  return started;
};
