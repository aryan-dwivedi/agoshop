import { and, eq } from 'drizzle-orm';
import { EVENTS } from '@shop/shared';
import { db } from '../../db/client.js';
import { liveSessionProducts, liveSessions } from '../../db/schema.js';
import { track } from '../../lib/analytics.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { publishToSession } from '../../lib/sse.js';
import { listSessionProducts } from './hydration.js';
import { getSessionById } from './queries.js';
import { roomRule } from './scheduling.js';
export const pinProduct = async (sessionId: string, productId: string | null) => {
    if (productId !== null) {
        const [attached] = await db
            .select({ productId: liveSessionProducts.productId })
            .from(liveSessionProducts)
            .where(and(eq(liveSessionProducts.sessionId, sessionId), eq(liveSessionProducts.productId, productId)));
        if (!attached)
            throw badRequest('product_not_in_session');
    }
    await db.transaction(async (tx) => {
        await tx
            .update(liveSessionProducts)
            .set({ isFeatured: false, pinnedAt: null })
            .where(eq(liveSessionProducts.sessionId, sessionId));
        if (productId !== null) {
            await tx
                .update(liveSessionProducts)
                .set({ isFeatured: true, pinnedAt: new Date() })
                .where(and(eq(liveSessionProducts.sessionId, sessionId), eq(liveSessionProducts.productId, productId)));
        }
    });
    await publishToSession(sessionId, EVENTS.sessionProductPinned, { sessionId, productId });
    track({ type: 'product_pinned', sessionId, productId });
    return listSessionProducts(sessionId);
};
export const setSessionPricing = async (sessionId: string, discountPercent: number | null) => {
    const normalized = roomRule(discountPercent);
    const updated = await db
        .update(liveSessions)
        .set({ discountPercent: normalized })
        .where(eq(liveSessions.id, sessionId))
        .returning({ id: liveSessions.id });
    if (updated.length === 0)
        throw notFound('session_not_found');
    await publishToSession(sessionId, EVENTS.sessionPricingChanged, {
        sessionId,
        discountPercent: normalized,
    });
    const dto = await getSessionById(sessionId);
    if (!dto)
        throw notFound('session_not_found');
    return dto;
};
