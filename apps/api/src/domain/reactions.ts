import { EVENTS } from '@shop/shared';
import { track } from '../lib/analytics.js';
import { badRequest } from '../lib/errors.js';
import { keys, redis } from '../lib/redis.js';
import { publishToSession } from '../lib/sse.js';
const ALLOWED: Record<string, true> = {
    '❤️': true,
    '🔥': true,
    '👏': true,
    '😍': true,
    '🎉': true,
    '👍': true,
    '😮': true,
    '🛒': true,
};
export const REACTION_EMOJIS = Object.keys(ALLOWED);
const deltaKey = (sessionId: string) => `${keys.sessionReactions(sessionId)}:delta`;
export const addReaction = async (sessionId: string, userId: string, emoji: string): Promise<Record<string, number>> => {
    if (!ALLOWED[emoji])
        throw badRequest('unsupported_emoji');
    const cumulativeKey = keys.sessionReactions(sessionId);
    const pipeline = redis.pipeline();
    pipeline.hincrby(cumulativeKey, emoji, 1);
    pipeline.hincrby(deltaKey(sessionId), emoji, 1);
    pipeline.expire(cumulativeKey, 7 * 24 * 60 * 60);
    pipeline.expire(deltaKey(sessionId), 3600);
    pipeline.hgetall(cumulativeKey);
    const results = await pipeline.exec();
    track({ type: 'reaction', userId, sessionId, payload: { emoji } });
    const raw = results?.[4]?.[1];
    return toCounts(raw);
};
const toCounts = (raw: unknown): Record<string, number> => {
    const counts: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw as Record<string, string>)) {
            counts[key] = Number(value);
        }
    }
    return counts;
};
export const reactionCounts = async (sessionId: string): Promise<Record<string, number>> => toCounts(await redis.hgetall(keys.sessionReactions(sessionId)));
export const flushReactions = async (sessionId: string): Promise<void> => {
    const delta = deltaKey(sessionId);
    const pipeline = redis.multi();
    pipeline.hgetall(delta);
    pipeline.del(delta);
    const results = await pipeline.exec();
    const deltas = toCounts(results?.[0]?.[1]);
    if (Object.keys(deltas).length === 0)
        return;
    const counts = await reactionCounts(sessionId);
    await publishToSession(sessionId, EVENTS.sessionReactions, { sessionId, counts, deltas });
};
