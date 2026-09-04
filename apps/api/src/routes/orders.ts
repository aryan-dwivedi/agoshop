import { Router } from 'express';
import { z } from 'zod';

import { createOrder, getOrderOrThrow, listOrders } from '../domain/orders.js';
import { badRequest } from '../lib/errors.js';
import { withIdempotency } from '../lib/idempotency.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';

/**
 * `Idempotency-Key` is required on POST: the first status+body is cached per user for
 * 24 h and replayed, matching UNIQUE (userId, idempotencyKey) on `orders`.
 */
export const router = Router();

const orders = rateLimit('orders', BUDGETS.orders);

const orderBody = z.object({
  paymentMethod: z.enum(['card', 'upi', 'cod', 'emi', 'netbanking']),
  pincode: z.string().regex(/^\d{6}$/),
  card: z
    .object({
      number: z.string().min(12).max(24),
      expiry: z.string().max(10).optional(),
      cvv: z.string().max(4).optional(),
      name: z.string().max(80).optional(),
    })
    .nullable()
    .optional(),
});
/** Express types a path param as `string | string[]`; an order id must be one uuid. */
const pathId = (value: string | string[] | undefined): string => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest('invalid_order_id', 'order id must be a uuid');
  return parsed.data;
};

router.post('/api/orders', ensureIdentity, orders, async (req, res, next) => {
  try {
    const parsed = orderBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('validation_failed', 'invalid order payload', {
        issues: parsed.error.issues,
      });
    }
    const key = req.header('Idempotency-Key');
    if (!key)
      throw badRequest('idempotency_key_required', 'POST /api/orders needs Idempotency-Key');

    const userId = req.session!.userId;
    await withIdempotency(userId, key, res, async () => {
      const order = await createOrder(userId, key, {
        paymentMethod: parsed.data.paymentMethod,
        pincode: parsed.data.pincode,
        card: parsed.data.card ?? null,
      });
      const status = order.status === 'pending' ? 202 : 201;
      return { status, body: { order } };
    });
  } catch (err) {
    next(err);
  }
});

router.get('/api/orders', ensureIdentity, orders, async (req, res, next) => {
  try {
    res.json({ orders: await listOrders(req.session!.userId) });
  } catch (err) {
    next(err);
  }
});

router.get('/api/orders/:id', ensureIdentity, orders, async (req, res, next) => {
  try {
    res.json({ order: await getOrderOrThrow(req.session!.userId, pathId(req.params.id)) });
  } catch (err) {
    next(err);
  }
});
