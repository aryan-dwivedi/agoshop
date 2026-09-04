import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';

const ENQUEUE_RETRIES = 3;
export const enqueueCaptureJob = async (orderId: string): Promise<void> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < ENQUEUE_RETRIES; attempt++) {
        try {
            await redis.xadd(keys.orderCaptureStream, '*', 'orderId', orderId);
            return;
        } catch (err) {
            lastErr = err;
            await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        }
    }
    logger.error({ err: lastErr, orderId }, 'failed to enqueue order capture after retries');
    throw lastErr instanceof Error ? lastErr : new Error('capture_enqueue_failed');
};
