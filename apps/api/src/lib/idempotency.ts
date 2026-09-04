import type { Response } from 'express';

import { conflict } from './errors.js';
import { keys, redis } from './redis.js';

/**
 * Idempotency-Key replay, scoped per user — matching UNIQUE (userId, idempotencyKey)
 * on orders. Two different users may legitimately send the same key text.
 */
type Stored = { status: number; body: unknown };

const IN_PROGRESS = '__in_progress__';

export const withIdempotency = async <T>(
  userId: string,
  key: string | undefined,
  res: Response,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<void> => {
  if (!key) {
    const result = await handler();
    res.status(result.status).json(result.body);
    return;
  }

  const redisKey = keys.idempotency(userId, key);
  const claimed = await redis.set(redisKey, IN_PROGRESS, 'EX', 86_400, 'NX');
  if (claimed === null) {
    const existing = await redis.get(redisKey);
    if (existing === null || existing === IN_PROGRESS) {
      throw conflict('idempotency_in_progress', 'a request with this key is still running');
    }
    const stored = JSON.parse(existing) as Stored;
    res.status(stored.status).setHeader('Idempotent-Replay', 'true');
    res.json(stored.body);
    return;
  }

  try {
    const result = await handler();
    await redis.set(
      redisKey,
      JSON.stringify({ status: result.status, body: result.body }),
      'EX',
      86_400,
    );
    res.status(result.status).json(result.body);
  } catch (err) {
    // A failed attempt must not poison the key.
    await redis.del(redisKey);
    throw err;
  }
};
