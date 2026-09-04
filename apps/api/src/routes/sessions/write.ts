import type { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import {
  createSession,
  endSession,
  heartbeatSession,
  joinSession,
  pinProduct,
  setSessionPricing,
  setSessionProducts,
  startSession,
  updateSession,
} from '../../domain/sessions.js';
import { track } from '../../lib/analytics.js';
import { badRequest, unauthorized } from '../../lib/errors.js';
import { ensureIdentity, requireRole, requireSessionHost } from '../../middleware/session.js';
import { createRequest, idParam, productsBody, updateBody } from './schemas.js';

export const registerWriteRoutes = (router: Router): void => {
  router.post('/api/sessions', requireRole('seller', 'admin'), async (req, res, next) => {
    try {
      const session = req.session;
      if (!session) throw unauthorized();
      const parsed = createRequest.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
      const { startNow, ...input } = parsed.data;

      const [actor] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, session.userId));

      const created = await createSession(
        {
          userId: session.userId,
          role: session.role,
          displayName: actor?.displayName ?? 'Host',
        },
        input,
      );

      if (startNow !== true) {
        res.json(created);
        return;
      }

      const { session: started } = await startSession(created.id, {
        actorUserId: session.userId,
        consentAcknowledged: true,
      });
      res.status(201).json(started);
    } catch (err) {
      next(err);
    }
  });

  router.patch('/api/sessions/:id', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const parsed = updateBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
      res.json({ session: await updateSession(id.data, parsed.data) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/products', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const parsed = productsBody.safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
      res.json({ products: await setSessionProducts(id.data, parsed.data.items) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/start', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const consent = z
        .object({ consentAcknowledged: z.boolean().optional() })
        .safeParse(req.body ?? {});
      res.json(
        await startSession(id.data, {
          consentAcknowledged: consent.success ? consent.data.consentAcknowledged : false,
          actorUserId: req.session?.userId,
        }),
      );
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/consent', ensureIdentity, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const parsed = z.object({ acknowledged: z.literal(true) }).safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest('invalid_body', 'acknowledged must be true');
      track({
        type: 'recording_consent',
        sessionId: id.data,
        userId: req.session?.userId ?? null,
        payload: { role: 'viewer' },
      });
      res.json({ acknowledged: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/end', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      res.json(await endSession(id.data));
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/pin', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const parsed = z.object({ productId: z.string().uuid().nullable() }).safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
      res.json({ products: await pinProduct(id.data, parsed.data.productId) });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/api/sessions/:id/pricing', requireSessionHost, async (req, res, next) => {
    try {
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      const parsed = z
        .object({ discountPercent: z.number().int().min(0).max(90).nullable() })
        .safeParse(req.body);
      if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
      res.json({ session: await setSessionPricing(id.data, parsed.data.discountPercent) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/join', ensureIdentity, async (req, res, next) => {
    try {
      const session = req.session;
      if (!session) throw unauthorized();
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      res.json(await joinSession(id.data, session));
    } catch (err) {
      next(err);
    }
  });

  router.post('/api/sessions/:id/heartbeat', ensureIdentity, async (req, res, next) => {
    try {
      const session = req.session;
      if (!session) throw unauthorized();
      const id = idParam.safeParse(req.params.id);
      if (!id.success) throw badRequest('invalid_session_id');
      res.json(await heartbeatSession(id.data, session.userId));
    } catch (err) {
      next(err);
    }
  });
};
