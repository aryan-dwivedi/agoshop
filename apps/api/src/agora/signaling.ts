import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { chatRestPublishesTotal } from '../lib/metrics.js';
import { AGORA_REST_BASE, agoraBasicAuth } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';
export const SIGNALING_CHANNEL_MESSAGE_PATH = '/dev/v2/project/{appId}/rtm/users/{account}/channel_messages';
const PUBLISH_BUDGET_PER_SECOND = 500;
const FANOUT_BATCH = 25;
export type PublishTransport = 'rtm-rest' | 'none';
export type PublishOutcome = {
    ok: boolean;
    transport: PublishTransport;
    channels: string[];
    reason?: string;
};
const publishOne = async (url: string, auth: string, channel: string, payload: unknown): Promise<{
    ok: boolean;
    reason?: string;
}> => {
    try {
        const response = await agoraRestFetch(url, {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                destination: channel,
                enable_offline_messaging: false,
                enable_historical_messaging: false,
                payload: JSON.stringify(payload),
            }),
            signal: AbortSignal.timeout(5000),
        });
        chatRestPublishesTotal.inc();
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            logger.warn({ channel, status: response.status, body: body.slice(0, 512) }, 'signaling rest publish rejected');
            return { ok: false, reason: `signaling_http_${response.status}` };
        }
        return { ok: true };
    }
    catch (err) {
        logger.warn({ err, channel }, 'signaling rest publish failed');
        return { ok: false, reason: 'signaling_unreachable' };
    }
};
export const publishAsChatService = async (channel: string, payload: unknown): Promise<PublishOutcome> => publishToShards([channel], payload);
export const publishToShards = async (channels: string[], payload: unknown): Promise<PublishOutcome> => {
    if (channels.length === 0)
        return { ok: true, transport: 'rtm-rest', channels };
    const auth = agoraBasicAuth();
    if (!auth) {
        logger.warn({ channels: channels.length, appId: env.AGORA_APP_ID }, 'signaling rest publish unavailable — AGORA_CUSTOMER_ID/AGORA_CUSTOMER_SECRET absent');
        return {
            ok: false,
            transport: 'none',
            channels,
            reason: 'signaling_credentials_absent',
        };
    }
    const url = AGORA_REST_BASE +
        SIGNALING_CHANNEL_MESSAGE_PATH.replace('{appId}', env.AGORA_APP_ID).replace('{account}', encodeURIComponent(env.CHAT_SERVICE_RTM_USER));
    const minWaveMs = (FANOUT_BATCH / PUBLISH_BUDGET_PER_SECOND) * 1000;
    let reason: string | undefined;
    for (let offset = 0; offset < channels.length; offset += FANOUT_BATCH) {
        const wave = channels.slice(offset, offset + FANOUT_BATCH);
        const startedAt = Date.now();
        const results = await Promise.all(wave.map((channel) => publishOne(url, auth, channel, payload)));
        for (const result of results)
            if (!result.ok && !reason)
                reason = result.reason;
        if (offset + FANOUT_BATCH < channels.length) {
            const elapsed = Date.now() - startedAt;
            if (elapsed < minWaveMs) {
                await new Promise<void>((resolve) => setTimeout(resolve, minWaveMs - elapsed));
            }
        }
    }
    return reason
        ? { ok: false, transport: 'rtm-rest', channels, reason }
        : { ok: true, transport: 'rtm-rest', channels };
};
