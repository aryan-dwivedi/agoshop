import { logger } from './logger.js';
import { redis } from './redis.js';

/** Cache-aside with prefix invalidation. Never caches anything price-authoritative. */
export const cached = async <T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> => {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed; falling through to loader');
  }
  const value = await loader();
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed');
  }
  return value;
};

export const invalidate = async (prefix: string): Promise<number> => {
  let cursor = '0';
  let removed = 0;
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = next;
    if (batch.length > 0) removed += await redis.del(...batch);
  } while (cursor !== '0');
  return removed;
};

export const cacheKeys = {
  categoryList: 'cat:v1:list',
  product: (id: string) => `prod:v1:${id}`,
  productQuery: (hash: string) => `prodq:v1:${hash}`,
  recommendations: (userId: string, kind: string) => `rec:v1:${userId}:${kind}`,
} as const;
