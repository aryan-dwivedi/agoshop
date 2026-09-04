import { logger } from './logger.js';
import { keys, redis } from './redis.js';

export const enqueueSearchIndex = (productId: string): void => {
    void redis
        .xadd(keys.searchIndexStream, '*', 'productId', productId)
        .catch((err) => logger.warn({ err, productId }, 'search index enqueue failed'));
};
