import { eq } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { EVENTS } from '@shop/shared';

import { agoraRestFetch } from './restFetch.js';
import { AGORA_REST_BASE, agoraBasicAuth, mintRtcToken, nextAgoraUid } from './tokens.js';

const BASE = `${AGORA_REST_BASE}/api/speech-to-text/v1/projects`;
const MAX_LANGUAGES = 4;
type RttStatus = 'off' | 'connecting' | 'running' | 'failed';
type Json = Record<string, unknown>;
const publishRttStatus = async (sessionId: string, rttStatus: RttStatus): Promise<void> => {
    await publishToSession(sessionId, EVENTS.sessionRttStatusChanged, {
        sessionId,
        rttStatus,
        captionsEnabled: rttStatus === 'connecting' || rttStatus === 'running',
    });
};
const call = async (
    method: 'POST' | 'GET',
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
        const response = await agoraRestFetch(`${BASE}/${env.AGORA_APP_ID}${suffix}`, {
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
        logger.error({ err, suffix }, 'rtt request failed');
        return { ok: false, status: 0, json: null };
    }
};
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
export const startRtt = async (session: { id: string; rtcChannel: string }): Promise<void> => {
    if (env.TRANSCRIPTION_PROVIDER !== 'agora') return;
    const [existing] = await db
        .select({ taskId: liveSessions.rttTaskId, status: liveSessions.rttStatus })
        .from(liveSessions)
        .where(eq(liveSessions.id, session.id));
    if (existing?.taskId && existing.status === 'running') return;
    const languages = env.TRANSCRIPTION_LANGUAGES.slice(0, MAX_LANGUAGES);
    if (languages.length === 0) {
        await db
            .update(liveSessions)
            .set({ rttStatus: 'failed' })
            .where(eq(liveSessions.id, session.id));
        await publishRttStatus(session.id, 'failed');
        logger.warn({ sessionId: session.id }, 'rtt start skipped — TRANSCRIPTION_LANGUAGES empty');
        return;
    }
    await db
        .update(liveSessions)
        .set({ rttStatus: 'connecting' })
        .where(eq(liveSessions.id, session.id));
    await publishRttStatus(session.id, 'connecting');
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
            enableJsonProtocol: true,
        },
        ...(translate ? { translateConfig: translate } : {}),
    });
    const taskId = joined.json?.['agent_id'] ?? joined.json?.['taskId'] ?? joined.json?.['task_id'];
    if (!joined.ok || typeof taskId !== 'string') {
        await db
            .update(liveSessions)
            .set({ rttStatus: 'failed' })
            .where(eq(liveSessions.id, session.id));
        await publishRttStatus(session.id, 'failed');
        logger.warn(
            { sessionId: session.id, status: joined.status, body: joined.json },
            'rtt join failed',
        );
        throw new Error(`rtt_join_failed_${joined.status}`);
    }
    await db
        .update(liveSessions)
        .set({ rttTaskId: taskId, rttStatus: 'running' })
        .where(eq(liveSessions.id, session.id));
    await publishRttStatus(session.id, 'running');
    logger.info({ sessionId: session.id, taskId }, 'rtt task running');
};
export const stopRtt = async (sessionId: string): Promise<void> => {
    const [row] = await db
        .select({ taskId: liveSessions.rttTaskId, status: liveSessions.rttStatus })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.taskId || row.status === 'off') return;
    const stopped = await call('POST', `/agents/${encodeURIComponent(row.taskId)}/leave`, {});
    if (!stopped.ok && stopped.status !== 404) {
        throw new Error(`rtt_leave_failed_${stopped.status}`);
    }
    await db
        .update(liveSessions)
        .set({ rttStatus: 'off', rttTaskId: null })
        .where(eq(liveSessions.id, sessionId));
    await publishRttStatus(sessionId, 'off');
};
export const queryRtt = async (
    sessionId: string,
): Promise<{
    taskId: string;
    status: string;
} | null> => {
    const [row] = await db
        .select({ taskId: liveSessions.rttTaskId })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row?.taskId) return null;
    const queried = await call('GET', `/agents/${encodeURIComponent(row.taskId)}`);
    if (!queried.ok) return null;
    const status = queried.json?.['status'];
    return {
        taskId: row.taskId,
        status: typeof status === 'string' ? status : 'UNKNOWN',
    };
};
