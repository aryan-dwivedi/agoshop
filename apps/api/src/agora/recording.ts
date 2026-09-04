import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { EVENTS } from '@shop/shared';
import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { env, isRecordingViaAgora } from '../env.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { publishToSession } from '../lib/sse.js';
import { AGORA_REST_BASE, agoraBasicAuth, mintRtcToken, nextAgoraUid } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';
const path = (suffix: string) => `${AGORA_REST_BASE}/v1/apps/${env.AGORA_APP_ID}/cloud_recording${suffix}`;
const recorderUidKey = (sessionId: string) => `session:${sessionId}:recorderUid`;
type Json = Record<string, unknown>;
const call = async (method: 'POST' | 'GET', suffix: string, body?: Json): Promise<{
    ok: boolean;
    status: number;
    json: Json | null;
}> => {
    const auth = agoraBasicAuth();
    if (!auth)
        return { ok: false, status: 0, json: null };
    try {
        const response = await agoraRestFetch(path(suffix), {
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
            }
            catch {
                json = { raw: text.slice(0, 512) };
            }
        }
        return { ok: response.ok, status: response.status, json };
    }
    catch (err) {
        logger.error({ err, suffix }, 'cloud recording request failed');
        return { ok: false, status: 0, json: null };
    }
};
const S3_COMPATIBLE_VENDOR = 11;
const storageConfig = (): Json => {
    const vendor = Number(env.RECORDING_STORAGE_VENDOR);
    const base = {
        vendor,
        bucket: env.RECORDING_STORAGE_BUCKET,
        accessKey: env.RECORDING_STORAGE_ACCESS_KEY,
        secretKey: env.RECORDING_STORAGE_SECRET_KEY,
        fileNamePrefix: ['live-commerce'],
    };
    if (vendor === S3_COMPATIBLE_VENDOR) {
        return {
            ...base,
            region: 0,
            extensionParams: {
                endpoint: env.RECORDING_STORAGE_ENDPOINT.replace(/^https?:\/\//, ''),
                region: env.RECORDING_STORAGE_REGION || 'us-east-1',
            },
        };
    }
    return { ...base, region: Number(env.RECORDING_STORAGE_REGION) };
};
const markFailed = async (sessionId: string, reason: string): Promise<void> => {
    await db
        .update(liveSessions)
        .set({ recordingStatus: 'failed', recordingError: reason, recordingProvider: 'agora' })
        .where(eq(liveSessions.id, sessionId));
    logger.warn({ sessionId, reason }, 'cloud recording marked failed');
};
export const startRecording = async (session: {
    id: string;
    rtcChannel: string;
}): Promise<void> => {
    if (!isRecordingViaAgora)
        return;
    const uid = String(await nextAgoraUid());
    await redis.set(recorderUidKey(session.id), uid, 'EX', 24 * 60 * 60);
    const acquired = await call('POST', '/acquire', {
        cname: session.rtcChannel,
        uid,
        clientRequest: { resourceExpiredHour: 24, scene: 0 },
    });
    const resourceId = acquired.json?.['resourceId'];
    if (!acquired.ok || typeof resourceId !== 'string') {
        await markFailed(session.id, `acquire_failed_${acquired.status}`);
        return;
    }
    const started = await call('POST', `/resourceid/${resourceId}/mode/mix/start`, {
        cname: session.rtcChannel,
        uid,
        clientRequest: {
            token: mintRtcToken(session.rtcChannel, Number(uid), 'subscriber'),
            recordingConfig: {
                channelType: 1,
                streamTypes: 2,
                videoStreamType: 0,
                maxIdleTime: 120,
                subscribeUidGroup: 0,
                transcodingConfig: {
                    width: 1280,
                    height: 720,
                    fps: 30,
                    bitrate: 2000,
                    mixedVideoLayout: 1,
                },
            },
            recordingFileConfig: { avFileType: ['hls', 'mp4'] },
            storageConfig: storageConfig(),
        },
    });
    const sid = started.json?.['sid'];
    if (!started.ok || typeof sid !== 'string') {
        await markFailed(session.id, `start_failed_${started.status}`);
        return;
    }
    await db
        .update(liveSessions)
        .set({
        recordingProvider: 'agora',
        recordingStatus: 'recording',
        recordingError: null,
        recordingResourceId: resourceId,
        recordingSid: sid,
    })
        .where(eq(liveSessions.id, session.id));
    logger.info({ sessionId: session.id, sid }, 'cloud recording started');
};
const fileListUrl = (json: Json | null): string | null => {
    const serverResponse = json?.['serverResponse'] as Json | undefined;
    const fileList = serverResponse?.['fileList'];
    const candidates = Array.isArray(fileList)
        ? fileList
        : typeof fileList === 'string'
            ? [{ fileName: fileList }]
            : [];
    for (const entry of candidates) {
        const name = (entry as Json | null)?.['fileName'];
        if (typeof name === 'string' && name.endsWith('.mp4'))
            return name;
    }
    const first = candidates[0] as Json | undefined;
    const firstName = first?.['fileName'];
    return typeof firstName === 'string' ? firstName : null;
};
export const stopRecording = async (sessionId: string): Promise<void> => {
    if (!isRecordingViaAgora)
        return;
    const [row] = await db
        .select({
        channel: liveSessions.rtcChannel,
        resourceId: liveSessions.recordingResourceId,
        sid: liveSessions.recordingSid,
        status: liveSessions.recordingStatus,
    })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.resourceId || !row.sid)
        return;
    if (row.status === 'ready' || row.status === 'failed')
        return;
    const uid = (await redis.get(recorderUidKey(sessionId))) ?? '0';
    const stopped = await call('POST', `/resourceid/${row.resourceId}/sid/${row.sid}/mode/mix/stop`, {
        cname: row.channel,
        uid,
        clientRequest: {},
    });
    if (!stopped.ok) {
        await db
            .update(liveSessions)
            .set({ recordingStatus: 'processing' })
            .where(eq(liveSessions.id, sessionId));
        return;
    }
    const file = fileListUrl(stopped.json);
    if (!file) {
        await db
            .update(liveSessions)
            .set({ recordingStatus: 'processing' })
            .where(eq(liveSessions.id, sessionId));
        return;
    }
    await db
        .update(liveSessions)
        .set({ recordingStatus: 'ready', recordingUrl: file, recordingError: null })
        .where(eq(liveSessions.id, sessionId));
    await publishToSession(sessionId, EVENTS.recordingReady, { sessionId, recordingUrl: file });
};
export const listPollableRecordingSessionIds = async (): Promise<string[]> => {
    if (!isRecordingViaAgora)
        return [];
    const rows = await db
        .select({ id: liveSessions.id })
        .from(liveSessions)
        .where(and(inArray(liveSessions.recordingStatus, ['recording', 'processing']), isNotNull(liveSessions.recordingSid)));
    return rows.map((r) => r.id);
};
export const pollRecording = async (sessionId: string): Promise<void> => {
    if (!isRecordingViaAgora)
        return;
    const [row] = await db
        .select({
        resourceId: liveSessions.recordingResourceId,
        sid: liveSessions.recordingSid,
        status: liveSessions.recordingStatus,
    })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.resourceId || !row.sid)
        return;
    if (row.status !== 'recording' && row.status !== 'processing')
        return;
    const queried = await call('GET', `/resourceid/${row.resourceId}/sid/${row.sid}/mode/mix/query`);
    if (queried.status === 404) {
        await markFailed(sessionId, 'query_404_check_storage_credentials');
        return;
    }
    if (!queried.ok)
        return;
    const file = fileListUrl(queried.json);
    if (!file)
        return;
    await db
        .update(liveSessions)
        .set({ recordingStatus: 'ready', recordingUrl: file, recordingError: null })
        .where(eq(liveSessions.id, sessionId));
    await publishToSession(sessionId, EVENTS.recordingReady, { sessionId, recordingUrl: file });
};
export const onRecordingWebhook = async (a: {
    sid: string;
    eventType: number;
    payload: Record<string, unknown>;
}): Promise<void> => {
    const [row] = await db
        .select({ id: liveSessions.id, status: liveSessions.recordingStatus })
        .from(liveSessions)
        .where(eq(liveSessions.recordingSid, a.sid));
    if (!row)
        return;
    if (row.status === 'ready')
        return;
    if (a.eventType === 31) {
        const details = a.payload['details'] as Record<string, unknown> | undefined;
        const fileName = details?.['fileName'];
        const url = typeof fileName === 'string' ? fileName : null;
        await db
            .update(liveSessions)
            .set({
            recordingStatus: url ? 'ready' : 'processing',
            ...(url ? { recordingUrl: url, recordingError: null } : {}),
        })
            .where(eq(liveSessions.id, row.id));
        if (url) {
            await publishToSession(row.id, EVENTS.recordingReady, {
                sessionId: row.id,
                recordingUrl: url,
            });
        }
        return;
    }
    if (a.eventType === 1) {
        await markFailed(row.id, 'ncs_recorder_error');
        return;
    }
    if (a.eventType === 11) {
        await db
            .update(liveSessions)
            .set({ recordingStatus: 'processing' })
            .where(eq(liveSessions.id, row.id));
    }
};
