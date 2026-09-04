import { EVENTS, GLOBAL_CHANNEL, sessionChannel, userChannel } from '@shop/shared';
import type { EventName, ServerEvent } from '@shop/shared';
import { logger } from './logger.js';
import { redis } from './redis.js';
const emit = async (channel: string, event: EventName, data: unknown): Promise<void> => {
    const payload: ServerEvent = { event, data, ts: Date.now() };
    try {
        await redis.publish(channel, JSON.stringify(payload));
    }
    catch (err) {
        logger.error({ err, channel, event }, 'sse publish failed');
    }
};
export const publishToUser = (userId: string, event: EventName, data: unknown) => emit(userChannel(userId), event, data);
export const publishToSession = (sessionId: string, event: EventName, data: unknown) => emit(sessionChannel(sessionId), event, data);
export const publishGlobal = (event: EventName, data: unknown) => emit(GLOBAL_CHANNEL, event, data);
export { EVENTS };
