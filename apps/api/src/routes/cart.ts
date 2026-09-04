import { Router } from 'express';
import { z } from 'zod';

import { addItem, getCart, removeItem, setQuantity } from '@shop/domain-commerce/cart.js';
import { badRequest } from '@shop/platform/lib/errors.js';
import { withIdempotency } from '@shop/platform/lib/idempotency.js';
import { BUDGETS, rateLimit } from '@shop/platform/lib/ratelimit.js';
import { publishToUser } from '@shop/platform/lib/sse.js';
import { ensureIdentity } from '@shop/platform/middleware/session.js';
import { EVENTS } from '@shop/shared';

export const router = Router();
const cart = rateLimit('cart', BUDGETS.cart);
const addBody = z.object({
    productId: z.string().uuid(),
    variantId: z.string().uuid().optional(),
    quantity: z.number().int().positive().max(20).optional(),
    liveSessionId: z.string().uuid().nullable().optional(),
    surface: z.enum(['live', 'replay', 'browse']).optional(),
});
const quantityBody = z.object({ quantity: z.number().int().min(0).max(20) });
const pathId = (value: string | string[] | undefined): string => {
    const parsed = z.string().uuid().safeParse(value);
    if (!parsed.success) throw badRequest('invalid_item_id', 'cart item id must be a uuid');
    return parsed.data;
};
router.get('/api/cart', ensureIdentity, cart, async (req, res, next) => {
    try {
        res.json(await getCart(req.session!.userId));
    } catch (err) {
        next(err);
    }
});
router.post('/api/cart/items', ensureIdentity, cart, async (req, res, next) => {
    try {
        const parsed = addBody.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid cart payload', {
                issues: parsed.error.issues,
            });
        }
        const userId = req.session!.userId;
        const key = req.header('Idempotency-Key') ?? undefined;
        await withIdempotency(userId, key, res, async () => {
            const updated = await addItem(userId, parsed.data);
            await publishToUser(userId, EVENTS.cartUpdated, updated);
            return { status: 200, body: updated };
        });
    } catch (err) {
        next(err);
    }
});
router.patch('/api/cart/items/:id', ensureIdentity, cart, async (req, res, next) => {
    try {
        const parsed = quantityBody.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid quantity', {
                issues: parsed.error.issues,
            });
        }
        const userId = req.session!.userId;
        const updated = await setQuantity(userId, pathId(req.params.id), parsed.data.quantity);
        await publishToUser(userId, EVENTS.cartUpdated, updated);
        res.json(updated);
    } catch (err) {
        next(err);
    }
});
router.delete('/api/cart/items/:id', ensureIdentity, cart, async (req, res, next) => {
    try {
        const userId = req.session!.userId;
        const updated = await removeItem(userId, pathId(req.params.id));
        await publishToUser(userId, EVENTS.cartUpdated, updated);
        res.json(updated);
    } catch (err) {
        next(err);
    }
});
