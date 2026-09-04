import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { aiAgentSlotsInUse } from '../lib/metrics.js';
import { keys, redis } from '../lib/redis.js';

/**
 * Admission control for ConvoAI.
 *
 * Agora's documented default is 20 concurrent agents per App ID, and one agent serves
 * exactly one viewer (`remote_rtc_uids` supports a single user id), so concurrency is
 * a hard, shared, cross-replica resource. It is enforced as a Redis lease semaphore on
 * the sorted set `ai:agents`, scored by lease expiry:
 *
 *  - `acquireSlot` prunes expired leases and then `ZADD`s only when
 *    `ZCARD < CONVOAI_MAX_CONCURRENT_AGENTS`, atomically, in one Lua script — a
 *    check-then-add from two replicas would both pass;
 *  - the lease TTL is `CONVOAI_IDLE_TIMEOUT_SECONDS + 60`, i.e. slightly longer than
 *    the agent's own idle timeout, and the client's heartbeat refreshes it, so a
 *    crashed client's slot is reclaimed instead of being leaked forever;
 *  - `expiredLeases()` is what the background sweeper reads to call Agora `leave` for
 *    agents whose owner went away. It is deliberately NON-destructive: the sweeper must
 *    still be holding the id when it issues the remote leave.
 *
 * Exhaustion is a `503 ai_capacity` with `retryAfterSeconds`, and the client degrades
 * to the labelled text transport rather than dead-ending the journey.
 */

const LEASE_TTL_SECONDS = env.CONVOAI_IDLE_TIMEOUT_SECONDS + 60;

/** Returns {granted, liveCount, earliestExpiry}. Prune-then-admit is one round trip. */
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

/** Only refreshes a lease that still exists; a swept conversation must re-acquire. */
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
    // Tell the client when a slot is genuinely expected to free, not a constant.
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

/** `false` means the lease had already expired and the caller must re-acquire. */
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

/**
 * Conversation ids whose lease has lapsed, without removing them: the background
 * sweeper calls ConvoAI `leave` first and only then releases, so a crash mid-sweep
 * retries instead of orphaning a running agent.
 */
export const expiredLeases = async (): Promise<string[]> => {
  const now = Math.floor(Date.now() / 1000);
  return redis.zrangebyscore(keys.aiAgents, '-inf', now);
};

/** Recomputes the exported gauge from live (non-expired) leases. */
export const syncSlotGauge = async (): Promise<number> => {
  const liveCount = await redis.zcount(keys.aiAgents, Math.floor(Date.now() / 1000), '+inf');
  setGauge(liveCount);
  return liveCount;
};

export { LEASE_TTL_SECONDS };
