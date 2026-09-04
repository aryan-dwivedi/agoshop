import { and, eq, inArray } from 'drizzle-orm';
import { liveChannelForSlug } from '@shop/shared';
import type { Role } from '@shop/shared';
import { db } from '../../db/client.js';
import { liveSessionProducts, liveSessions, products, sellers } from '../../db/schema.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { getSessionById, listSessionProducts } from './queries.js';
import type { CreateSessionInput, SessionActor, UpdateSessionInput } from './types.js';
import { SLUG_PATTERN } from './types.js';
const resolveSeller = async (actor: {
    userId: string;
    role: Role;
}, explicitSellerId?: string): Promise<string> => {
    if (explicitSellerId) {
        const [row] = await db
            .select({ id: sellers.id, ownerUserId: sellers.ownerUserId })
            .from(sellers)
            .where(eq(sellers.id, explicitSellerId));
        if (!row)
            throw notFound('seller_not_found');
        if (actor.role !== 'admin' && row.ownerUserId !== actor.userId) {
            throw conflict('not_seller_owner');
        }
        return row.id;
    }
    const [owned] = await db
        .select({ id: sellers.id })
        .from(sellers)
        .where(eq(sellers.ownerUserId, actor.userId));
    if (!owned)
        throw badRequest('no_seller_profile', 'this account owns no seller profile');
    return owned.id;
};
export const roomRule = (percent: number | null | undefined): number | null => percent === null || percent === undefined || percent <= 0
    ? null
    : Math.min(90, Math.trunc(percent));
export const createSession = async (actor: SessionActor, input: CreateSessionInput) => {
    const title = input.title.trim();
    if (title.length === 0)
        throw badRequest('title_required');
    let slug = input.slug?.trim().toLowerCase() ?? '';
    if (slug.length > 0) {
        if (!SLUG_PATTERN.test(slug))
            throw badRequest('invalid_slug');
        const [taken] = await db
            .select({ id: liveSessions.id })
            .from(liveSessions)
            .where(eq(liveSessions.slug, slug));
        if (taken)
            throw conflict('slug_taken');
    }
    else {
        const base = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'session';
        slug = base;
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const [taken] = await db
                .select({ id: liveSessions.id })
                .from(liveSessions)
                .where(eq(liveSessions.slug, slug));
            if (!taken)
                break;
            slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        }
    }
    const sellerId = await resolveSeller(actor, input.sellerId);
    const expected = Math.max(1, Math.trunc(input.expectedPeakViewers ?? 50));
    const [row] = await db
        .insert(liveSessions)
        .values({
        slug,
        sellerId,
        title,
        description: input.description ?? '',
        hostName: input.hostName?.trim() || actor.displayName,
        hostUserId: actor.userId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
        rtcChannel: liveChannelForSlug(slug),
        coverImageUrl: input.coverImageUrl ?? null,
        language: input.language ?? 'en-US',
        expectedPeakViewers: expected,
        autoStart: input.autoStart ?? false,
        discountPercent: roomRule(input.discountPercent),
    })
        .returning({ id: liveSessions.id });
    if (!row)
        throw conflict('session_not_created');
    const dto = await getSessionById(row.id);
    if (!dto)
        throw conflict('session_not_created');
    return dto;
};
export const updateSession = async (sessionId: string, input: UpdateSessionInput) => {
    const patch: Partial<typeof liveSessions.$inferInsert> = {};
    if (input.title !== undefined)
        patch.title = input.title.trim();
    if (input.description !== undefined)
        patch.description = input.description;
    if (input.hostName !== undefined)
        patch.hostName = input.hostName.trim();
    if (input.scheduledFor !== undefined) {
        patch.scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;
    }
    if (input.language !== undefined)
        patch.language = input.language;
    if (input.coverImageUrl !== undefined)
        patch.coverImageUrl = input.coverImageUrl;
    if (input.expectedPeakViewers !== undefined) {
        patch.expectedPeakViewers = Math.max(1, Math.trunc(input.expectedPeakViewers));
    }
    if (input.autoStart !== undefined)
        patch.autoStart = input.autoStart;
    if (Object.keys(patch).length === 0)
        throw badRequest('nothing_to_update');
    const updated = await db
        .update(liveSessions)
        .set(patch)
        .where(eq(liveSessions.id, sessionId))
        .returning({ id: liveSessions.id });
    if (updated.length === 0)
        throw notFound('session_not_found');
    const dto = await getSessionById(sessionId);
    if (!dto)
        throw notFound('session_not_found');
    return dto;
};
export const setSessionProducts = async (sessionId: string, items: {
    productId: string;
    sortOrder?: number;
    isFeatured?: boolean;
}[]) => {
    const [session] = await db
        .select({ status: liveSessions.status })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!session)
        throw notFound('session_not_found');
    if (session.status === 'ended')
        throw conflict('session_ended');
    if (items.length === 0)
        throw badRequest('no_products');
    if (items.filter((i) => i.isFeatured).length > 1)
        throw badRequest('multiple_featured');
    const ids = items.map((i) => i.productId);
    const known = await db
        .select({ id: products.id })
        .from(products)
        .where(inArray(products.id, ids));
    if (known.length !== new Set(ids).size)
        throw badRequest('unknown_product');
    const ordered = items.map((item, index) => ({
        productId: item.productId,
        sortOrder: item.sortOrder ?? index,
        isFeatured: item.isFeatured ?? false,
    }));
    ordered.sort((a, b) => a.sortOrder - b.sortOrder);
    if (!ordered.some((i) => i.isFeatured) && ordered[0])
        ordered[0].isFeatured = true;
    await db.transaction(async (tx) => {
        await tx.delete(liveSessionProducts).where(eq(liveSessionProducts.sessionId, sessionId));
        await tx.insert(liveSessionProducts).values(ordered.map((item) => ({
            sessionId,
            productId: item.productId,
            sortOrder: item.sortOrder,
            isFeatured: item.isFeatured,
        })));
    });
    return listSessionProducts(sessionId);
};
