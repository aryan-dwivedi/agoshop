import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';

import { createApp } from './app.js';
import { closeRedis as closeSubscriber } from './lib/redis.js';
import { drainSseClients, getSseClientCount } from './lib/sse.js';

const DRAIN_MS = 30000;
const app = createApp();
const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'sse-gateway listening');
});
let shuttingDown = false;
const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, clients: getSseClientCount() }, 'sse-gateway draining');
    server.close();
    drainSseClients();
    const deadline = Date.now() + DRAIN_MS;
    while (getSseClientCount() > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    await closeSubscriber();
    logger.info({ remaining: getSseClientCount() }, 'sse-gateway stopped');
    process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
