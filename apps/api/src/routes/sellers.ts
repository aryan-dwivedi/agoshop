import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SellerPublicDto } from '@shop/shared';
import { db } from '../db/client.js';
import { sellers } from '../db/schema.js';
import { listSessionsForSellerSlug } from '../domain/sessions.js';
import { notFound } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
export const router: Router = Router();
const storefront = rateLimit('products', BUDGETS.products);
const slugParam = z.string().min(1).max(80);
router.get('/api/sellers/:slug', storefront, async (req, res, next) => {
    try {
        const parsed = slugParam.safeParse(req.params.slug);
        if (!parsed.success)
            throw notFound('seller_not_found');
        const [row] = await db
            .select({
            id: sellers.id,
            slug: sellers.slug,
            name: sellers.displayName,
            rating: sellers.rating,
            productCount: sql<number> `(select count(*)::int from products p where p.seller_id = sellers.id)`,
        })
            .from(sellers)
            .where(eq(sellers.slug, parsed.data));
        if (!row)
            throw notFound('seller_not_found');
        const seller: SellerPublicDto = {
            id: row.id,
            slug: row.slug,
            name: row.name,
            productCount: Number(row.productCount) || 0,
            rating: Number(row.rating) || 0,
        };
        res.json({ seller, sessions: await listSessionsForSellerSlug(seller.slug) });
    }
    catch (err) {
        next(err);
    }
});
