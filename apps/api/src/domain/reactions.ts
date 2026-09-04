import { EVENTS } from '@shop/shared';

import { track } from '../lib/analytics.js';
import { badRequest } from '../lib/errors.js';
import { keys, redis } from '../lib/redis.js';
import { publishToSession } from '../lib/sse.js';

/**
 * High-frequency signals are aggregated, not fanned out (decision 13). A tap is one
 * `HINCRBY`; the aggregate is broadcast at 1 Hz over SSE by the SINGLE background
 * process. Publishing one RTM message per tap would multiply RTM's per-message billing
 * by the audience size for a signal nobody reads individually.
 *
 * NOTHING here starts a timer. `flushReactions` is called by `background.ts` only.
 */

/** Small allow-list: an unbounded emoji key space is an unbounded Redis hash. */
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

/** Cumulative counts survive the flush; only the per-tick delta is reset. */
const deltaKey = (sessionId: string) => `${keys.sessionReactions(sessionId)}:delta`;

export const addReaction = async (
  sessionId: string,
  userId: string,
  emoji: string,
): Promise<Record<string, number>> => {
  if (!ALLOWED[emoji]) throw badRequest('unsupported_emoji');

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

export const reactionCounts = async (sessionId: string): Promise<Record<string, number>> =>
  toCounts(await redis.hgetall(keys.sessionReactions(sessionId)));

/**
 * 1 Hz aggregate. Reads and atomically clears the delta hash so two ticks can never
 * report the same tap twice, then publishes cumulative counts plus this tick's deltas —
 * the client animates from the delta and renders the total from the counts.
 * A tick with no new taps publishes nothing.
 */
export const flushReactions = async (sessionId: string): Promise<void> => {
  const delta = deltaKey(sessionId);
  const pipeline = redis.multi();
  pipeline.hgetall(delta);
  pipeline.del(delta);
  const results = await pipeline.exec();
  const deltas = toCounts(results?.[0]?.[1]);
  if (Object.keys(deltas).length === 0) return;

  const counts = await reactionCounts(sessionId);
  await publishToSession(sessionId, EVENTS.sessionReactions, { sessionId, counts, deltas });
};
