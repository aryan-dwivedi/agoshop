import { env } from '@shop/platform/env.js';
import { logger } from '@shop/platform/lib/logger.js';
import { purgeExpiredRecordingFiles } from '@shop/platform/lib/recordingRetention.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const startRecordingFileRetention = (): void => {
    if (!env.RECORDING_LOCAL_FILE_PURGE) return;
    const tick = (): void => {
        purgeExpiredRecordingFiles().catch((err) =>
            logger.error({ err }, 'recording file retention failed'),
        );
    };
    setTimeout(tick, 60000).unref();
    setInterval(tick, DAY_MS).unref();
    logger.info('recording file retention enabled on api');
};
