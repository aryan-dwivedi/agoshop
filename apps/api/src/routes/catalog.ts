import type { ProductQuery } from '@shop/domain-commerce/catalog.js';
import type { RecommendationBasis } from '@shop/domain-commerce/recommendations.js';

import { Router } from 'express';
import { z } from 'zod';

import {
    compareProducts,
    getProductBySlug,
    listCategories,
    listProductsPage,
    recordProductView,
} from '@shop/domain-commerce/catalog.js';
import { recommend } from '@shop/domain-commerce/recommendations.js';
import { searchCatalog } from '@shop/domain-commerce/searchBridge.js';
import { track } from '@shop/platform/lib/analytics.js';
import { badRequest, notFound } from '@shop/platform/lib/errors.js';
import { BUDGETS, rateLimit } from '@shop/platform/lib/ratelimit.js';

export const router = Router();
const products = rateLimit('products', BUDGETS.products);
const listQuery = z.object({
    categoryId: z.string().uuid().optional(),
    category: z.string().min(1).max(80).optional(),
    q: z.string().min(1).max(120).optional(),
    maxPriceMinorUnits: z.coerce.number().int().positive().optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    sellerId: z.string().uuid().optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'rating']).optional(),
    page: z.coerce.number().int().positive().optional(),
    pageSize: z.coerce.number().int().positive().max(48).optional(),
    includeFacets: z
        .enum(['0', '1', 'false', 'true'])
        .optional()
        .transform((value) => value !== '0' && value !== 'false'),
});
const recommendQuery = z.object({
    basedOn: z.enum(['recently_viewed', 'wishlist', 'similar']).optional(),
    productId: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(24).optional(),
});
const pathSlug = (value: string | string[] | undefined): string => {
    const parsed = z.string().min(1).max(140).safeParse(value);
    if (!parsed.success) throw notFound('product_not_found');
    return parsed.data;
};
router.get('/api/categories', products, async (_req, res, next) => {
    try {
        res.json({ categories: await listCategories() });
    } catch (err) {
        next(err);
    }
});
router.get('/api/products', products, async (req, res, next) => {
    try {
        const parsed = listQuery.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid product query', {
                issues: parsed.error.issues,
            });
        }
        const { category, includeFacets, ...rest } = parsed.data;
        const query: ProductQuery = { ...rest, categorySlug: category };
        const useSearch = Boolean(query.q) && (!query.sort || query.sort === 'relevance');
        const page = await listProductsPage(query, {
            includeFacets,
            list: useSearch
                ? () =>
                      searchCatalog({
                          q: query.q!,
                          categorySlug: query.categorySlug,
                          maxPriceMinorUnits: query.maxPriceMinorUnits,
                          minRating: query.minRating,
                          sort: query.sort ?? 'relevance',
                          page: query.page,
                          pageSize: query.pageSize,
                      })
                : undefined,
        });
        res.json({
            items: page.items,
            total: page.total,
            page: page.page,
            pageSize: page.pageSize,
            facets: page.facets,
        });
    } catch (err) {
        next(err);
    }
});
router.get('/api/products/compare', products, async (req, res, next) => {
    try {
        const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
        const ids = raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        if (ids.length < 2 || ids.length > 4) {
            throw badRequest('invalid_compare_ids', 'compare needs between 2 and 4 product ids');
        }
        res.json(await compareProducts(ids));
    } catch (err) {
        next(err);
    }
});
router.get('/api/recommendations', products, async (req, res, next) => {
    try {
        const parsed = recommendQuery.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid recommendation query', {
                issues: parsed.error.issues,
            });
        }
        const basedOn: RecommendationBasis | undefined = parsed.data.basedOn;
        res.json({
            items: await recommend({
                userId: req.session?.userId ?? null,
                basedOn,
                productId: parsed.data.productId,
                limit: parsed.data.limit,
            }),
        });
    } catch (err) {
        next(err);
    }
});
router.get('/api/products/:slug', products, async (req, res, next) => {
    try {
        const product = await getProductBySlug(pathSlug(req.params.slug));
        if (!product) throw notFound('product_not_found');
        const userId = req.session?.userId ?? null;
        await recordProductView(product.id, userId);
        track({ type: 'product_view', userId, productId: product.id });
        res.json({ product });
    } catch (err) {
        next(err);
    }
});
