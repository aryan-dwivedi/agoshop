import { env } from '@shop/platform/env.js';
import { AppError } from '@shop/platform/lib/errors.js';
import { logger } from '@shop/platform/lib/logger.js';
import { aiAgentSlotsInUse } from '@shop/platform/lib/metrics.js';
import { keys, redis } from '@shop/platform/lib/redis.js';

const LEASE_TTL_SECONDS = env.CONVOAI_IDLE_TIMEOUT_SECONDS + 60;
const ACQUIRE = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local max = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local held = redis.call('ZSCORE', key, member)
if held then
  redis.call('ZADD', key, now + ttl, member)
  return {1, redis.call('ZCARD', key), 0}
end
local card = redis.call('ZCARD', key)
if card < max then
  redis.call('ZADD', key, now + ttl, member)
  return {1, card + 1, 0}
end
local first = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local earliest = 0
if first[2] then earliest = tonumber(first[2]) end
return {0, card, earliest}
`;
const REFRESH = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
if redis.call('ZSCORE', key, member) then
  redis.call('ZADD', key, now + ttl, member)
  return 1
end
return 0
`;
const setGauge = (liveCount: number): void => {
    aiAgentSlotsInUse.set(liveCount);
};
export const acquireSlot = async (conversationId: string): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    const [granted, liveCount, earliest] = (await redis.eval(
        ACQUIRE,
        1,
        keys.aiAgents,
        conversationId,
        String(now),
        String(LEASE_TTL_SECONDS),
        String(env.CONVOAI_MAX_CONCURRENT_AGENTS),
    )) as [number, number, number];
    setGauge(liveCount);
    if (granted !== 1) {
        const retryAfterSeconds = earliest > now ? Math.min(earliest - now, LEASE_TTL_SECONDS) : 5;
        logger.warn(
            { conversationId, liveCount, max: env.CONVOAI_MAX_CONCURRENT_AGENTS },
            'convoai admission refused: capacity exhausted',
        );
        throw new AppError(
            503,
            'ai_capacity',
            'all voice agents are busy; the text assistant is available',
            { retryAfterSeconds },
        );
    }
};
export const refreshSlot = async (conversationId: string): Promise<boolean> => {
    const now = Math.floor(Date.now() / 1000);
    const refreshed = (await redis.eval(
        REFRESH,
        1,
        keys.aiAgents,
        conversationId,
        String(now),
        String(LEASE_TTL_SECONDS),
    )) as number;
    setGauge(await redis.zcount(keys.aiAgents, now, '+inf'));
    return refreshed === 1;
};
export const releaseSlot = async (conversationId: string): Promise<void> => {
    const now = Math.floor(Date.now() / 1000);
    await redis.zrem(keys.aiAgents, conversationId);
    setGauge(await redis.zcount(keys.aiAgents, now, '+inf'));
};
export const expiredLeases = async (): Promise<string[]> => {
    const now = Math.floor(Date.now() / 1000);
    return redis.zrangebyscore(keys.aiAgents, '-inf', now);
};
export const syncSlotGauge = async (): Promise<number> => {
    const liveCount = await redis.zcount(keys.aiAgents, Math.floor(Date.now() / 1000), '+inf');
    setGauge(liveCount);
    return liveCount;
};
export { LEASE_TTL_SECONDS };
