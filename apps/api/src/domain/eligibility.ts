import { sql } from 'drizzle-orm';
import type { LineContext, Surface, UserSegment } from '@shop/shared';
import { db, type Db, type Tx } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';
export type Executor = Db | Tx;
export type LineInput = {
    variantId: string;
    quantity: number;
    surface: Surface;
    liveSessionId: string | null;
    orderSubtotalMinorUnits: number;
};
export type ResolvedLine = {
    ctx: LineContext;
    productId: string;
    variantPriceMinorUnits: number;
    variantMrpMinorUnits: number | null;
    sessionDiscountPercent: number | null;
    liveSessionEnded: boolean;
    sessionExists: boolean;
    productAttachedToSession: boolean;
    variantLabel: string;
    variantStock: number;
    productTitle: string;
    productSlug: string;
    imageUrl: string | null;
};
type LineRow = {
    price_minor_units: number;
    mrp_minor_units: number | null;
    variant_label: string;
    stock: number;
    product_id: string;
    title: string;
    slug: string;
    seller_id: string;
    image_url: string | null;
    category_slug: string;
    session_id: string | null;
    session_status: string | null;
    session_discount_percent: number | null;
    attached: boolean;
};
type SegmentRow = {
    paid_orders: number;
    wishlisted: boolean;
    redemptions: Record<string, number>;
};
const loadLine = async (exec: Executor, variantId: string, liveSessionId: string | null): Promise<LineRow | undefined> => {
    const { rows } = await exec.execute<LineRow>(sql `
    select pv.price_minor_units,
           pv.mrp_minor_units,
           pv.label as variant_label,
           pv.stock,
           p.id as product_id,
           p.title,
           p.slug,
           p.seller_id,
           (p.images ->> 0) as image_url,
           c.slug as category_slug,
           ls.id as session_id,
           ls.status::text as session_status,
           ls.discount_percent as session_discount_percent,
           (lsp.product_id is not null) as attached
    from product_variants pv
    join products p on p.id = pv.product_id
    join categories c on c.id = p.category_id
    left join live_sessions ls on ls.id = cast(${liveSessionId} as uuid)
    left join live_session_products lsp
           on lsp.session_id = ls.id and lsp.product_id = p.id
    where pv.id = cast(${variantId} as uuid)
  `);
    return rows[0];
};
const loadUserFacts = async (exec: Executor, userId: string, productId: string): Promise<SegmentRow> => {
    const { rows } = await exec.execute<SegmentRow>(sql `
    select
      (select count(*)::int from orders o where o.user_id = cast(${userId} as uuid)) as paid_orders,
      (select exists(select 1 from wishlist_items w
                      where w.user_id = cast(${userId} as uuid)
                        and w.product_id = cast(${productId} as uuid))) as wishlisted,
      coalesce((select json_object_agg(t.promotion_id, t.c)
                from (select promotion_id, count(*)::int as c
                      from promotion_redemptions
                      where user_id = cast(${userId} as uuid)
                      group by promotion_id) t), '{}'::json) as redemptions
  `);
    return rows[0] ?? { paid_orders: 0, wishlisted: false, redemptions: {} };
};
export const resolveLineContext = async (userId: string, line: LineInput, now: Date, exec: Executor = db): Promise<ResolvedLine> => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw badRequest('invalid_quantity', 'quantity must be a positive integer');
    }
    const row = await loadLine(exec, line.variantId, line.liveSessionId);
    if (!row)
        throw notFound('variant_not_found');
    const facts = await loadUserFacts(exec, userId, row.product_id);
    const sessionExists = row.session_id !== null;
    const liveEligible = line.liveSessionId !== null && sessionExists && row.session_status === 'live' && row.attached;
    const liveSessionEnded = line.liveSessionId !== null && sessionExists && !liveEligible;
    const userSegments: UserSegment[] = [];
    if (facts.paid_orders === 0)
        userSegments.push('first_order');
    if (facts.wishlisted)
        userSegments.push('has_wishlisted');
    if (facts.paid_orders >= 3)
        userSegments.push('loyalty_3plus');
    const surface: Surface = line.surface;
    const ctx: LineContext = {
        surface,
        liveEligible,
        liveSessionId: line.liveSessionId,
        categorySlug: row.category_slug,
        productId: row.product_id,
        sellerId: row.seller_id,
        unitPriceMinorUnits: row.price_minor_units,
        quantity: line.quantity,
        orderSubtotalMinorUnits: line.orderSubtotalMinorUnits,
        userSegments,
        redemptionsByPromotionId: facts.redemptions ?? {},
        now,
    };
    return {
        ctx,
        productId: row.product_id,
        variantPriceMinorUnits: row.price_minor_units,
        variantMrpMinorUnits: row.mrp_minor_units,
        sessionDiscountPercent: row.session_discount_percent,
        liveSessionEnded,
        sessionExists,
        productAttachedToSession: row.attached,
        variantLabel: row.variant_label,
        variantStock: row.stock,
        productTitle: row.title,
        productSlug: row.slug,
        imageUrl: row.image_url,
    };
};
export const defaultVariantId = async (productId: string, exec: Executor = db): Promise<string | null> => {
    const { rows } = await exec.execute<{
        id: string;
    }>(sql `
    select id from product_variants
    where product_id = cast(${productId} as uuid)
    order by is_default desc, price_minor_units asc
    limit 1
  `);
    return rows[0]?.id ?? null;
};
