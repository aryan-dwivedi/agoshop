import { env } from './env.js';
import { logger } from './lib/logger.js';
import { purgeExpiredRecordingFiles } from './lib/recordingRetention.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * When the API container owns the recordings volume (Render), file deletion runs here
 * while the worker clears the matching database rows.
 */
export const startRecordingFileRetention = (): void => {
  if (!env.RECORDING_LOCAL_FILE_PURGE) return;

  const tick = (): void => {
    purgeExpiredRecordingFiles().catch((err) =>
      logger.error({ err }, 'recording file retention failed'),
    );
  };

  setTimeout(tick, 60_000).unref();
  setInterval(tick, DAY_MS).unref();
  logger.info('recording file retention enabled on api');
};
