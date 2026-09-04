import { keys, redis } from './redis.js';
import { logger } from './logger.js';

/** Enqueue a product for optional OpenSearch indexing (Postgres FTS needs no index step). */
export const enqueueSearchIndex = (productId: string): void => {
  void redis
    .xadd(keys.searchIndexStream, '*', 'productId', productId)
    .catch((err) => logger.warn({ err, productId }, 'search index enqueue failed'));
};
