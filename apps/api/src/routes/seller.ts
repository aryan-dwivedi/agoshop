import type { Tx } from '@shop/db/client.js';
import type { Request } from 'express';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '@shop/db/client.js';
import {
    categories,
    liveSessionProducts,
    liveSessions,
    productVariants,
    products,
    sellers,
} from '@shop/db/schema.js';
import {
    LOW_STOCK_THRESHOLD,
    sellerOverview,
    sessionAnalytics,
} from '@shop/domain-commerce/analytics.js';
import { invalidateCatalogCache } from '@shop/domain-commerce/catalog.js';
import { SELLER_ORDERS_DEFAULT_LIMIT, listSellerOrders } from '@shop/domain-commerce/orders.js';
import { listModeration } from '@shop/domain-live/moderation.js';
import { viewerCount } from '@shop/domain-live/sessions.js';
import { badRequest, forbidden, notFound } from '@shop/platform/lib/errors.js';
import { enqueueSearchIndex } from '@shop/platform/lib/searchIndex.js';
import { publishGlobal } from '@shop/platform/lib/sse.js';
import { requireAuth, requireRole } from '@shop/platform/middleware/session.js';
import { EVENTS } from '@shop/shared';

export const router = Router();
type Scope = {
    sellerIds: string[];
    primaryId: string;
    visible: {
        id: string;
        slug: string;
        displayName: string;
    }[];
};
const resolveScope = async (req: Request): Promise<Scope> => {
    const session = req.session;
    if (!session) throw forbidden('forbidden');
    const rows = await db
        .select({
            id: sellers.id,
            slug: sellers.slug,
            displayName: sellers.displayName,
            ownerUserId: sellers.ownerUserId,
        })
        .from(sellers)
        .orderBy(sellers.createdAt);
    const visible =
        session.role === 'admin' ? rows : rows.filter((s) => s.ownerUserId === session.userId);
    if (visible.length === 0) throw notFound('no_seller_profile');
    const requested = typeof req.query.sellerId === 'string' ? req.query.sellerId : null;
    if (requested) {
        const match = visible.find((s) => s.id === requested);
        if (!match) throw forbidden('seller_not_owned');
        return {
            sellerIds: [match.id],
            primaryId: match.id,
            visible: visible.map((s) => ({
                id: s.id,
                slug: s.slug,
                displayName: s.displayName,
            })),
        };
    }
    return {
        sellerIds: visible.map((s) => s.id),
        primaryId: visible[0]!.id,
        visible: visible.map((s) => ({
            id: s.id,
            slug: s.slug,
            displayName: s.displayName,
        })),
    };
};
const requireScopedSession = async (req: Request, scope: Scope): Promise<string> => {
    const parsed = z.string().uuid().safeParse(req.params.id);
    if (!parsed.success) throw badRequest('invalid_session_id');
    const sessionId = parsed.data;
    const [row] = await db
        .select({ sellerId: liveSessions.sellerId })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row) throw notFound('session_not_found');
    if (!scope.visible.some((s) => s.id === row.sellerId)) throw forbidden('session_not_owned');
    return sessionId;
};
const guards = [requireAuth, requireRole('seller', 'admin')] as const;
router.get('/api/seller/overview', ...guards, async (req, res, next) => {
    try {
        const scope = await resolveScope(req);
        const overview = await sellerOverview(scope.primaryId);
        res.json({
            ...overview,
            sellerId: scope.primaryId,
            sellers: scope.visible,
        });
    } catch (err) {
        next(err);
    }
});
const ordersQuery = z.object({
    limit: z.coerce.number().int().positive().max(500).optional(),
});
router.get('/api/seller/orders', ...guards, async (req, res, next) => {
    try {
        const parsed = ordersQuery.safeParse(req.query);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid order query', {
                issues: parsed.error.issues,
            });
        }
        const scope = await resolveScope(req);
        const orders = await listSellerOrders(
            scope.sellerIds,
            parsed.data.limit ?? SELLER_ORDERS_DEFAULT_LIMIT,
        );
        res.json({ sellerId: scope.primaryId, sellers: scope.visible, orders });
    } catch (err) {
        next(err);
    }
});
router.get('/api/seller/sessions', ...guards, async (req, res, next) => {
    try {
        const scope = await resolveScope(req);
        const rows = await db
            .select({
                id: liveSessions.id,
                slug: liveSessions.slug,
                title: liveSessions.title,
                status: liveSessions.status,
                scheduledFor: liveSessions.scheduledFor,
                startedAt: liveSessions.startedAt,
                endedAt: liveSessions.endedAt,
                expectedPeakViewers: liveSessions.expectedPeakViewers,
                chatShardCount: liveSessions.chatShardCount,
                deliveryTier: liveSessions.deliveryTier,
                recordingStatus: liveSessions.recordingStatus,
                recordingUrl: liveSessions.recordingUrl,
                peakViewers: liveSessions.peakViewers,
                productCount: sql<number>`(select count(*)::int from ${liveSessionProducts} where ${liveSessionProducts.sessionId} = ${liveSessions.id})`,
            })
            .from(liveSessions)
            .where(inArray(liveSessions.sellerId, scope.sellerIds))
            .orderBy(
                sql`coalesce(${liveSessions.startedAt}, ${liveSessions.scheduledFor}, ${liveSessions.createdAt}) desc`,
            );
        const enriched = await Promise.all(
            rows.map(async (row) => {
                const [analytics, viewers] = await Promise.all([
                    sessionAnalytics(row.id),
                    row.status === 'live' ? viewerCount(row.id) : Promise.resolve(0),
                ]);
                return {
                    id: row.id,
                    slug: row.slug,
                    title: row.title,
                    status: row.status,
                    scheduledFor: row.scheduledFor?.toISOString() ?? null,
                    startedAt: row.startedAt?.toISOString() ?? null,
                    endedAt: row.endedAt?.toISOString() ?? null,
                    expectedPeakViewers: row.expectedPeakViewers,
                    chatShardCount: row.chatShardCount,
                    deliveryTier: row.deliveryTier,
                    recordingStatus: row.recordingStatus,
                    recordingUrl: row.recordingUrl,
                    peakViewers: row.peakViewers,
                    viewerCount: viewers,
                    productCount: row.productCount,
                    orders: analytics.orders,
                    gmvMinorUnits: analytics.gmvMinorUnits,
                };
            }),
        );
        res.json({
            sessions: enriched,
            sellerId: scope.primaryId,
            sellers: scope.visible,
        });
    } catch (err) {
        next(err);
    }
});
router.get('/api/seller/sessions/:id/analytics', ...guards, async (req, res, next) => {
    try {
        const scope = await resolveScope(req);
        const sessionId = await requireScopedSession(req, scope);
        res.json(await sessionAnalytics(sessionId));
    } catch (err) {
        next(err);
    }
});
router.get('/api/seller/sessions/:id/moderation', ...guards, async (req, res, next) => {
    try {
        const scope = await resolveScope(req);
        const sessionId = await requireScopedSession(req, scope);
        const entries = await listModeration(sessionId);
        res.json({
            entries: entries.map((e) => ({
                id: e.id,
                action: e.action,
                targetUserId: e.targetUserId,
                targetDisplayName: e.targetUserName,
                targetMessageId: e.targetMessageId,
                targetMessageText: e.targetMessageText,
                actorUserId: e.actorUserId,
                actorDisplayName: e.actorUserName,
                createdAt: e.createdAt,
            })),
        });
    } catch (err) {
        next(err);
    }
});
type SellerProductRow = {
    productId: string;
    slug: string;
    title: string;
    brand: string;
    categorySlug: string;
    images: string[];
    rating: number;
    sellerId: string;
};
type SellerVariantRow = {
    id: string;
    sku: string;
    label: string;
    priceMinorUnits: number;
    mrpMinorUnits: number | null;
    stock: number;
    isDefault: boolean;
};
type ProductShow = {
    id: string;
    slug: string;
    title: string;
    status: 'scheduled' | 'live';
};
type SellerProduct = {
    productId: string;
    slug: string;
    title: string;
    brand: string;
    categorySlug: string;
    imageUrl: string | null;
    rating: number;
    sellerId: string;
    priceMinorUnits: number;
    totalStock: number;
    lowStock: boolean;
    inShows: ProductShow[];
    variants: SellerVariantRow[];
};
const toSellerProduct = (
    row: SellerProductRow,
    variants: SellerVariantRow[],
    inShows: ProductShow[] = [],
): SellerProduct => {
    const totalStock = variants.reduce((sum, v) => sum + v.stock, 0);
    return {
        productId: row.productId,
        slug: row.slug,
        title: row.title,
        brand: row.brand,
        categorySlug: row.categorySlug,
        imageUrl: row.images[0] ?? null,
        rating: row.rating,
        sellerId: row.sellerId,
        priceMinorUnits: variants.reduce(
            (min, v) => (min === 0 ? v.priceMinorUnits : Math.min(min, v.priceMinorUnits)),
            0,
        ),
        totalStock,
        lowStock: totalStock <= LOW_STOCK_THRESHOLD,
        inShows,
        variants: variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            label: v.label,
            priceMinorUnits: v.priceMinorUnits,
            mrpMinorUnits: v.mrpMinorUnits,
            stock: v.stock,
            isDefault: v.isDefault,
        })),
    };
};
router.get('/api/seller/products', ...guards, async (req, res, next) => {
    try {
        const scope = await resolveScope(req);
        const rows = await db
            .select({
                productId: products.id,
                slug: products.slug,
                title: products.title,
                brand: products.brand,
                rating: products.rating,
                images: products.images,
                sellerId: products.sellerId,
                categorySlug: sql<string>`(select slug from categories where categories.id = ${products.categoryId})`,
            })
            .from(products)
            .where(inArray(products.sellerId, scope.sellerIds))
            .orderBy(products.title);
        const productIds = rows.map((r) => r.productId);
        const variantRows =
            productIds.length === 0
                ? []
                : await db
                      .select({
                          id: productVariants.id,
                          productId: productVariants.productId,
                          sku: productVariants.sku,
                          label: productVariants.label,
                          priceMinorUnits: productVariants.priceMinorUnits,
                          mrpMinorUnits: productVariants.mrpMinorUnits,
                          stock: productVariants.stock,
                          isDefault: productVariants.isDefault,
                      })
                      .from(productVariants)
                      .where(inArray(productVariants.productId, productIds))
                      .orderBy(productVariants.sku);
        const variantsByProduct = new Map<string, typeof variantRows>();
        for (const variant of variantRows) {
            const list = variantsByProduct.get(variant.productId) ?? [];
            list.push(variant);
            variantsByProduct.set(variant.productId, list);
        }
        const showRows =
            productIds.length === 0
                ? []
                : await db
                      .select({
                          productId: liveSessionProducts.productId,
                          id: liveSessions.id,
                          slug: liveSessions.slug,
                          title: liveSessions.title,
                          status: liveSessions.status,
                      })
                      .from(liveSessionProducts)
                      .innerJoin(liveSessions, eq(liveSessions.id, liveSessionProducts.sessionId))
                      .where(
                          and(
                              inArray(liveSessionProducts.productId, productIds),
                              inArray(liveSessions.status, ['scheduled', 'live']),
                          ),
                      )
                      .orderBy(
                          sql`coalesce(${liveSessions.scheduledFor}, ${liveSessions.createdAt}) asc`,
                      );
        const showsByProduct = new Map<string, ProductShow[]>();
        for (const show of showRows) {
            if (show.status !== 'scheduled' && show.status !== 'live') continue;
            const list = showsByProduct.get(show.productId) ?? [];
            list.push({
                id: show.id,
                slug: show.slug,
                title: show.title,
                status: show.status,
            });
            showsByProduct.set(show.productId, list);
        }
        res.json({
            lowStockThreshold: LOW_STOCK_THRESHOLD,
            sellerId: scope.primaryId,
            sellers: scope.visible,
            products: rows.map((row) =>
                toSellerProduct(
                    row,
                    variantsByProduct.get(row.productId) ?? [],
                    showsByProduct.get(row.productId) ?? [],
                ),
            ),
        });
    } catch (err) {
        next(err);
    }
});
const variantPatchBody = z
    .object({
        priceMinorUnits: z.number().int().positive(),
        mrpMinorUnits: z.number().int().positive().nullable(),
        stock: z.number().int().min(0),
    })
    .partial();
router.patch(
    '/api/seller/products/:productId/variants/:variantId',
    ...guards,
    async (req, res, next) => {
        try {
            const productId = z.string().uuid().safeParse(req.params.productId);
            if (!productId.success) throw badRequest('invalid_product_id');
            const variantId = z.string().uuid().safeParse(req.params.variantId);
            if (!variantId.success) throw badRequest('invalid_variant_id');
            const parsed = variantPatchBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            if (Object.keys(parsed.data).length === 0) throw badRequest('nothing_to_update');
            const scope = await resolveScope(req);
            const [product] = await db
                .select({ sellerId: products.sellerId })
                .from(products)
                .where(eq(products.id, productId.data));
            if (!product) throw notFound('product_not_found');
            if (!scope.visible.some((s) => s.id === product.sellerId))
                throw forbidden('seller_not_owned');
            const [current] = await db
                .select({
                    id: productVariants.id,
                    priceMinorUnits: productVariants.priceMinorUnits,
                    mrpMinorUnits: productVariants.mrpMinorUnits,
                })
                .from(productVariants)
                .where(
                    and(
                        eq(productVariants.id, variantId.data),
                        eq(productVariants.productId, productId.data),
                    ),
                );
            if (!current) throw notFound('variant_not_found');
            const priceMinorUnits = parsed.data.priceMinorUnits ?? current.priceMinorUnits;
            const mrpMinorUnits =
                parsed.data.mrpMinorUnits === undefined
                    ? current.mrpMinorUnits
                    : parsed.data.mrpMinorUnits;
            if (mrpMinorUnits !== null && mrpMinorUnits <= priceMinorUnits) {
                throw badRequest('mrp_below_price', 'MRP must be strictly above the selling price');
            }
            const [updated] = await db
                .update(productVariants)
                .set({
                    priceMinorUnits,
                    mrpMinorUnits,
                    ...(parsed.data.stock === undefined ? {} : { stock: parsed.data.stock }),
                })
                .where(eq(productVariants.id, variantId.data))
                .returning({
                    id: productVariants.id,
                    sku: productVariants.sku,
                    label: productVariants.label,
                    priceMinorUnits: productVariants.priceMinorUnits,
                    mrpMinorUnits: productVariants.mrpMinorUnits,
                    stock: productVariants.stock,
                    isDefault: productVariants.isDefault,
                });
            if (!updated) throw notFound('variant_not_found');
            await invalidateCatalogCache();
            enqueueSearchIndex(productId.data);
            await publishGlobal(EVENTS.catalogPriceChanged, {
                productId: productId.data,
                variantId: variantId.data,
            });
            res.json({ variant: updated });
        } catch (err) {
            next(err);
        }
    },
);
const productCreateBody = z.object({
    sellerId: z.string().uuid().optional(),
    title: z.string().trim().min(3).max(140),
    brand: z.string().trim().min(1).max(80),
    description: z.string().trim().min(10).max(4000),
    categorySlug: z.string().trim().min(1).max(80),
    images: z.array(z.string().trim().min(1).max(2048)).max(8).default([]),
    highlights: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
    specs: z.record(z.string()).default({}),
    variants: z
        .array(
            z.object({
                label: z.string().trim().min(1).max(80),
                sku: z.string().trim().min(3).max(64).optional(),
                priceMinorUnits: z.number().int().positive(),
                mrpMinorUnits: z.number().int().positive().nullable().optional(),
                stock: z.number().int().min(0),
                isDefault: z.boolean().optional(),
            }),
        )
        .min(1)
        .max(12),
});
const slugify = (title: string): string =>
    title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
const claimProductSlug = async (tx: Tx, title: string): Promise<string> => {
    const base = slugify(title) || 'product';
    for (let attempt = 1; ; attempt += 1) {
        const candidate = attempt === 1 ? base : `${base}-${attempt}`;
        const [taken] = await tx
            .select({ slug: products.slug })
            .from(products)
            .where(eq(products.slug, candidate));
        if (!taken) return candidate;
    }
};
const deriveSku = (slug: string, index: number): string => `${slug}-${index + 1}`.toUpperCase();
const UNIQUE_VIOLATION = '23505';
const driverErrorCode = (err: unknown): string | null => {
    if (typeof err !== 'object' || err === null) return null;
    const code: unknown = Reflect.get(err, 'code');
    return typeof code === 'string' ? code : null;
};
router.post('/api/seller/products', ...guards, async (req, res, next) => {
    try {
        const parsed = productCreateBody.safeParse(req.body);
        if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
        const body = parsed.data;
        const scope = await resolveScope(req);
        const sellerId = body.sellerId ?? scope.primaryId;
        if (!scope.visible.some((s) => s.id === sellerId)) throw forbidden('seller_not_owned');
        const [category] = await db
            .select({ id: categories.id, slug: categories.slug })
            .from(categories)
            .where(eq(categories.slug, body.categorySlug));
        if (!category) throw badRequest('unknown_category', `No category ${body.categorySlug}`);
        const flagged = body.variants.filter((v) => v.isDefault === true).length;
        if (flagged > 1) {
            throw badRequest('invalid_body', 'Only one variant can be the default');
        }
        const defaultIndex =
            flagged === 1 ? body.variants.findIndex((v) => v.isDefault === true) : 0;
        for (const variant of body.variants) {
            const mrpMinorUnits = variant.mrpMinorUnits ?? null;
            if (mrpMinorUnits !== null && mrpMinorUnits <= variant.priceMinorUnits) {
                throw badRequest('mrp_below_price', 'MRP must be strictly above the selling price');
            }
        }
        const product = await db
            .transaction(async (tx) => {
                const slug = await claimProductSlug(tx, body.title);
                const skus = body.variants.map((v, index) => v.sku ?? deriveSku(slug, index));
                if (new Set(skus).size !== skus.length) {
                    throw badRequest('sku_taken', 'Each variant needs its own SKU');
                }
                const clashes = await tx
                    .select({ sku: productVariants.sku })
                    .from(productVariants)
                    .where(inArray(productVariants.sku, skus));
                if (clashes.length > 0) {
                    throw badRequest('sku_taken', `SKU ${clashes[0]!.sku} is already in use`);
                }
                const [row] = await tx
                    .insert(products)
                    .values({
                        slug,
                        categoryId: category.id,
                        sellerId,
                        title: body.title,
                        brand: body.brand,
                        description: body.description,
                        highlights: body.highlights,
                        specs: body.specs,
                        images: body.images,
                        rating: 0,
                        ratingCount: 0,
                        basePriceMinorUnits: Math.min(
                            ...body.variants.map((v) => v.priceMinorUnits),
                        ),
                    })
                    .returning({
                        productId: products.id,
                        slug: products.slug,
                        title: products.title,
                        brand: products.brand,
                        rating: products.rating,
                        images: products.images,
                        sellerId: products.sellerId,
                    });
                if (!row) throw notFound('product_not_found');
                const variants = await tx
                    .insert(productVariants)
                    .values(
                        body.variants.map((variant, index) => ({
                            productId: row.productId,
                            sku: skus[index]!,
                            label: variant.label,
                            priceMinorUnits: variant.priceMinorUnits,
                            mrpMinorUnits: variant.mrpMinorUnits ?? null,
                            stock: variant.stock,
                            isDefault: index === defaultIndex,
                        })),
                    )
                    .returning({
                        id: productVariants.id,
                        sku: productVariants.sku,
                        label: productVariants.label,
                        priceMinorUnits: productVariants.priceMinorUnits,
                        mrpMinorUnits: productVariants.mrpMinorUnits,
                        stock: productVariants.stock,
                        isDefault: productVariants.isDefault,
                    });
                return toSellerProduct({ ...row, categorySlug: category.slug }, variants);
            })
            .catch((err: unknown) => {
                if (driverErrorCode(err) === UNIQUE_VIOLATION) {
                    throw badRequest('sku_taken', 'That SKU is already in use');
                }
                throw err;
            });
        await invalidateCatalogCache();
        enqueueSearchIndex(product.productId);
        await publishGlobal(EVENTS.catalogPriceChanged, {
            productId: product.productId,
            variantId: product.variants.find((v) => v.isDefault)?.id ?? product.variants[0]!.id,
        });
        res.status(201).json({ product });
    } catch (err) {
        next(err);
    }
});
