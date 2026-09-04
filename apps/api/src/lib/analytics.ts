import { env } from '../env.js';
import { keys, redis } from './redis.js';
import { logger } from './logger.js';
import { analyticsStreamBacklog } from './metrics.js';
const ANALYTICS_STREAM_MAXLEN = 200000;
const LOW_VALUE_EVENTS = new Set(['page_view', 'product_impression', 'scroll_depth']);
const BACKLOG_CHECK_MS = 2000;
export type AnalyticsEvent = {
    type: string;
    userId?: string | null;
    sessionId?: string | null;
    productId?: string | null;
    payload?: Record<string, unknown>;
};
let cachedBacklog = 0;
let lastBacklogCheckMs = 0;
const refreshBacklogIfStale = async (): Promise<number> => {
    const now = Date.now();
    if (now - lastBacklogCheckMs < BACKLOG_CHECK_MS)
        return cachedBacklog;
    try {
        cachedBacklog = await redis.xlen(keys.analyticsStream);
        analyticsStreamBacklog.set(cachedBacklog);
    }
    catch {
    }
    lastBacklogCheckMs = now;
    return cachedBacklog;
};
export const track = (event: AnalyticsEvent): void => {
    void (async () => {
        try {
            const backlog = await refreshBacklogIfStale();
            if (backlog > env.ANALYTICS_BACKLOG_WATERMARK && LOW_VALUE_EVENTS.has(event.type)) {
                return;
            }
        }
        catch {
        }
        await redis
            .xadd(keys.analyticsStream, 'MAXLEN', '~', ANALYTICS_STREAM_MAXLEN, '*', 'type', event.type, 'userId', event.userId ?? '', 'sessionId', event.sessionId ?? '', 'productId', event.productId ?? '', 'payload', JSON.stringify(event.payload ?? {}), 'occurredAt', new Date().toISOString())
            .catch((err) => logger.warn({ err, type: event.type }, 'analytics enqueue failed'));
    })();
};
