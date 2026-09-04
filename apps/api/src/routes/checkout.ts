import { Router } from 'express';
import { z } from 'zod';

import { getCart } from '../domain/cart.js';
import { availablePaymentMethods } from '../domain/checkoutPolicy.js';
import { checkDelivery } from '../domain/serviceability.js';
import { badRequest } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';

/**
 * `GET /api/checkout/options` and the AI's `get_payment_options` tool call the same
 * `availablePaymentMethods`, so the checkout page and the assistant cannot disagree
 * about the COD ceiling, the EMI floor or a blocked pincode.
 */
export const router = Router();

const optionsQuery = z.object({
  pincode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

const deliveryQuery = z.object({
  pincode: z.string().regex(/^\d{6}$/),
  productId: z.string().uuid().optional(),
});

router.get(
  '/api/checkout/options',
  ensureIdentity,
  rateLimit('cart', BUDGETS.cart),
  async (req, res, next) => {
    try {
      const parsed = optionsQuery.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest('validation_failed', 'invalid pincode', { issues: parsed.error.issues });
      }
      const cart = await getCart(req.session!.userId);
      res.json(
        await availablePaymentMethods({
          totalMinorUnits: cart.totals.totalMinorUnits,
          pincode: parsed.data.pincode ?? null,
        }),
      );
    } catch (err) {
      next(err);
    }
  },
);

/** The PDP and checkout PIN-code check. Backed by the seeded (mock) `pincodes` table. */
router.get(
  '/api/delivery/check',
  rateLimit('products', BUDGETS.products),
  async (req, res, next) => {
    try {
      const parsed = deliveryQuery.safeParse(req.query);
      if (!parsed.success) {
        throw badRequest('validation_failed', 'invalid pincode', { issues: parsed.error.issues });
      }
      res.json(await checkDelivery(parsed.data.pincode));
    } catch (err) {
      next(err);
    }
  },
);
