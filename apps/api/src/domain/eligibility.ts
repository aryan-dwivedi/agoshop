import { sql } from 'drizzle-orm';

import type { LineContext, Surface, UserSegment } from '@shop/shared';

import { db, type Db, type Tx } from '../db/client.js';
import { badRequest, notFound } from '../lib/errors.js';

/**
 * Live eligibility is resolved server-side from relational truth, exactly once
 * (architecture decision 7). `resolveLineContext` is the ONLY path by which cart,
 * checkout and every AI tool decide whether a line is live-eligible, and the only
 * place a `LineContext` is constructed.
 *
 * A line qualifies only if ALL of these hold at evaluation time:
 *   - the variant exists and belongs to the product,
 *   - the live session exists,
 *   - its status is 'live',
 *   - the product is attached to that session in `liveSessionProducts`.
 * One SQL join proves all four. Prices are always the CURRENT `productVariants`
 * price; `cartItems.unitPriceMinorUnits` is a display snapshot and never authoritative.
 */

/** Either the pool-backed db or an open transaction — checkout revalidates inside the tx. */
export type Executor = Db | Tx;

export type LineInput = {
  variantId: string;
  quantity: number;
  surface: Surface;
  liveSessionId: string | null;
  orderSubtotalMinorUnits: number;
};

export type ResolvedLine = {
  /** The fully populated evaluator input. */
  ctx: LineContext;
  productId: string;
  variantPriceMinorUnits: number;
  /** Tier 1 for this variant, per unit. `null` when the seller published no MRP. */
  variantMrpMinorUnits: number | null;
  /**
   * The live session's own markdown in whole percent, or `null` when the room adds no
   * rule of its own. Carried here because the room's rule is an INPUT to the evaluator,
   * exactly like a stored promotion row — callers synthesize a promotion from it rather
   * than discounting anything themselves.
   */
  sessionDiscountPercent: number | null;
  /**
   * The session row exists but the live rule no longer holds (ended, not started yet,
   * or the product attachment was removed) — this is what raises `live_discount_expired`.
   */
  liveSessionEnded: boolean;
  /** Whether the requested session id resolved to a row at all. */
  sessionExists: boolean;
  /** Whether the product is attached to that session. */
  productAttachedToSession: boolean;
  /** Display fields the cart needs, resolved by the same join. */
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

/**
 * One join proves variant -> product -> category, and (when a session id is supplied)
 * that the session exists, is live, and has the product attached.
 */
const loadLine = async (
  exec: Executor,
  variantId: string,
  liveSessionId: string | null,
): Promise<LineRow | undefined> => {
  const { rows } = await exec.execute<LineRow>(sql`
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

/** Segments and per-promotion redemption counts, in one round trip. */
const loadUserFacts = async (
  exec: Executor,
  userId: string,
  productId: string,
): Promise<SegmentRow> => {
  const { rows } = await exec.execute<SegmentRow>(sql`
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

export const resolveLineContext = async (
  userId: string,
  line: LineInput,
  now: Date,
  exec: Executor = db,
): Promise<ResolvedLine> => {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    throw badRequest('invalid_quantity', 'quantity must be a positive integer');
  }

  const row = await loadLine(exec, line.variantId, line.liveSessionId);
  if (!row) throw notFound('variant_not_found');

  const facts = await loadUserFacts(exec, userId, row.product_id);

  const sessionExists = row.session_id !== null;
  const liveEligible =
    line.liveSessionId !== null && sessionExists && row.session_status === 'live' && row.attached;
  const liveSessionEnded = line.liveSessionId !== null && sessionExists && !liveEligible;

  const userSegments: UserSegment[] = [];
  if (facts.paid_orders === 0) userSegments.push('first_order');
  if (facts.wishlisted) userSegments.push('has_wishlisted');
  if (facts.paid_orders >= 3) userSegments.push('loyalty_3plus');

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

/** The default variant of a product — the one AI tools and live-offer previews price. */
export const defaultVariantId = async (
  productId: string,
  exec: Executor = db,
): Promise<string | null> => {
  const { rows } = await exec.execute<{ id: string }>(sql`
    select id from product_variants
    where product_id = cast(${productId} as uuid)
    order by is_default desc, price_minor_units asc
    limit 1
  `);
  return rows[0]?.id ?? null;
};
