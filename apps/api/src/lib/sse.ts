import { EVENTS, GLOBAL_CHANNEL, sessionChannel, userChannel } from '@shop/shared';
import type { EventName, ServerEvent } from '@shop/shared';

import { logger } from './logger.js';
import { redis } from './redis.js';

/**
 * Redis pub/sub publishers for the dedicated SSE gateway tier.
 *
 * API and background processes publish here; sse-gateway replicas subscribe and fan out
 * to browser tabs. Neither Redis pub/sub nor SSE offers replay — clients refetch state
 * on reconnect.
 */

const emit = async (channel: string, event: EventName, data: unknown): Promise<void> => {
  const payload: ServerEvent = { event, data, ts: Date.now() };
  try {
    await redis.publish(channel, JSON.stringify(payload));
  } catch (err) {
    logger.error({ err, channel, event }, 'sse publish failed');
  }
};

export const publishToUser = (userId: string, event: EventName, data: unknown) =>
  emit(userChannel(userId), event, data);

export const publishToSession = (sessionId: string, event: EventName, data: unknown) =>
  emit(sessionChannel(sessionId), event, data);

/** Global rule changes (promotions, checkout policy) reach every client on every replica. */
export const publishGlobal = (event: EventName, data: unknown) => emit(GLOBAL_CHANNEL, event, data);

export { EVENTS };
