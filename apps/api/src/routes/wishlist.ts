import { Router } from 'express';
import { z } from 'zod';

import { addToWishlist, listWishlist, removeFromWishlist } from '../domain/wishlist.js';
import { badRequest } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';

/**
 * Wishlist writes are what make the `has_wishlisted` segment (and therefore
 * WISHLIST5's `not_stackable` suppression against LIVE20) demonstrable.
 */
export const router = Router();

const limiter = rateLimit('cart', BUDGETS.cart);

const productBody = z.object({ productId: z.string().uuid() });
const productQuery = z.object({ productId: z.string().uuid() });

router.get('/api/wishlist', ensureIdentity, limiter, async (req, res, next) => {
  try {
    res.json({ items: await listWishlist(req.session!.userId) });
  } catch (err) {
    next(err);
  }
});

router.post('/api/wishlist', ensureIdentity, limiter, async (req, res, next) => {
  try {
    const parsed = productBody.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest('validation_failed', 'invalid productId', { issues: parsed.error.issues });
    }
    res.json(await addToWishlist(req.session!.userId, parsed.data.productId));
  } catch (err) {
    next(err);
  }
});

router.delete('/api/wishlist', ensureIdentity, limiter, async (req, res, next) => {
  try {
    const parsed = productQuery.safeParse(req.query);
    if (!parsed.success) {
      throw badRequest('validation_failed', 'invalid productId', { issues: parsed.error.issues });
    }
    res.json(await removeFromWishlist(req.session!.userId, parsed.data.productId));
  } catch (err) {
    next(err);
  }
});
