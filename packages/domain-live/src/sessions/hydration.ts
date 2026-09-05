import type { SessionRow } from './types.js';
import type { LineContext, LiveSessionDto, SessionProductDto } from '@shop/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { hlsOrigin } from '@shop/agora/mediapush.js';
import { db } from '@shop/db/client.js';
import {
    categories,
    liveSessionProducts,
    liveSessions,
    productVariants,
    products,
} from '@shop/db/schema.js';
import { LOW_STOCK_THRESHOLD } from '@shop/domain-commerce/analytics.js';
import { loadActivePromotions, withSessionLiveRule } from '@shop/domain-commerce/promotions.js';
import { env } from '@shop/platform/env.js';
import {
    SAMPLE_LIVE_SOURCE_URL,
    buildPriceLadder,
    evaluatePromotions,
    liveSourceForSlug,
} from '@shop/shared';

import { viewerCount } from './presence.js';

const liveSourceCache = new Map<string, string | null>();
export const liveSourceFor = (row: {
    slug: string;
    sourceVideoUrl: string | null;
}): string | null => {
    if (row.sourceVideoUrl) return row.sourceVideoUrl;
    const cached = liveSourceCache.get(row.slug);
    if (cached !== undefined) return cached;
    let resolved: string | null = null;
    if (existsSync(join(env.RECORDING_LOCAL_DIR, `live-${row.slug}.mp4`))) {
        resolved = liveSourceForSlug(row.slug);
    } else if (existsSync(join(env.RECORDING_LOCAL_DIR, 'live-source.mp4'))) {
        resolved = SAMPLE_LIVE_SOURCE_URL;
    }
    liveSourceCache.set(row.slug, resolved);
    return resolved;
};
const productsForSessions = async (
    sessionIds: string[],
): Promise<Map<string, SessionProductDto[]>> => {
    const grouped = new Map<string, SessionProductDto[]>();
    if (sessionIds.length === 0) return grouped;
    const rows = await db
        .select({
            sessionId: liveSessionProducts.sessionId,
            sessionStatus: liveSessions.status,
            sessionDiscountPercent: liveSessions.discountPercent,
            productId: products.id,
            slug: products.slug,
            title: products.title,
            images: products.images,
            sellerId: products.sellerId,
            categorySlug: categories.slug,
            basePriceMinorUnits: products.basePriceMinorUnits,
            variantPriceMinorUnits: productVariants.priceMinorUnits,
            variantMrpMinorUnits: productVariants.mrpMinorUnits,
            stock: sql<number>`(select coalesce(sum(v.stock), 0)::int
                          from ${productVariants} v where v.product_id = products.id)`,
            isFeatured: liveSessionProducts.isFeatured,
            pinnedAt: liveSessionProducts.pinnedAt,
            sortOrder: liveSessionProducts.sortOrder,
        })
        .from(liveSessionProducts)
        .innerJoin(liveSessions, eq(liveSessions.id, liveSessionProducts.sessionId))
        .innerJoin(products, eq(products.id, liveSessionProducts.productId))
        .innerJoin(categories, eq(categories.id, products.categoryId))
        .leftJoin(
            productVariants,
            and(eq(productVariants.productId, products.id), eq(productVariants.isDefault, true)),
        )
        .where(inArray(liveSessionProducts.sessionId, sessionIds))
        .orderBy(asc(liveSessionProducts.sortOrder));
    const promotions = rows.some((row) => row.sessionStatus === 'live')
        ? await loadActivePromotions()
        : [];
    const now = new Date();
    for (const row of rows) {
        const shopMinorUnits = row.variantPriceMinorUnits ?? row.basePriceMinorUnits;
        const stock = Math.max(0, Number(row.stock) || 0);
        let liveMinorUnits: number | null = null;
        if (row.sessionStatus === 'live') {
            const ctx: LineContext = {
                surface: 'live',
                liveEligible: true,
                liveSessionId: row.sessionId,
                categorySlug: row.categorySlug,
                productId: row.productId,
                sellerId: row.sellerId,
                unitPriceMinorUnits: shopMinorUnits,
                quantity: 1,
                orderSubtotalMinorUnits: 0,
                userSegments: [],
                redemptionsByPromotionId: {},
                now,
            };
            liveMinorUnits = evaluatePromotions(
                withSessionLiveRule(promotions, ctx, row.sessionDiscountPercent),
                ctx,
                env.MAX_TOTAL_DISCOUNT_PCT,
            ).netMinorUnits;
        }
        const list = grouped.get(row.sessionId) ?? [];
        list.push({
            productId: row.productId,
            slug: row.slug,
            title: row.title,
            imageUrl: row.images[0] ?? null,
            price: buildPriceLadder({
                mrpMinorUnits: row.variantMrpMinorUnits,
                shopMinorUnits,
                liveMinorUnits,
            }),
            stock,
            lowStock: stock > 0 && stock <= LOW_STOCK_THRESHOLD,
            isFeatured: row.isFeatured,
            pinnedAt: row.pinnedAt?.toISOString() ?? null,
            sortOrder: row.sortOrder,
        });
        grouped.set(row.sessionId, list);
    }
    return grouped;
};
const toDto = (
    row: SessionRow,
    sessionProducts: SessionProductDto[],
    viewers: number,
): LiveSessionDto => {
    const origin = hlsOrigin(row);
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        description: row.description,
        hostName: row.hostName,
        hostUserId: row.hostUserId,
        coHostUserId: row.coHostUserId,
        coHostName: row.coHostName,
        sellerId: row.sellerId,
        sellerName: row.sellerName,
        status: row.status,
        scheduledFor: row.scheduledFor?.toISOString() ?? null,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        coverImageUrl: row.coverImageUrl,
        language: row.language,
        deliveryTier: row.deliveryTier,
        hlsUrl: origin.hlsUrl,
        hlsOriginKind: origin.hlsOriginKind,
        recordingStatus: row.recordingStatus,
        recordingUrl: row.recordingUrl,
        rttStatus: row.rttStatus,
        transcriptSummary: row.transcriptSummary,
        viewerCount: viewers,
        peakViewers: row.peakViewers,
        sourceVideoUrl: row.sourceVideoUrl,
        discountPercent: row.discountPercent,
        autoStart: row.autoStart,
        liveSourceUrl: liveSourceFor(row),
        serverNowMs: Date.now(),
        products: sessionProducts,
    };
};
export const hydrate = async (rows: SessionRow[]): Promise<LiveSessionDto[]> => {
    const ids = rows.map((r) => r.id);
    const [grouped, counts] = await Promise.all([
        productsForSessions(ids),
        Promise.all(
            rows.map((r) => (r.status === 'live' ? viewerCount(r.id) : Promise.resolve(0))),
        ),
    ]);
    return rows.map((row, i) => toDto(row, grouped.get(row.id) ?? [], counts[i] ?? 0));
};
export const listSessionProducts = async (sessionId: string): Promise<SessionProductDto[]> => {
    const grouped = await productsForSessions([sessionId]);
    return grouped.get(sessionId) ?? [];
};
