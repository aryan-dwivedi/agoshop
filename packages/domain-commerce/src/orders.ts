import type { Executor } from './eligibility.js';
import type { PaymentCard } from './mock/payments.js';
import type { AppliedPromotion, OrderDto, PaymentMethod, Surface } from '@shop/shared';

import { sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { AppError, badRequest, conflict, notFound } from '@shop/platform/lib/errors.js';
import { logger } from '@shop/platform/lib/logger.js';
import { promotionAppliedTotal } from '@shop/platform/lib/metrics.js';
import { publishToUser } from '@shop/platform/lib/sse.js';
import { EVENTS, evaluatePromotions } from '@shop/shared';

import { cartIdFor, clearCartWithin, currentSubtotal, loadCartItems } from './cart.js';
import { invalidateCatalogCache } from './catalog.js';
import { availablePaymentMethods, loadActivePolicy } from './checkoutPolicy.js';
import { resolveLineContext } from './eligibility.js';
import { preauthorize, voidPreauthorization } from './mock/payments.js';
import { loadActivePromotions, promotionIdsByCode, withSessionLiveRule } from './promotions.js';

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
    const preauth = await preauthorize({
        method: input.paymentMethod,
        amountMinorUnits: priced.totalMinorUnits,
        card: input.card ?? null,
    });
    if (!preauth.ok) {
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
    let orderId: string;
    let finalApplied: AppliedPromotion[];
    try {
        const result = await db.transaction(async (tx) => {
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
            for (const line of revalidated.lines) {
                const { rows } = await tx.execute<{
                    stock: number;
                }>(sql`
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
            const { rows: orderRows } = await tx.execute<{
                id: string;
            }>(sql`
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
    await invalidateCatalogCache();
    for (const ap of finalApplied) promotionAppliedTotal.inc({ code: ap.code });
    const order = await getOrder(userId, orderId);
    if (!order) throw new AppError(500, 'order_read_failed');
    await Promise.all([
        publishToUser(userId, EVENTS.orderCreated, order),
        publishToUser(userId, EVENTS.cartUpdated, {
            items: [],
            totals: {
                subtotalMinorUnits: 0,
                discountMinorUnits: 0,
                totalMinorUnits: 0,
            },
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
export const SELLER_ORDERS_DEFAULT_LIMIT = 100;
export const SELLER_ORDERS_MAX_LIMIT = 500;
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
