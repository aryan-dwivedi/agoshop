import { createApp } from '@shop/api/app.js';
import { router as healthRouter } from '@shop/api/routes/health.js';
import { pool } from '@shop/db/client.js';
import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { closeRedis } from '@shop/platform/lib/redis.js';

import { aiServiceRouters } from './routes.js';

const app = createApp([healthRouter, ...aiServiceRouters]);
const port = Number(process.env.PORT ?? 8790);
const server = app.listen(port, () => {
    logger.info({ port, provider: env.LLM_PROVIDER }, 'ai-service listening');
});
const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'ai-service shutting down');
    server.close();
    await closeRedis();
    await pool.end();
    process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
