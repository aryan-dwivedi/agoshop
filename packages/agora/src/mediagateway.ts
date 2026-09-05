import { and, eq, isNull } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';

import { requireMediaGateway, rtmpServerUrl } from './ingress.js';
import { agoraRestFetch } from './restFetch.js';
import { AGORA_REST_BASE, agoraBasicAuth, nextAgoraUid } from './tokens.js';

export { rtmpServerUrl };
export const assertMediaGatewayEnabled = (): void => requireMediaGateway(env.MEDIA_GATEWAY_ENABLED);
type Json = Record<string, unknown>;
const streamKeyBase = () =>
    `${AGORA_REST_BASE}/${env.MEDIA_GATEWAY_REGION}/v1/projects/${env.AGORA_APP_ID}/rtls/ingress/streamkeys`;
const revokeStoredStreamKey = async (sessionId: string): Promise<void> => {
    const streamKey = await redis.get(keys.obsStreamKey(sessionId));
    if (!streamKey) return;
    const revoked = await call('DELETE', `/${encodeURIComponent(streamKey)}`);
    if (!revoked.ok && revoked.status !== 404) {
        throw new Error(`media_gateway_revoke_failed_${revoked.status}`);
    }
    await redis.del(keys.obsStreamKey(sessionId));
};
const call = async (
    method: 'POST' | 'DELETE',
    suffix: string,
    body?: Json,
): Promise<{
    ok: boolean;
    status: number;
    json: Json | null;
}> => {
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
            signal: AbortSignal.timeout(15000),
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
export const revokeObsIngest = async (sessionId: string): Promise<void> => {
    await revokeStoredStreamKey(sessionId);
    await db
        .update(liveSessions)
        .set({ mediaGatewayStatus: 'off' })
        .where(eq(liveSessions.id, sessionId));
};
