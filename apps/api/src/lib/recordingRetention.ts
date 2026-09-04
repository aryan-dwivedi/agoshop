import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { and, isNotNull, lt } from 'drizzle-orm';

import { db } from '../db/client.js';
import { liveSessions } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from './logger.js';
import { deleteRecordingObject, keyFromUrl } from './objectStore.js';

const recordingCutoff = (): Date =>
  new Date(Date.now() - env.RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1_000);

/**
 * Deletes expired recording bytes from local disk or object storage. Does not mutate
 * session rows — the worker retention loop clears those after files are gone.
 *
 * On Render the API service owns the recordings disk; the worker sets
 * RECORDING_LOCAL_FILE_PURGE=false and this runs on the API replica instead.
 */
export const purgeExpiredRecordingFiles = async (): Promise<number> => {
  const expiredRecordings = await db
    .select({ id: liveSessions.id, recordingUrl: liveSessions.recordingUrl })
    .from(liveSessions)
    .where(
      and(
        isNotNull(liveSessions.recordingUrl),
        isNotNull(liveSessions.endedAt),
        lt(liveSessions.endedAt, recordingCutoff()),
      ),
    );

  let removed = 0;
  for (const row of expiredRecordings) {
    const url = row.recordingUrl ?? '';
    if (!url.startsWith('/media/recordings/')) {
      const key = keyFromUrl(url);
      if (key) await deleteRecordingObject(key);
      removed += 1;
      continue;
    }
    const name = basename(url);
    if (name && name.includes('.')) {
      try {
        await unlink(join(env.RECORDING_LOCAL_DIR, name));
        removed += 1;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn({ err, sessionId: row.id, name }, 'recording file unlink failed');
        }
      }
    }
  }

  if (removed > 0) logger.info({ removed }, 'recording files purged');
  return removed;
};
