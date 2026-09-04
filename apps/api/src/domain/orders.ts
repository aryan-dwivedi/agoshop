import { sql } from 'drizzle-orm';

import {
  EVENTS,
  evaluatePromotions,
  type AppliedPromotion,
  type OrderDto,
  type PaymentMethod,
  type Surface,
} from '@shop/shared';

import { env } from '../env.js';
import { db } from '../db/client.js';
import { track } from '../lib/analytics.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { promotionAppliedTotal } from '../lib/metrics.js';
import { publishToUser } from '../lib/sse.js';
import { invalidateCatalogCache } from './catalog.js';
import { clearCartWithin, currentSubtotal, cartIdFor, loadCartItems } from './cart.js';
import { availablePaymentMethods, loadActivePolicy } from './checkoutPolicy.js';
import { resolveLineContext, type Executor } from './eligibility.js';
import { loadActivePromotions, promotionIdsByCode, withSessionLiveRule } from './promotions.js';
import { preauthorize, voidPreauthorization, type PaymentCard } from './mock/payments.js';

/**
 * Checkout, in the exact order the plan pins (Stage 2 / decision 16):
 *   1. Recompute ALL pricing server-side through resolveLineContext + evaluatePromotions.
 *   2. `preauthorize` OUTSIDE any transaction — no lock is held across its 200 ms delay.
 *   3. ONE short transaction: revalidate policy, current variant prices, live eligibility
 *      and redemption caps; decrement stock with a conditional UPDATE (no read-then-write,
 *      so overselling is structurally impossible); write orders/orderItems/redemptions;
 *      clear the cart.
 *   4. ANY abort voids the pre-authorization and returns. A revalidated total that differs
 *      from the pre-authorized amount is `409 pricing_changed` with the new totals.
 */

export type CreateOrderInput = {
  paymentMethod: PaymentMethod;
  pincode: string;
  card?: PaymentCard | null;
};

type PricedOrderLine = {
  cartItemId: string;
  productId: string;
  variantId: string;
  quantity: number;
  liveSessionId: string | null;
  unitPriceMinorUnits: number;
  grossMinorUnits: number;
  discountMinorUnits: number;
  netMinorUnits: number;
  applied: AppliedPromotion[];
};

type Priced = {
  lines: PricedOrderLine[];
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  totalMinorUnits: number;
};

type OrderRow = {
  id: string;
  status: 'pending' | 'paid' | 'payment_failed' | 'expired' | 'cancelled';
  created_at: string;
  subtotal_minor_units: number;
  discount_minor_units: number;
  total_minor_units: number;
  payment_method: PaymentMethod;
  payment_ref: string;
  pincode: string;
  fulfilment_status: string | null;
  tracking_number: string | null;
  carrier: string | null;
  estimated_delivery_at: string | null;
  items:
    | {
        productId: string;
        productSlug: string;
        productTitle: string;
        variantLabel: string;
        quantity: number;
        unitPriceMinorUnits: number;
        lineDiscountMinorUnits: number;
        appliedPromotionCodes: string[] | null;
        liveSessionId: string | null;
        liveSessionTitle: string | null;
      }[]
    | null;
};

/**
 * Price every cart line from relational truth. Used both before pre-authorization
 * (on the pool) and again inside the transaction (on the tx) — identical arithmetic,
 * so a difference between the two runs can only come from the world changing.
 */
export const priceCart = async (
  userId: string,
  now: Date,
  exec: Executor = db,
): Promise<Priced> => {
  const cartId = await cartIdFor(userId, exec);
  if (!cartId) throw badRequest('cart_empty', 'cart is empty');

  const items = await loadCartItems(cartId, exec);
  if (items.length === 0) throw badRequest('cart_empty', 'cart is empty');

  const subtotal = await currentSubtotal(cartId, exec);
  const promotions = await loadActivePromotions(exec === db ? undefined : exec);

  const lines: PricedOrderLine[] = [];
  for (const item of items) {
    const surface: Surface = item.live_session_id ? 'live' : 'browse';
    const resolved = await resolveLineContext(
      userId,
      {
        variantId: item.variant_id,
        quantity: item.quantity,
        surface,
        liveSessionId: item.live_session_id,
        orderSubtotalMinorUnits: subtotal,
      },
      now,
      exec,
    );
    // The room's markdown is re-proved here, from the executor's own read of the session
    // row: a host who moved it after the shopper opened checkout moves this total too, and
    // `createOrder`'s authorized-amount comparison turns that into 409 pricing_changed
    // rather than a silent overcharge.
    const evaluation = evaluatePromotions(
      withSessionLiveRule(promotions, resolved.ctx, resolved.sessionDiscountPercent),
      resolved.ctx,
      env.MAX_TOTAL_DISCOUNT_PCT,
    );
    lines.push({
      cartItemId: item.id,
      productId: resolved.productId,
      variantId: item.variant_id,
      quantity: item.quantity,
      // Attribution follows eligibility at checkout time, not at add time.
      liveSessionId: resolved.ctx.liveEligible ? item.live_session_id : null,
      unitPriceMinorUnits: resolved.variantPriceMinorUnits,
      grossMinorUnits: evaluation.grossMinorUnits,
      discountMinorUnits: evaluation.discountMinorUnits,
      netMinorUnits: evaluation.netMinorUnits,
      applied: evaluation.applied,
    });
  }

  return {
    lines,
    subtotalMinorUnits: lines.reduce((s, l) => s + l.grossMinorUnits, 0),
    discountMinorUnits: lines.reduce((s, l) => s + l.discountMinorUnits, 0),
    totalMinorUnits: lines.reduce((s, l) => s + l.netMinorUnits, 0),
  };
};

export const mergeApplied = (lines: PricedOrderLine[]): AppliedPromotion[] => {
  const byCode: Record<string, AppliedPromotion> = {};
  for (const line of lines) {
    for (const ap of line.applied) {
      const existing = byCode[ap.code];
      byCode[ap.code] = existing
        ? { ...existing, minorUnits: existing.minorUnits + ap.minorUnits }
        : { ...ap };
    }
  }
  return Object.values(byCode);
};

const ORDER_PROJECTION = sql`
  select o.id, o.status::text as status, o.created_at,
         o.subtotal_minor_units, o.discount_minor_units, o.total_minor_units,
         o.payment_method, o.payment_ref, o.pincode,
         o.fulfilment_status::text as fulfilment_status,
         o.tracking_number, o.carrier, o.estimated_delivery_at,
         (select json_agg(json_build_object(
                    'productId', oi.product_id,
                    'productSlug', p.slug,
                    'productTitle', p.title,
                    'variantLabel', pv.label,
                    'quantity', oi.quantity,
                    'unitPriceMinorUnits', oi.unit_price_minor_units,
                    'lineDiscountMinorUnits', oi.line_discount_minor_units,
                    'appliedPromotionCodes', oi.applied_promotion_codes,
                    'liveSessionId', oi.live_session_id,
                    'liveSessionTitle', ls.title) order by oi.id asc)
          from order_items oi
          join products p on p.id = oi.product_id
          join product_variants pv on pv.id = oi.variant_id
          left join live_sessions ls on ls.id = oi.live_session_id
          where oi.order_id = o.id) as items
  from orders o`;

const toOrderDto = (r: OrderRow): OrderDto => ({
  id: r.id,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
  subtotalMinorUnits: r.subtotal_minor_units,
  discountMinorUnits: r.discount_minor_units,
  totalMinorUnits: r.total_minor_units,
  paymentMethod: r.payment_method,
  paymentRef: r.payment_ref,
  pincode: r.pincode,
  fulfilmentStatus: (r.fulfilment_status as OrderDto['fulfilmentStatus']) ?? null,
  trackingNumber: r.tracking_number,
  carrier: r.carrier,
  estimatedDeliveryAt: r.estimated_delivery_at
    ? new Date(r.estimated_delivery_at).toISOString()
    : null,
  items: (r.items ?? []).map((i) => ({
    productId: i.productId,
    productSlug: i.productSlug,
    productTitle: i.productTitle,
    variantLabel: i.variantLabel,
    quantity: i.quantity,
    unitPriceMinorUnits: i.unitPriceMinorUnits,
    lineDiscountMinorUnits: i.lineDiscountMinorUnits,
    appliedPromotionCodes: i.appliedPromotionCodes ?? [],
    liveSessionId: i.liveSessionId,
    liveSessionTitle: i.liveSessionTitle,
  })),
});

export const createOrder = async (
  userId: string,
  idempotencyKey: string,
  input: CreateOrderInput,
): Promise<OrderDto> => {
  if (env.CHECKOUT_MODE === 'async') {
    const { createOrderIntent } = await import('./ordersAsync.js');
    return createOrderIntent(userId, idempotencyKey, input);
  }

  const now = new Date();

  // 1. Server-authoritative pricing. The client sends no amounts at all.
  const priced = await priceCart(userId, now);

  const options = await availablePaymentMethods({
    totalMinorUnits: priced.totalMinorUnits,
    pincode: input.pincode,
  });
  if (options.blockedReason) throw badRequest(options.blockedReason);
  if (!options.methods.includes(input.paymentMethod)) {
    throw badRequest('payment_method_unavailable', `${input.paymentMethod} is not available`, {
      methods: options.methods,
    });
  }

  // 2. Pre-authorize OUTSIDE any transaction.
  const preauth = await preauthorize({
    method: input.paymentMethod,
    amountMinorUnits: priced.totalMinorUnits,
    card: input.card ?? null,
  });
  if (!preauth.ok) {
    /**
     * The only trace a decline leaves. Nothing else is written — no order, no stock
     * movement, no redemption — so without this row a room's declines are invisible and
     * a seller reads them as shoppers changing their mind.
     *
     * One row per decline. `sessionId` is the room the cart's live-eligible lines were
     * attributed to (`priceCart` already resolved that, and the same rule credits the
     * order lines), and `productId` is set only when the cart is unambiguous — the rest
     * of the basket travels in `productIds`. No card, no pincode, no amount owner: the
     * gateway's reason code and integer paise, nothing that identifies a person.
     */
    const productIds = [...new Set(priced.lines.map((l) => l.productId))];
    track({
      type: 'payment_declined',
      userId,
      sessionId: priced.lines.find((l) => l.liveSessionId !== null)?.liveSessionId ?? null,
      productId: productIds.length === 1 ? productIds[0] : null,
      payload: {
        reason: preauth.reason,
        paymentMethod: input.paymentMethod,
        totalMinorUnits: priced.totalMinorUnits,
        lineCount: priced.lines.length,
        productIds,
      },
    });
    throw new AppError(402, 'payment_declined', `payment declined: ${preauth.reason}`);
  }
  const authorizedAmount = priced.totalMinorUnits;

  // 3. One short transaction. 4. Any abort voids the pre-authorization.
  let orderId: string;
  let finalApplied: AppliedPromotion[];
  try {
    const result = await db.transaction(async (tx) => {
      // Revalidate the policy against the freshly recomputed total.
      const revalidated = await priceCart(userId, new Date(), tx);
      const policy = await loadActivePolicy();
      if (revalidated.totalMinorUnits < policy.minOrderMinorUnits) {
        throw badRequest('below_min_order');
      }
      if (revalidated.totalMinorUnits !== authorizedAmount) {
        throw conflict('pricing_changed', 'prices changed while checking out', {
          totals: {
            subtotalMinorUnits: revalidated.subtotalMinorUnits,
            discountMinorUnits: revalidated.discountMinorUnits,
            totalMinorUnits: revalidated.totalMinorUnits,
          },
        });
      }

      // Atomic stock decrement — no read-then-write, so overselling is impossible.
      for (const line of revalidated.lines) {
        const { rows } = await tx.execute<{ stock: number }>(sql`
          update product_variants
          set stock = stock - ${line.quantity}
          where id = cast(${line.variantId} as uuid) and stock >= ${line.quantity}
          returning stock
        `);
        if (rows.length === 0) {
          throw conflict('out_of_stock', 'a variant ran out while checking out', {
            variantId: line.variantId,
          });
        }
      }

      const applied = mergeApplied(revalidated.lines);
      const { rows: orderRows } = await tx.execute<{ id: string }>(sql`
        insert into orders (user_id, status, subtotal_minor_units, discount_minor_units,
                            total_minor_units, applied_promotions, payment_method, payment_ref,
                            pincode, idempotency_key)
        values (cast(${userId} as uuid), 'paid', ${revalidated.subtotalMinorUnits},
                ${revalidated.discountMinorUnits}, ${revalidated.totalMinorUnits},
                cast(${JSON.stringify(applied)} as jsonb), ${input.paymentMethod},
                ${preauth.paymentRef}, ${input.pincode}, ${idempotencyKey})
        returning id
      `);
      const insertedId = orderRows[0]?.id;
      if (!insertedId) throw new AppError(500, 'order_insert_failed');

      const promotions = await loadActivePromotions(tx);
      const idByCode = promotionIdsByCode(promotions);

      for (const line of revalidated.lines) {
        await tx.execute(sql`
          insert into order_items (order_id, product_id, variant_id, quantity,
                                   unit_price_minor_units, line_discount_minor_units,
                                   applied_promotion_codes, live_session_id)
          values (cast(${insertedId} as uuid), cast(${line.productId} as uuid),
                  cast(${line.variantId} as uuid), ${line.quantity}, ${line.unitPriceMinorUnits},
                  ${line.discountMinorUnits},
                  cast(${JSON.stringify(line.applied.map((ap) => ap.code))} as jsonb),
                  cast(${line.liveSessionId} as uuid))
        `);
        for (const ap of line.applied) {
          const promotionId = idByCode[ap.code];
          if (!promotionId) continue;
          await tx.execute(sql`
            insert into promotion_redemptions (promotion_id, user_id, order_id, minor_units)
            values (cast(${promotionId} as uuid), cast(${userId} as uuid),
                    cast(${insertedId} as uuid), ${ap.minorUnits})
          `);
        }
      }

      await clearCartWithin(tx, userId);
      return { insertedId, applied };
    });
    orderId = result.insertedId;
    finalApplied = result.applied;
  } catch (err) {
    await voidPreauthorization(preauth.paymentRef);
    logger.warn(
      { err, paymentRef: preauth.paymentRef, userId },
      'checkout aborted; pre-authorization voided',
    );
    throw err;
  }

  // Stock changed, so the catalog cache is stale.
  await invalidateCatalogCache();

  for (const ap of finalApplied) promotionAppliedTotal.inc({ code: ap.code });

  const order = await getOrder(userId, orderId);
  if (!order) throw new AppError(500, 'order_read_failed');

  await Promise.all([
    publishToUser(userId, EVENTS.orderCreated, order),
    publishToUser(userId, EVENTS.cartUpdated, {
      items: [],
      totals: { subtotalMinorUnits: 0, discountMinorUnits: 0, totalMinorUnits: 0 },
      notices: [],
    }),
  ]);
  track({
    type: 'order_created',
    userId,
    payload: { orderId, totalMinorUnits: order.totalMinorUnits },
  });

  return order;
};

export const listOrders = async (userId: string): Promise<OrderDto[]> => {
  const { rows } = await db.execute<OrderRow>(
    sql`${ORDER_PROJECTION} where o.user_id = cast(${userId} as uuid) order by o.created_at desc`,
  );
  return rows.map(toOrderDto);
};

export const getOrder = async (userId: string, orderId: string): Promise<OrderDto | null> => {
  const { rows } = await db.execute<OrderRow>(
    sql`${ORDER_PROJECTION} where o.id = cast(${orderId} as uuid) and o.user_id = cast(${userId} as uuid)`,
  );
  const row = rows[0];
  return row ? toOrderDto(row) : null;
};

export const getOrderOrThrow = async (userId: string, orderId: string): Promise<OrderDto> => {
  const order = await getOrder(userId, orderId);
  if (!order) throw notFound('order_not_found');
  return order;
};

/** The console's order list is bounded; a seller reads recent orders, not the archive. */
export const SELLER_ORDERS_DEFAULT_LIMIT = 100;
export const SELLER_ORDERS_MAX_LIMIT = 500;

/**
 * Orders that contain at least one line for one of these sellers, newest first, with
 * `items` trimmed to those lines.
 *
 * The order-level money is RECOMPUTED from the trimmed lines, so a mixed-seller basket
 * shows each seller their own share instead of a stranger's total. `paymentRef`,
 * `pincode`, `status` and `createdAt` remain the order's own facts, which is what a
 * seller needs to answer a shopper's question about it.
 */
export const listSellerOrders = async (
  sellerIds: string[],
  limit: number = SELLER_ORDERS_DEFAULT_LIMIT,
): Promise<OrderDto[]> => {
  if (sellerIds.length === 0) return [];
  const owners = sql.join(
    sellerIds.map((id) => sql`cast(${id} as uuid)`),
    sql`, `,
  );
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), SELLER_ORDERS_MAX_LIMIT);

  const { rows } = await db.execute<OrderRow>(sql`
    select o.id, o.status::text as status, o.created_at,
           mine.subtotal_minor_units, mine.discount_minor_units,
           mine.subtotal_minor_units - mine.discount_minor_units as total_minor_units,
           o.payment_method, o.payment_ref, o.pincode, mine.items
    from orders o
    join (
      select oi.order_id,
             sum(oi.unit_price_minor_units * oi.quantity)::int as subtotal_minor_units,
             sum(oi.line_discount_minor_units)::int as discount_minor_units,
             json_agg(json_build_object(
               'productId', oi.product_id,
               'productSlug', p.slug,
               'productTitle', p.title,
               'variantLabel', pv.label,
               'quantity', oi.quantity,
               'unitPriceMinorUnits', oi.unit_price_minor_units,
               'lineDiscountMinorUnits', oi.line_discount_minor_units,
               'appliedPromotionCodes', oi.applied_promotion_codes,
               'liveSessionId', oi.live_session_id,
               'liveSessionTitle', ls.title) order by oi.id asc) as items
      from order_items oi
      join products p on p.id = oi.product_id
      join product_variants pv on pv.id = oi.variant_id
      left join live_sessions ls on ls.id = oi.live_session_id
      where p.seller_id in (${owners})
      group by oi.order_id
    ) mine on mine.order_id = o.id
    order by o.created_at desc
    limit ${bounded}
  `);
  return rows.map(toOrderDto);
};
