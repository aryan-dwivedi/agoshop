import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import type { SellerPublicDto } from '@shop/shared';

import { db } from '../db/client.js';
import { sellers } from '../db/schema.js';
import { listSessionsForSellerSlug } from '../domain/sessions.js';
import { notFound } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';

/**
 * The public storefront read behind `/creator/:slug`. Anonymous and rate limited on the
 * catalog budget, because it is a catalog read: a header plus this seller's shows.
 *
 * The slug is `sellers.slug` — the column the schema already carries and the one
 * `GET /api/seller/products?sellerId=` reports in every operator scope. No second
 * identifier scheme is derived here; a seller has exactly one public name.
 */
export const router: Router = Router();

const storefront = rateLimit('products', BUDGETS.products);

/** Express types a path param as `string | string[]`; a seller slug is one string. */
const slugParam = z.string().min(1).max(80);

router.get('/api/sellers/:slug', storefront, async (req, res, next) => {
  try {
    const parsed = slugParam.safeParse(req.params.slug);
    if (!parsed.success) throw notFound('seller_not_found');

    const [row] = await db
      .select({
        id: sellers.id,
        slug: sellers.slug,
        name: sellers.displayName,
        rating: sellers.rating,
        /**
         * One statement — a correlated count costs nothing next to the row it decorates.
         * The correlation is spelled out because a drizzle column reference inside a
         * select-list fragment is not table-qualified on a single-table select, and
         * `where seller_id = id` would silently compare two columns of `products`.
         */
        productCount: sql<number>`(select count(*)::int from products p where p.seller_id = sellers.id)`,
      })
      .from(sellers)
      .where(eq(sellers.slug, parsed.data));
    if (!row) throw notFound('seller_not_found');

    const seller: SellerPublicDto = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      productCount: Number(row.productCount) || 0,
      // `real` in Postgres, so it can arrive as a string depending on the driver path.
      rating: Number(row.rating) || 0,
    };

    res.json({ seller, sessions: await listSessionsForSellerSlug(seller.slug) });
  } catch (err) {
    next(err);
  }
});
