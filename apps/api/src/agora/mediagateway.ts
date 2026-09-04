import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { keys, redis } from '../lib/redis.js';
import { nextAgoraUid } from './tokens.js';
import { AGORA_REST_BASE, agoraBasicAuth } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';
import { requireMediaGateway, rtmpServerUrl } from './ingress.js';

/**
 * Agora Media Gateway — RTMP/SRT ingress into an RTC channel (OBS-grade publishers).
 * The application mints streaming keys server-side and binds each to a channel + fixed
 * numeric uid; Agora ingests the push and publishes as that host in the channel.
 */

export { rtmpServerUrl };

export const assertMediaGatewayEnabled = (): void =>
  requireMediaGateway(env.MEDIA_GATEWAY_ENABLED);

type Json = Record<string, unknown>;

const streamKeyBase = () =>
  `${AGORA_REST_BASE}/${env.MEDIA_GATEWAY_REGION}/v1/projects/${env.AGORA_APP_ID}/rtls/ingress/streamkeys`;

const revokeStoredStreamKey = async (sessionId: string): Promise<void> => {
  const streamKey = await redis.get(keys.obsStreamKey(sessionId));
  if (!streamKey) return;
  await call('DELETE', `/${encodeURIComponent(streamKey)}`);
  await redis.del(keys.obsStreamKey(sessionId));
};

const call = async (
  method: 'POST' | 'DELETE',
  suffix: string,
  body?: Json,
): Promise<{ ok: boolean; status: number; json: Json | null }> => {
  const auth = agoraBasicAuth();
  if (!auth) return { ok: false, status: 0, json: null };
  try {
    const response = await agoraRestFetch(streamKeyBase() + suffix, {
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
    logger.error({ err, suffix }, 'media gateway request failed');
    return { ok: false, status: 0, json: null };
  }
};

export type ObsIngestCredentials = {
  rtmpServer: string;
  streamKey: string;
  uid: number;
  channel: string;
  expiresAfter: number;
};

/** Ensures the session row has a stable gateway uid allocated once. */
export const ensureGatewayUid = async (sessionId: string): Promise<number> => {
  const [row] = await db
    .select({ uid: liveSessions.mediaGatewayUid })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row) throw new Error('session_not_found');
  if (row.uid !== null) return row.uid;

  const uid = await nextAgoraUid();
  const claimed = await db
    .update(liveSessions)
    .set({ mediaGatewayUid: uid })
    .where(and(eq(liveSessions.id, sessionId), isNull(liveSessions.mediaGatewayUid)))
    .returning({ uid: liveSessions.mediaGatewayUid });
  if (claimed.length > 0 && claimed[0]!.uid !== null) return claimed[0]!.uid;

  const [winner] = await db
    .select({ uid: liveSessions.mediaGatewayUid })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!winner || winner.uid === null) throw new Error('gateway_uid_alloc_failed');
  return winner.uid;
};

/**
 * Creates (or refreshes) a streaming key for OBS ingest. The raw key is stored in
 * Redis only for best-effort revocation on session end — never written to Postgres.
 */
export const mintObsIngest = async (session: {
  id: string;
  rtcChannel: string;
}): Promise<ObsIngestCredentials> => {
  assertMediaGatewayEnabled();

  const uid = await ensureGatewayUid(session.id);
  const expiresAfter = env.MEDIA_GATEWAY_KEY_TTL_SECONDS;

  await revokeStoredStreamKey(session.id);

  const created = await call('POST', '', {
    settings: {
      channel: session.rtcChannel,
      uid: String(uid),
      expiresAfter,
    },
  });

  const data = created.json?.['data'] as Json | undefined;
  const streamKey = data?.['streamKey'];
  if (!created.ok || typeof streamKey !== 'string') {
    await db
      .update(liveSessions)
      .set({ mediaGatewayStatus: 'failed' })
      .where(eq(liveSessions.id, session.id));
    logger.warn(
      { sessionId: session.id, status: created.status, body: created.json },
      'media gateway stream key creation failed',
    );
    throw new Error('media_gateway_key_failed');
  }

  await redis.set(keys.obsStreamKey(session.id), streamKey, 'EX', expiresAfter);
  await db
    .update(liveSessions)
    .set({ mediaGatewayStatus: 'running' })
    .where(eq(liveSessions.id, session.id));

  return {
    rtmpServer: rtmpServerUrl(env.MEDIA_GATEWAY_REGION),
    streamKey,
    uid,
    channel: session.rtcChannel,
    expiresAfter,
  };
};

/** Idempotent best-effort revoke, run after the `live -> ended` DB transition. */
export const revokeObsIngest = async (sessionId: string): Promise<void> => {
  await revokeStoredStreamKey(sessionId);
  await db
    .update(liveSessions)
    .set({ mediaGatewayStatus: 'off' })
    .where(eq(liveSessions.id, sessionId));
};
