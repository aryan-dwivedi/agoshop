import { Redis } from 'ioredis';
import { env } from '../../../api/src/env.js';
import { logger } from '../../../api/src/lib/logger.js';
export const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
subscriber.on('error', (err) => logger.error({ err, conn: 'subscriber' }, 'redis connection error'));
export const closeRedis = async (): Promise<void> => {
    await subscriber.quit();
};
