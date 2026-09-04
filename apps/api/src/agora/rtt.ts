import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { AGORA_REST_BASE, agoraBasicAuth, mintRtcToken, nextAgoraUid } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';

/**
 * Agora Real-Time Speech-to-Text, **v7 only** — the v5/v6 `acquire` + `builderToken`
 * flow is deprecated with EOL 2026-06-11, so it is not implemented here at all.
 *
 * Captions are pushed INTO the RTC channel as stream messages by `pubBotUid`
 * (gzip'd JSON because `enableJsonProtocol: true`), not over RTM. Only the host client
 * can receive them — `client.sendStreamMessage` does not exist in web 4.24.8 and the
 * CDN tier cannot receive stream messages at all — which is why the host batches
 * finalized lines back to the API and the server re-publishes them as
 * `session.caption` over SSE so viewers in both tiers see captions.
 *
 * Needs only the App ID and the customer credentials this project already holds;
 * `captionConfig.storage` is optional and deliberately omitted.
 */

const BASE = `${AGORA_REST_BASE}/api/speech-to-text/v1/projects`;

/** Documented cap: at most four languages per task. */
const MAX_LANGUAGES = 4;

type Json = Record<string, unknown>;

const call = async (
  method: 'POST' | 'GET',
  suffix: string,
  body?: Json,
): Promise<{ ok: boolean; status: number; json: Json | null }> => {
  const auth = agoraBasicAuth();
  if (!auth) return { ok: false, status: 0, json: null };
  try {
    const response = await agoraRestFetch(`${BASE}/${env.AGORA_APP_ID}${suffix}`, {
      method,
      headers: {
        Authorization: auth,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json: Json | null = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as Json;
      } catch {
        json = { raw: text.slice(0, 512) };
      }
    }
    return { ok: response.ok, status: response.status, json };
  } catch (err) {
    logger.error({ err, suffix }, 'rtt request failed');
    return { ok: false, status: 0, json: null };
  }
};

/**
 * `translateConfig` maps every configured source language onto the configured targets.
 * With `TRANSCRIPTION_TRANSLATE_TARGETS` empty the field is omitted entirely rather
 * than sent as an empty object, which the API rejects.
 */
const translateConfig = (languages: string[]): Json | undefined => {
  const targets = env.TRANSCRIPTION_TRANSLATE_TARGETS;
  if (targets.length === 0) return undefined;
  return {
    languages: languages.map((source) => ({
      source,
      target: targets.filter((t) => t !== source),
    })),
  };
};

/**
 * Starts a caption task. Runs only on the request that won the `scheduled -> live`
 * transition, records its own `rttStatus`, and a failure here never touches the RTC
 * session or any other side service.
 */
export const startRtt = async (session: { id: string; rtcChannel: string }): Promise<void> => {
  if (env.TRANSCRIPTION_PROVIDER !== 'agora') return;

  const languages = env.TRANSCRIPTION_LANGUAGES.slice(0, MAX_LANGUAGES);
  if (languages.length === 0) {
    await db
      .update(liveSessions)
      .set({ rttStatus: 'failed' })
      .where(eq(liveSessions.id, session.id));
    logger.warn({ sessionId: session.id }, 'rtt start skipped — TRANSCRIPTION_LANGUAGES empty');
    return;
  }

  await db
    .update(liveSessions)
    .set({ rttStatus: 'connecting' })
    .where(eq(liveSessions.id, session.id));

  const pubBotUid = await nextAgoraUid();
  const translate = translateConfig(languages);
  const joined = await call('POST', '/join', {
    name: `rtt-${session.id}`,
    languages,
    maxIdleTime: 300,
    rtcConfig: {
      channelName: session.rtcChannel,
      pubBotUid: String(pubBotUid),
      pubBotToken: mintRtcToken(session.rtcChannel, pubBotUid, 'publisher'),
      // gzip'd JSON stream messages instead of Protobuf, so the host can inflate them
      // with DecompressionStream('gzip') and parse without a schema compiler.
      enableJsonProtocol: true,
    },
    ...(translate ? { translateConfig: translate } : {}),
  });

  // Verified against the live project with real credentials: v7 `/join` answers
  // `{agent_id, create_ts, status:"RUNNING"}`. It does NOT return `taskId`/`task_id`,
  // so reading only those recorded a spurious failure on a task that was RUNNING —
  // and leaked a worker against the 10 PCW quota because nothing stored its id.
  const taskId = joined.json?.['agent_id'] ?? joined.json?.['taskId'] ?? joined.json?.['task_id'];
  if (!joined.ok || typeof taskId !== 'string') {
    await db
      .update(liveSessions)
      .set({ rttStatus: 'failed' })
      .where(eq(liveSessions.id, session.id));
    logger.warn(
      { sessionId: session.id, status: joined.status, body: joined.json },
      'rtt join failed',
    );
    return;
  }

  await db
    .update(liveSessions)
    .set({ rttTaskId: taskId, rttStatus: 'running' })
    .where(eq(liveSessions.id, session.id));
  logger.info({ sessionId: session.id, taskId }, 'rtt task running');
};

/** Idempotent best-effort `leave`, run after the `live -> ended` DB transition. */
export const stopRtt = async (sessionId: string): Promise<void> => {
  const [row] = await db
    .select({ taskId: liveSessions.rttTaskId, status: liveSessions.rttStatus })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row?.taskId || row.status === 'off') return;

  // Verified live: `POST /agents/{agentId}/leave` returns 200. The older
  // `/leave?taskId=` form answers 404 "no Route matched with those values".
  await call('POST', `/agents/${encodeURIComponent(row.taskId)}/leave`, {});
  await db
    .update(liveSessions)
    .set({ rttStatus: 'off', rttTaskId: null })
    .where(eq(liveSessions.id, sessionId));
};

export const queryRtt = async (
  sessionId: string,
): Promise<{ taskId: string; status: string } | null> => {
  const [row] = await db
    .select({ taskId: liveSessions.rttTaskId })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row?.taskId) return null;
  // Verified live: `GET /agents/{agentId}` -> {agent_id, name, status, start_ts, stop_ts}.
  const queried = await call('GET', `/agents/${encodeURIComponent(row.taskId)}`);
  if (!queried.ok) return null;
  const status = queried.json?.['status'];
  return { taskId: row.taskId, status: typeof status === 'string' ? status : 'UNKNOWN' };
};
