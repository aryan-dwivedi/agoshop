import { Router } from 'express';
import { z } from 'zod';

import { track } from '../lib/analytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import {
  compareProducts,
  getProductBySlug,
  listCategories,
  listProducts,
  productFacets,
  recordProductView,
  type ProductQuery,
} from '../domain/catalog.js';
import { searchCatalog } from '../domain/searchBridge.js';
import { recommend, type RecommendationBasis } from '../domain/recommendations.js';

/**
 * Public catalog reads. Rate limited per user when authenticated and per IP otherwise
 * (trusted CIDRs skipped), so the load generator measures the API and not the limiter.
 */
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
});

const recommendQuery = z.object({
  basedOn: z.enum(['recently_viewed', 'wishlist', 'similar']).optional(),
  productId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(24).optional(),
});

/** Express types a path param as `string | string[]`; a product slug is one string. */
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
    const { category, ...rest } = parsed.data;
    const query: ProductQuery = { ...rest, categorySlug: category };
    const listPage =
      query.q && (!query.sort || query.sort === 'relevance')
        ? await searchCatalog({
            q: query.q,
            categorySlug: query.categorySlug,
            maxPriceMinorUnits: query.maxPriceMinorUnits,
            minRating: query.minRating,
            sort: query.sort ?? 'relevance',
            page: query.page,
            pageSize: query.pageSize,
          })
        : await listProducts(query);
    const [page, facets] = await Promise.all([listPage, productFacets(query)]);
    res.json({
      items: page.items,
      total: page.total,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 12,
      facets,
    });
  } catch (err) {
    next(err);
  }
});

// Must precede /api/products/:slug — otherwise "compare" is read as a slug.
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
