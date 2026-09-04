import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { Router } from 'express';
import { eq } from 'drizzle-orm';
import multer from 'multer';
import { z } from 'zod';

import { EVENTS } from '@shop/shared';

import { db } from '../../db/client.js';
import { liveSessions } from '../../db/schema.js';
import { getSessionById } from '../../domain/sessions.js';
import { env } from '../../env.js';
import { deleteRecordingObject, keyFromUrl, mirrorRecording } from '../../lib/objectStore.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { publishToSession } from '../../lib/sse.js';
import { requireSessionHost } from '../../middleware/session.js';
import { idParam } from './schemas.js';

const EXT_BY_MIME: Record<string, string> = {
  'video/webm': 'webm',
  'audio/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(env.RECORDING_LOCAL_DIR, { recursive: true });
      cb(null, env.RECORDING_LOCAL_DIR);
    },
    filename: (req, file, cb) => {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) {
        cb(badRequest('invalid_session_id'), '');
        return;
      }
      cb(null, `${id.data}.${EXT_BY_MIME[file.mimetype] ?? 'webm'}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const SOURCE_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
};

const SOURCE_VIDEO_SUFFIX = '-source';
const MEDIA_PREFIX = '/media/recordings/';

const sourceVideoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(env.RECORDING_LOCAL_DIR, { recursive: true });
      cb(null, env.RECORDING_LOCAL_DIR);
    },
    filename: (req, file, cb) => {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) {
        cb(badRequest('invalid_session_id'), '');
        return;
      }
      const ext = SOURCE_EXT_BY_MIME[file.mimetype];
      if (ext === undefined) {
        cb(badRequest('unsupported_video_type', `${file.mimetype} is not a supported video`), '');
        return;
      }
      cb(null, `${id.data}${SOURCE_VIDEO_SUFFIX}.${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (SOURCE_EXT_BY_MIME[file.mimetype] === undefined) {
      cb(badRequest('unsupported_video_type', `${file.mimetype} is not a supported video`));
      return;
    }
    cb(null, true);
  },
  limits: { fileSize: 500 * 1024 * 1024 },
});

const unlinkMedia = async (url: string | null): Promise<void> => {
  if (!url?.startsWith(MEDIA_PREFIX)) return;
  const filename = basename(url.slice(MEDIA_PREFIX.length));
  if (filename.length === 0 || filename === '.' || filename === '..') return;
  await unlink(join(env.RECORDING_LOCAL_DIR, filename)).catch(() => undefined);
};

export const registerMediaRoutes = (router: Router): void => {
  router.post(
    '/api/sessions/:id/recording',
    requireSessionHost,
    upload.single('recording'),
    async (req, res, next) => {
      try {
        const id = idParam.safeParse(req.params.id);
        if (!id.success) throw badRequest('invalid_session_id');
        const sessionId = id.data;

        if (!req.file) {
          const reported = z.object({ error: z.string().max(120) }).safeParse(req.body ?? {});
          const reason = reported.success ? reported.data.error : 'no_file';
          const marked = await db
            .update(liveSessions)
            .set({
              recordingProvider: 'browser',
              recordingStatus: 'failed',
              recordingError: reason,
            })
            .where(eq(liveSessions.id, sessionId))
            .returning({ id: liveSessions.id });
          if (marked.length === 0) throw notFound('session_not_found');
          res.status(202).json({ recordingStatus: 'failed', recordingError: reason });
          return;
        }

        const localUrl = `/media/recordings/${req.file.filename}`;
        const durationMs = Number(
          (req.body as Record<string, unknown> | undefined)?.['durationMs'] ?? 0,
        );

        const mirror = await mirrorRecording(
          req.file.path,
          `sessions/${sessionId}/${req.file.filename}`,
          req.file.mimetype || 'video/webm',
        );
        const recordingUrl = mirror.mirrored ? mirror.url : localUrl;

        const updated = await db
          .update(liveSessions)
          .set({
            recordingProvider: mirror.mirrored ? 'browser+s3' : 'browser',
            recordingStatus: 'ready',
            recordingError: null,
            recordingUrl,
          })
          .where(eq(liveSessions.id, sessionId))
          .returning({ id: liveSessions.id });
        if (updated.length === 0) throw notFound('session_not_found');

        await publishToSession(sessionId, EVENTS.recordingReady, { sessionId, recordingUrl });
        res.status(201).json({
          recordingUrl,
          localUrl,
          storage: mirror.mirrored ? 'object-store' : 'shared-volume',
          storageReason: mirror.mirrored ? undefined : mirror.reason,
          recordingStatus: 'ready',
          bytes: req.file.size,
          durationMs: Number.isFinite(durationMs) ? durationMs : 0,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/api/sessions/:id/recording', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const sessionId = id.data;
      const [row] = await db
        .select({ recordingUrl: liveSessions.recordingUrl })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
      if (!row) throw notFound('session_not_found');

      if (row.recordingUrl?.startsWith('/media/recordings/')) {
        const filename = row.recordingUrl.slice('/media/recordings/'.length);
        if (!filename.includes('/') && !filename.includes('..')) {
          await unlink(join(env.RECORDING_LOCAL_DIR, filename)).catch(() => undefined);
        }
      } else if (row.recordingUrl) {
        const key = keyFromUrl(row.recordingUrl);
        if (key) {
          await deleteRecordingObject(key);
          const filename = key.split('/').pop() ?? '';
          if (filename.length > 0 && !filename.includes('..')) {
            await unlink(join(env.RECORDING_LOCAL_DIR, filename)).catch(() => undefined);
          }
        }
      }

      await db
        .update(liveSessions)
        .set({
          recordingStatus: 'none',
          recordingUrl: null,
          recordingError: null,
          recordingResourceId: null,
          recordingSid: null,
        })
        .where(eq(liveSessions.id, sessionId));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/api/sessions/:id/source-video',
    requireSessionHost,
    sourceVideoUpload.single('video'),
    async (req, res, next) => {
      try {
        const id = idParam.safeParse(req.params.id);
        if (!id.success) throw badRequest('invalid_session_id');
        const sessionId = id.data;
        if (!req.file) throw badRequest('no_video_file', 'attach the video as field "video"');

        const sourceVideoUrl = `${MEDIA_PREFIX}${req.file.filename}`;
        const updated = await db
          .update(liveSessions)
          .set({ sourceVideoUrl })
          .where(eq(liveSessions.id, sessionId))
          .returning({ id: liveSessions.id });
        if (updated.length === 0) throw notFound('session_not_found');

        const session = await getSessionById(sessionId);
        if (!session) throw notFound('session_not_found');
        res.status(201).json({ session });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete('/api/sessions/:id/source-video', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const sessionId = id.data;

      const [row] = await db
        .select({ sourceVideoUrl: liveSessions.sourceVideoUrl })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
      if (!row) throw notFound('session_not_found');

      await unlinkMedia(row.sourceVideoUrl);

      await db
        .update(liveSessions)
        .set({ sourceVideoUrl: null })
        .where(eq(liveSessions.id, sessionId));

      const session = await getSessionById(sessionId);
      if (!session) throw notFound('session_not_found');
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });
};
