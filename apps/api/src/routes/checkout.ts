import { Router } from 'express';
import { z } from 'zod';
import { getCart } from '../domain/cart.js';
import { availablePaymentMethods } from '../domain/checkoutPolicy.js';
import { checkDelivery } from '../domain/serviceability.js';
import { badRequest } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';
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
router.get('/api/checkout/options', ensureIdentity, rateLimit('cart', BUDGETS.cart), async (req, res, next) => {
    try {
        const parsed = optionsQuery.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid pincode', { issues: parsed.error.issues });
        }
        const cart = await getCart(req.session!.userId);
        res.json(await availablePaymentMethods({
            totalMinorUnits: cart.totals.totalMinorUnits,
            pincode: parsed.data.pincode ?? null,
        }));
    }
    catch (err) {
        next(err);
    }
});
router.get('/api/delivery/check', rateLimit('products', BUDGETS.products), async (req, res, next) => {
    try {
        const parsed = deliveryQuery.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid pincode', { issues: parsed.error.issues });
        }
        res.json(await checkDelivery(parsed.data.pincode));
    }
    catch (err) {
        next(err);
    }
});
