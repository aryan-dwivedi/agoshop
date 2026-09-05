import type { LiveSessionDto } from '@shop/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { SAMPLE_HLS_FALLBACK_URL, simulatedHlsForSlug } from '@shop/shared';

import { agoraRestFetch } from './restFetch.js';
import { AGORA_REST_BASE, agoraBasicAuth } from './tokens.js';

const converterBase = () =>
    `${AGORA_REST_BASE}/${env.MEDIA_PUSH_REGION}/v1/projects/${env.AGORA_APP_ID}/rtmp-converters`;
type Json = Record<string, unknown>;
const call = async (
    method: 'POST' | 'GET' | 'DELETE',
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
        const response = await agoraRestFetch(converterBase() + suffix, {
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
        logger.error({ err, suffix }, 'media push request failed');
        return { ok: false, status: 0, json: null };
    }
};
const simulatedOriginCache = new Map<string, string>();
const simulatedOriginFor = (slug: string): string => {
    const cached = simulatedOriginCache.get(slug);
    if (cached !== undefined) return cached;
    const playlist = join(env.RECORDING_LOCAL_DIR, 'simulated-origin', slug, 'index.m3u8');
    const resolved = existsSync(playlist) ? simulatedHlsForSlug(slug) : SAMPLE_HLS_FALLBACK_URL;
    simulatedOriginCache.set(slug, resolved);
    return resolved;
};
export const hlsOrigin = (session: {
    slug: string;
    hlsUrl: string | null;
    hlsOriginKind: LiveSessionDto['hlsOriginKind'];
}): {
    hlsUrl: string;
    hlsOriginKind: 'media-push' | 'simulated-origin';
} => {
    if (env.MEDIA_PUSH_ENABLED && session.hlsOriginKind === 'media-push' && session.hlsUrl) {
        return { hlsUrl: session.hlsUrl, hlsOriginKind: 'media-push' };
    }
    return {
        hlsUrl: simulatedOriginFor(session.slug),
        hlsOriginKind: 'simulated-origin',
    };
};
export const hlsOriginReady = (session: { mediaPushStatus: string }): boolean =>
    env.MEDIA_PUSH_ENABLED ? session.mediaPushStatus === 'running' : true;
export const createConverter = async (session: {
    id: string;
    slug: string;
    rtcChannel: string;
}): Promise<void> => {
    if (!env.MEDIA_PUSH_ENABLED) return;
    const [existing] = await db
        .select({
            converterId: liveSessions.mediaPushConverterId,
            status: liveSessions.mediaPushStatus,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, session.id));
    if (existing?.converterId && existing.status === 'running') return;
    if (!env.MEDIA_PUSH_RTMP_URL || !env.MEDIA_PUSH_HLS_URL) {
        await db
            .update(liveSessions)
            .set({ mediaPushStatus: 'failed' })
            .where(eq(liveSessions.id, session.id));
        logger.warn(
            { sessionId: session.id },
            'media push enabled but MEDIA_PUSH_RTMP_URL/MEDIA_PUSH_HLS_URL are empty',
        );
        return;
    }
    await db
        .update(liveSessions)
        .set({ mediaPushStatus: 'connecting' })
        .where(eq(liveSessions.id, session.id));
    const rtmpUrl = `${env.MEDIA_PUSH_RTMP_URL.replace(/\/+$/, '')}/${session.slug}`;
    const created = await call('POST', '', {
        converter: {
            name: `live-${session.slug}`,
            rtcChannel: session.rtcChannel,
            transcodeOptions: {
                rtcChannel: session.rtcChannel,
                audioOptions: {
                    profile: 0,
                    sampleRate: 48000,
                    bitrate: 128,
                    channels: 2,
                },
                videoOptions: {
                    codec: 'H264',
                    width: 1280,
                    height: 720,
                    frameRate: 30,
                    bitrate: 1500,
                    lowLatency: false,
                    layoutType: 0,
                },
            },
            rtmpUrl,
            idleTimeout: 300,
        },
    });
    const converter = created.json?.['converter'] as Json | undefined;
    const converterId = converter?.['id'] ?? created.json?.['id'];
    if (!created.ok || typeof converterId !== 'string') {
        await db
            .update(liveSessions)
            .set({ mediaPushStatus: 'failed' })
            .where(eq(liveSessions.id, session.id));
        logger.warn(
            { sessionId: session.id, status: created.status, body: created.json },
            'media push converter creation failed',
        );
        throw new Error(`media_push_create_failed_${created.status}`);
    }
    await db
        .update(liveSessions)
        .set({
            mediaPushConverterId: converterId,
            mediaPushStatus: 'running',
            hlsUrl: `${env.MEDIA_PUSH_HLS_URL.replace(/\/+$/, '')}/${session.slug}.m3u8`,
            hlsOriginKind: 'media-push',
        })
        .where(eq(liveSessions.id, session.id));
    logger.info({ sessionId: session.id, converterId }, 'media push converter running');
};
export const getConverter = async (
    sessionId: string,
): Promise<{
    converterId: string;
    state: string;
} | null> => {
    const [row] = await db
        .select({ converterId: liveSessions.mediaPushConverterId })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.converterId) return null;
    const queried = await call('GET', `/${encodeURIComponent(row.converterId)}`);
    if (!queried.ok) return null;
    const converter = (queried.json?.['converter'] as Json | undefined) ?? queried.json ?? {};
    const state = converter['state'] ?? converter['status'];
    return {
        converterId: row.converterId,
        state: typeof state === 'string' ? state : 'UNKNOWN',
    };
};
export const deleteConverter = async (sessionId: string): Promise<void> => {
    const [row] = await db
        .select({
            converterId: liveSessions.mediaPushConverterId,
            status: liveSessions.mediaPushStatus,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.converterId || row.status === 'off') return;
    const deleted = await call('DELETE', `/${encodeURIComponent(row.converterId)}`);
    if (!deleted.ok && deleted.status !== 404) {
        throw new Error(`media_push_delete_failed_${deleted.status}`);
    }
    await db
        .update(liveSessions)
        .set({ mediaPushStatus: 'off', mediaPushConverterId: null })
        .where(eq(liveSessions.id, sessionId));
};
