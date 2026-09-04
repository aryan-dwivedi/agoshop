import { eq, sql } from 'drizzle-orm';
import { EVENTS } from '@shop/shared';
import { db } from '../../db/client.js';
import { liveSessions } from '../../db/schema.js';
import { keys, redis } from '../../lib/redis.js';
import { publishToSession } from '../../lib/sse.js';
import { VIEWER_TTL_MS } from './types.js';
export const viewerCount = async (sessionId: string): Promise<number> => {
    const key = keys.sessionViewers(sessionId);
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, '-inf', Date.now() - VIEWER_TTL_MS);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    const card = results?.[1]?.[1];
    return typeof card === 'number' ? card : 0;
};
export const touchPresence = async (sessionId: string, userId: string): Promise<number> => {
    const key = keys.sessionViewers(sessionId);
    const now = Date.now();
    const pipeline = redis.pipeline();
    pipeline.zadd(key, now, userId);
    pipeline.zremrangebyscore(key, '-inf', now - VIEWER_TTL_MS);
    pipeline.zcard(key);
    pipeline.expire(key, 3600);
    const results = await pipeline.exec();
    const card = results?.[2]?.[1];
    const count = typeof card === 'number' ? card : 0;
    await db
        .update(liveSessions)
        .set({ peakViewers: sql `greatest(${liveSessions.peakViewers}, ${count})` })
        .where(eq(liveSessions.id, sessionId));
    return count;
};
export const flushViewers = async (sessionId: string): Promise<number> => {
    const count = await viewerCount(sessionId);
    await db
        .update(liveSessions)
        .set({ peakViewers: sql `greatest(${liveSessions.peakViewers}, ${count})` })
        .where(eq(liveSessions.id, sessionId));
    await publishToSession(sessionId, EVENTS.sessionViewersChanged, {
        sessionId,
        viewerCount: count,
    });
    return count;
};
