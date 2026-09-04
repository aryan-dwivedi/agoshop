import { sql } from 'drizzle-orm';
import { evaluatePromotions, type AppliedPromotion, type LineContext, type LiveOffer, type Promotion, type PromotionCondition, type Surface, type SuppressedPromotion, } from '@shop/shared';
import { db } from '../db/client.js';
import { env } from '../env.js';
import { keys, redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { defaultVariantId, resolveLineContext, type Executor } from './eligibility.js';
type PromotionRow = {
    id: string;
    code: string;
    label: string;
    kind: 'percent' | 'flat';
    value: number;
    priority: number;
    stackable: boolean;
    conditions: PromotionCondition | null;
    valid_from: string | null;
    valid_until: string | null;
    active: boolean;
};
const toPromotion = (r: PromotionRow): Promotion => ({
    id: r.id,
    code: r.code,
    label: r.label,
    kind: r.kind,
    value: r.value,
    priority: r.priority,
    stackable: r.stackable,
    conditions: r.conditions ?? {},
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    active: r.active,
});
const SELECT_ACTIVE = sql `
  select id, code, label, kind::text as kind, value, priority, stackable, conditions,
         valid_from, valid_until, active
  from promotions
  where active = true
  order by priority desc, code asc`;
export const loadActivePromotions = async (exec?: Executor): Promise<Promotion[]> => {
    if (exec) {
        const { rows } = await exec.execute<PromotionRow>(SELECT_ACTIVE);
        return rows.map(toPromotion);
    }
    try {
        const hit = await redis.get(keys.promotionsCache);
        if (hit !== null)
            return JSON.parse(hit) as Promotion[];
    }
    catch (err) {
        logger.warn({ err }, 'promotion cache read failed; loading from postgres');
    }
    const { rows } = await db.execute<PromotionRow>(SELECT_ACTIVE);
    const promotions = rows.map(toPromotion);
    try {
        await redis.set(keys.promotionsCache, JSON.stringify(promotions), 'EX', 30);
    }
    catch (err) {
        logger.warn({ err }, 'promotion cache write failed');
    }
    return promotions;
};
export const invalidatePromotionsCache = async (): Promise<void> => {
    await redis.del(keys.promotionsCache);
};
export const promotionIdsByCode = (promotions: Promotion[]): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const p of promotions)
        out[p.code] = p.id;
    return out;
};
export const isLiveRule = (p: Promotion): boolean => p.conditions.requiresLiveSession === true;
export const sessionLivePromotion = (sessionId: string, discountPercent: number): Promotion => ({
    id: `live-session-${sessionId}`,
    code: 'LIVE_SESSION',
    label: 'Live session price',
    kind: 'percent',
    value: discountPercent,
    priority: 1000,
    stackable: false,
    active: true,
    conditions: { requiresLiveSession: true },
    validFrom: null,
    validUntil: null,
});
export const withSessionLiveRule = (promotions: Promotion[], ctx: LineContext, discountPercent: number | null): Promotion[] => ctx.liveEligible && ctx.liveSessionId !== null && discountPercent !== null && discountPercent > 0
    ? [...promotions, sessionLivePromotion(ctx.liveSessionId, discountPercent)]
    : promotions;
type SessionProductRow = {
    product_id: string;
    is_featured: boolean;
    sort_order: number;
};
const sessionProducts = async (sessionId: string): Promise<SessionProductRow[]> => {
    const { rows } = await db.execute<SessionProductRow>(sql `
    select product_id, is_featured, sort_order
    from live_session_products
    where session_id = cast(${sessionId} as uuid)
    order by is_featured desc, sort_order asc
  `);
    return rows;
};
export const resolveLiveOffer = async (a: {
    userId: string;
    liveSessionId: string | null;
    productId?: string | null;
    surface: Surface;
}): Promise<LiveOffer> => {
    const inactive = (reason: string, eligibleProductIds: string[] = []): LiveOffer => ({
        active: false,
        kind: null,
        value: null,
        effectiveDiscountMinorUnits: 0,
        eligibleProductIds,
        reason,
    });
    if (!a.liveSessionId)
        return inactive('no_live_session');
    if (a.surface !== 'live')
        return inactive('not_a_live_surface');
    const [promotions, attached, room] = await Promise.all([
        loadActivePromotions(),
        sessionProducts(a.liveSessionId),
        db.execute<{
            discount_percent: number | null;
        }>(sql `select discount_percent from live_sessions where id = cast(${a.liveSessionId} as uuid)`),
    ]);
    const roomRule = room.rows[0]?.discount_percent ?? null;
    if (!promotions.some(isLiveRule) && roomRule === null) {
        return inactive('no_live_promotion_configured');
    }
    if (attached.length === 0)
        return inactive('session_has_no_products');
    const candidatePool = roomRule === null
        ? promotions
        : [...promotions, sessionLivePromotion(a.liveSessionId, roomRule)];
    const liveCodes = candidatePool.filter(isLiveRule).map((p) => p.code);
    const now = new Date();
    const contextProductId = (a.productId && attached.some((p) => p.product_id === a.productId) ? a.productId : null) ??
        attached[0]?.product_id ??
        null;
    const eligibleProductIds: string[] = [];
    let contextApplied: AppliedPromotion[] = [];
    let contextSuppressed: SuppressedPromotion[] = [];
    let contextPromotion: Promotion | null = null;
    let contextDiscount = 0;
    let sessionLive = false;
    for (const row of attached) {
        const variantId = await defaultVariantId(row.product_id);
        if (!variantId)
            continue;
        const resolved = await resolveLineContext(a.userId, {
            variantId,
            quantity: 1,
            surface: 'live',
            liveSessionId: a.liveSessionId,
            orderSubtotalMinorUnits: 0,
        }, now);
        sessionLive = sessionLive || resolved.ctx.liveEligible;
        const evaluation = evaluatePromotions(withSessionLiveRule(promotions, resolved.ctx, roomRule), resolved.ctx, env.MAX_TOTAL_DISCOUNT_PCT);
        const appliedLive = evaluation.applied.filter((ap) => liveCodes.includes(ap.code));
        if (appliedLive.length > 0)
            eligibleProductIds.push(row.product_id);
        if (row.product_id === contextProductId) {
            contextApplied = evaluation.applied;
            contextSuppressed = evaluation.suppressed;
            const best = appliedLive.reduce<AppliedPromotion | null>((acc, ap) => (acc === null || ap.minorUnits > acc.minorUnits ? ap : acc), null);
            if (best) {
                contextDiscount = best.minorUnits;
                contextPromotion = candidatePool.find((p) => p.code === best.code) ?? null;
            }
        }
    }
    if (!sessionLive)
        return inactive('session_not_live');
    if (!contextPromotion) {
        const suppressed = contextSuppressed.find((s) => liveCodes.includes(s.code));
        const reason = suppressed
            ? `live_promotion_${suppressed.reason}`
            : contextApplied.length > 0
                ? 'other_promotion_won'
                : 'conditions_not_met';
        return inactive(reason, eligibleProductIds);
    }
    return {
        active: true,
        kind: contextPromotion.kind,
        value: contextPromotion.value,
        effectiveDiscountMinorUnits: contextDiscount,
        eligibleProductIds,
        reason: contextPromotion.code,
    };
};
type CartLineRow = {
    variant_id: string;
    quantity: number;
    live_session_id: string | null;
    price_minor_units: number;
};
const cartLinesFor = async (userId: string): Promise<CartLineRow[]> => {
    const { rows } = await db.execute<CartLineRow>(sql `
    select ci.variant_id, ci.quantity, ci.live_session_id, pv.price_minor_units
    from cart_items ci
    join carts ct on ct.id = ci.cart_id
    join product_variants pv on pv.id = ci.variant_id
    where ct.user_id = cast(${userId} as uuid)
  `);
    return rows;
};
export const personalizedOffers = async (a: {
    userId: string;
    productId?: string | null;
}): Promise<{
    applied: AppliedPromotion[];
    suppressed: SuppressedPromotion[];
}> => {
    const promotions = await loadActivePromotions();
    const now = new Date();
    const lines: {
        variantId: string;
        quantity: number;
        liveSessionId: string | null;
    }[] = [];
    if (a.productId) {
        const variantId = await defaultVariantId(a.productId);
        if (variantId)
            lines.push({ variantId, quantity: 1, liveSessionId: null });
    }
    else {
        for (const row of await cartLinesFor(a.userId)) {
            lines.push({
                variantId: row.variant_id,
                quantity: row.quantity,
                liveSessionId: row.live_session_id,
            });
        }
    }
    if (lines.length === 0)
        return { applied: [], suppressed: [] };
    const surfaceFor = (liveSessionId: string | null): Surface => (liveSessionId ? 'live' : 'browse');
    const resolvedFirstPass = [];
    for (const line of lines) {
        resolvedFirstPass.push(await resolveLineContext(a.userId, {
            variantId: line.variantId,
            quantity: line.quantity,
            surface: surfaceFor(line.liveSessionId),
            liveSessionId: line.liveSessionId,
            orderSubtotalMinorUnits: 0,
        }, now));
    }
    const subtotal = resolvedFirstPass.reduce((sum, r) => sum + r.variantPriceMinorUnits * r.ctx.quantity, 0);
    const appliedByCode: Record<string, AppliedPromotion> = {};
    const suppressedByCode: Record<string, SuppressedPromotion> = {};
    for (const line of lines) {
        const resolved = await resolveLineContext(a.userId, {
            variantId: line.variantId,
            quantity: line.quantity,
            surface: surfaceFor(line.liveSessionId),
            liveSessionId: line.liveSessionId,
            orderSubtotalMinorUnits: subtotal,
        }, now);
        const evaluation = evaluatePromotions(withSessionLiveRule(promotions, resolved.ctx, resolved.sessionDiscountPercent), resolved.ctx, env.MAX_TOTAL_DISCOUNT_PCT);
        for (const ap of evaluation.applied) {
            const existing = appliedByCode[ap.code];
            appliedByCode[ap.code] = existing
                ? { ...existing, minorUnits: existing.minorUnits + ap.minorUnits }
                : { ...ap };
        }
        for (const sp of evaluation.suppressed)
            suppressedByCode[sp.code] ??= sp;
    }
    for (const code of Object.keys(appliedByCode))
        delete suppressedByCode[code];
    return { applied: Object.values(appliedByCode), suppressed: Object.values(suppressedByCode) };
};
