import { warnConvoAiReachability } from '@shop/agora/convoai.js';
import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { setDraining } from '@shop/platform/lib/readiness.js';
import { closeRedis } from '@shop/platform/lib/redis.js';

import { createApp } from './app.js';
import { pool } from './db/client.js';
import { startRecordingFileRetention } from './recordingRetentionLoop.js';
import { allRouters } from './routes/index.js';

const app = createApp(allRouters);
startRecordingFileRetention();
const server = app.listen(env.PORT, () => {
    warnConvoAiReachability();
    logger.info(
        { port: env.PORT, provider: env.LLM_PROVIDER, privacyMode: env.PRIVACY_MODE },
        'api listening',
    );
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
