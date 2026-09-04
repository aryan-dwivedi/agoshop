import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './lib/logger.js';
import { setDraining } from './lib/readiness.js';
import { closeRedis } from './lib/redis.js';
import { pool } from './db/client.js';
import { allRouters } from './routes/index.js';
import { startRecordingFileRetention } from './recordingRetentionLoop.js';
const app = createApp(allRouters);
startRecordingFileRetention();
const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, provider: env.LLM_PROVIDER, privacyMode: env.PRIVACY_MODE }, 'api listening');
});
const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    setDraining(true);
    server.close();
    await closeRedis();
    await pool.end();
    process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
