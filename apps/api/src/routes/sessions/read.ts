import type { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { TranscriptLine } from '@shop/shared';

import { db } from '../../db/client.js';
import { sessionTranscripts } from '../../db/schema.js';
import { listChatMessages } from '../../domain/chat.js';
import { listPolls } from '../../domain/polls.js';
import { reactionCounts } from '../../domain/reactions.js';
import { getSessionByIdOrSlug, listSessionProducts, listSessions } from '../../domain/sessions.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { slugParam, STATUSES } from './schemas.js';

export const registerReadRoutes = (router: Router): void => {
  router.get('/api/sessions', async (req, res, next) => {
    try {
      const raw = req.query.status;
      const requested = (Array.isArray(raw) ? raw : [raw])
        .flatMap((value) => (typeof value === 'string' ? value.split(',') : []))
        .map((value) => STATUSES[value.trim()])
        .filter((value): value is (typeof STATUSES)[string] => value !== undefined);

      const seller = req.query.sellerSlug;
      let sellerSlug: string | undefined;
      if (seller !== undefined) {
        const parsed = slugParam.safeParse(seller);
        if (!parsed.success) throw badRequest('invalid_seller_slug');
        sellerSlug = parsed.data;
      }

      res.json({ sessions: await listSessions({ statuses: requested, sellerSlug }) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug/products', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      res.json({ products: await listSessionProducts(session.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug/polls', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      res.json({ polls: await listPolls(session.id, req.session?.userId ?? null) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug/chat', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      const limit = Number(req.query.limit ?? 200);
      res.json({
        messages: await listChatMessages(session.id, Number.isFinite(limit) ? limit : 200),
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug/reactions', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      res.json({ counts: await reactionCounts(session.id) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug/transcript', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

      const rows = await db
        .select({
          id: sessionTranscripts.id,
          speaker: sessionTranscripts.speaker,
          language: sessionTranscripts.language,
          text: sessionTranscripts.text,
          startMs: sessionTranscripts.startMs,
        })
        .from(sessionTranscripts)
        .where(
          q.length > 0
            ? and(
                eq(sessionTranscripts.sessionId, session.id),
                sql`to_tsvector('simple', ${sessionTranscripts.text}) @@ plainto_tsquery('simple', ${q})`,
              )
            : eq(sessionTranscripts.sessionId, session.id),
        )
        .orderBy(asc(sessionTranscripts.startMs))
        .limit(500);

      const lines: TranscriptLine[] = rows.map((row) => ({
        id: String(row.id),
        speaker: row.speaker === 'assistant' || row.speaker === 'user' ? row.speaker : 'host',
        language: row.language,
        text: row.text,
        startMs: row.startMs,
      }));
      res.json({ lines, summary: session.transcriptSummary });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/sessions/:slug', async (req, res, next) => {
    try {
      const parsed = slugParam.safeParse(req.params.slug);
      if (!parsed.success) throw badRequest('invalid_session_slug');
      const session = await getSessionByIdOrSlug(parsed.data);
      if (!session) throw notFound('session_not_found');
      res.json({ session });
    } catch (err) {
      next(err);
    }
  });
};
