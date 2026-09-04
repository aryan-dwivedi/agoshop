import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { chatRestPublishesTotal } from '../lib/metrics.js';
import { AGORA_REST_BASE, agoraBasicAuth } from './tokens.js';
import { agoraRestFetch } from './restFetch.js';

/**
 * Signaling (RTM) REST messaging — the publish path for server-authored chat
 * (decision 11). Viewers never publish to RTM; the backend publishes every accepted
 * message as the fixed account `CHAT_SERVICE_RTM_USER`, which is what makes the
 * client's publisher-identity check an actual authorization boundary.
 *
 * THE ROUTE BELOW IS THE DOCUMENTED SHAPE AND IS CONFIRMED BY SMOKE CHECK S5.
 * S5 publishes one envelope with the real App ID and customer credentials and asserts
 * the browser receives it with publisher `chat-service`. Until S5 runs, this one
 * constant is the only thing that would change; nothing else in the design depends on
 * the path, only on the documented property that a server can publish to a message
 * channel as a fixed account under Basic customer auth.
 *
 * `{appId}` and `{account}` are substituted; `{account}` is the publishing identity.
 */
export const SIGNALING_CHANNEL_MESSAGE_PATH =
  '/dev/v2/project/{appId}/rtm/users/{account}/channel_messages';

/**
 * Documented default: 500 REST req/s per App ID, counting peer + channel messages
 * together. Host fan-out is paced under it here rather than at the call site, so no
 * caller can accidentally burst a 49-shard session past the budget. The RTM SDK's
 * 20 calls/s ceiling is a *client* limit and does not constrain this server path.
 */
const PUBLISH_BUDGET_PER_SECOND = 500;
/** Concurrency per wave. 25 in flight keeps p99 low without starving the event loop. */
const FANOUT_BATCH = 25;

export type PublishTransport = 'rtm-rest' | 'none';

export type PublishOutcome = {
  ok: boolean;
  transport: PublishTransport;
  channels: string[];
  /** Present only when `ok` is false: why the REST publish did not happen. */
  reason?: string;
};

/**
 * One REST publish. Never throws: a Signaling outage must not fail a chat request
 * whose message is already persisted and already authoritative. The caller decides
 * how to degrade and reports which transport actually carried the envelope.
 */
const publishOne = async (
  url: string,
  auth: string,
  channel: string,
  payload: unknown,
): Promise<{ ok: boolean; reason?: string }> => {
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
      signal: AbortSignal.timeout(5_000),
    });
    chatRestPublishesTotal.inc();
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      logger.warn(
        { channel, status: response.status, body: body.slice(0, 512) },
        'signaling rest publish rejected',
      );
      return { ok: false, reason: `signaling_http_${response.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err, channel }, 'signaling rest publish failed');
    return { ok: false, reason: 'signaling_unreachable' };
  }
};

/** Publish one envelope to one shard channel as `CHAT_SERVICE_RTM_USER`. */
export const publishAsChatService = async (
  channel: string,
  payload: unknown,
): Promise<PublishOutcome> => publishToShards([channel], payload);

/**
 * Fan one envelope out to every shard of a session in bounded, paced waves.
 * A 49-shard host message is 49 publishes; at `FANOUT_BATCH`/wave and the per-second
 * budget above it completes in well under a second while staying inside the quota.
 */
export const publishToShards = async (
  channels: string[],
  payload: unknown,
): Promise<PublishOutcome> => {
  if (channels.length === 0) return { ok: true, transport: 'rtm-rest', channels };

  const auth = agoraBasicAuth();
  if (!auth) {
    logger.warn(
      { channels: channels.length, appId: env.AGORA_APP_ID },
      'signaling rest publish unavailable — AGORA_CUSTOMER_ID/AGORA_CUSTOMER_SECRET absent',
    );
    return {
      ok: false,
      transport: 'none',
      channels,
      reason: 'signaling_credentials_absent',
    };
  }

  const url =
    AGORA_REST_BASE +
    SIGNALING_CHANNEL_MESSAGE_PATH.replace('{appId}', env.AGORA_APP_ID).replace(
      '{account}',
      encodeURIComponent(env.CHAT_SERVICE_RTM_USER),
    );
  const minWaveMs = (FANOUT_BATCH / PUBLISH_BUDGET_PER_SECOND) * 1000;
  let reason: string | undefined;

  for (let offset = 0; offset < channels.length; offset += FANOUT_BATCH) {
    const wave = channels.slice(offset, offset + FANOUT_BATCH);
    const startedAt = Date.now();
    const results = await Promise.all(
      wave.map((channel) => publishOne(url, auth, channel, payload)),
    );
    for (const result of results) if (!result.ok && !reason) reason = result.reason;
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
