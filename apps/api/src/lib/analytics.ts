import { env } from '../env.js';
import { keys, redis } from './redis.js';
import { logger } from './logger.js';
import { analyticsStreamBacklog } from './metrics.js';

/**
 * Ingestion is a Redis stream write; worker replicas drain it into Postgres in
 * batches and XACK only after the durable write. MAXLEN ~ caps memory if drain
 * falls behind.
 */
/** Approximate cap — trimmed entries are already persisted or shed as low-value. */
const ANALYTICS_STREAM_MAXLEN = 200_000;
const LOW_VALUE_EVENTS = new Set(['page_view', 'product_impression', 'scroll_depth']);
/** Refresh backlog gauge at most once per interval — avoids XLEN on every event. */
const BACKLOG_CHECK_MS = 2_000;

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
  if (now - lastBacklogCheckMs < BACKLOG_CHECK_MS) return cachedBacklog;
  try {
    cachedBacklog = await redis.xlen(keys.analyticsStream);
    analyticsStreamBacklog.set(cachedBacklog);
  } catch {
    // Best-effort; keep the last cached value for shed decisions.
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
    } catch {
      // Shed check is best-effort; never block the request path on Redis.
    }
    await redis
      .xadd(
        keys.analyticsStream,
        'MAXLEN',
        '~',
        ANALYTICS_STREAM_MAXLEN,
        '*',
        'type',
        event.type,
        'userId',
        event.userId ?? '',
        'sessionId',
        event.sessionId ?? '',
        'productId',
        event.productId ?? '',
        'payload',
        JSON.stringify(event.payload ?? {}),
        'occurredAt',
        new Date().toISOString(),
      )
      .catch((err) => logger.warn({ err, type: event.type }, 'analytics enqueue failed'));
  })();
};
