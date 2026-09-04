import { sql } from 'drizzle-orm';

import { EVENTS, type OrderDto } from '@shop/shared';

import { db } from '../db/client.js';
import { env } from '../env.js';
import { track } from '../lib/analytics.js';
import { AppError, badRequest, conflict } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { promotionAppliedTotal } from '../lib/metrics.js';
import { publishToUser } from '../lib/sse.js';
import { invalidateCatalogCache } from './catalog.js';
import { clearCartWithin } from './cart.js';
import { availablePaymentMethods, loadActivePolicy } from './checkoutPolicy.js';
import { capture, preauthorize, voidPreauthorization } from './mock/payments.js';
import { enqueueCaptureJob } from './orderCaptureQueue.js';
import { getOrder, mergeApplied, priceCart, type CreateOrderInput } from './orders.js';
import { loadActivePromotions, promotionIdsByCode } from './promotions.js';
import type { Executor } from './eligibility.js';

const availableStock = async (variantId: string, exec: Executor = db): Promise<number> => {
  const { rows } = await exec.execute<{ available: number }>(sql`
    select pv.stock - coalesce((
      select sum(sr.quantity)::int
      from stock_reservations sr
      where sr.variant_id = pv.id
        and sr.status = 'active'
        and sr.expires_at > now()
    ), 0) as available
    from product_variants pv
    where pv.id = cast(${variantId} as uuid)
  `);
  return rows[0]?.available ?? 0;
};

const insertPromotionHolds = async (
  tx: Executor,
  userId: string,
  orderId: string,
  applied: { code: string; minorUnits: number }[],
): Promise<void> => {
  const promotions = await loadActivePromotions(tx);
  const idByCode = promotionIdsByCode(promotions);
  for (const ap of applied) {
    const promotionId = idByCode[ap.code];
    if (!promotionId) continue;
    await tx.execute(sql`
      insert into promotion_redemptions (promotion_id, user_id, order_id, minor_units)
      values (cast(${promotionId} as uuid), cast(${userId} as uuid),
              cast(${orderId} as uuid), ${ap.minorUnits})
    `);
  }
};

const releasePromotionHolds = async (orderId: string, exec: Executor = db): Promise<void> => {
  await exec.execute(sql`
    delete from promotion_redemptions where order_id = cast(${orderId} as uuid)
  `);
};

/** Compensate a pending order when enqueue or post-commit steps fail. */
const failPendingOrder = async (
  orderId: string,
  userId: string,
  paymentRef: string,
): Promise<void> => {
  await voidPreauthorization(paymentRef);
  await db.execute(sql`
    update orders set status = 'payment_failed'
    where id = cast(${orderId} as uuid) and status = 'pending'
  `);
  await db.execute(sql`
    update stock_reservations set status = 'released'
    where order_id = cast(${orderId} as uuid) and status = 'active'
  `);
  await releasePromotionHolds(orderId);
  const failed = await getOrder(userId, orderId);
  if (failed) await publishToUser(userId, EVENTS.orderUpdated, failed);
};

/** Roll back stock decremented during capture when payment capture fails. */
const rollbackCommittedStock = async (orderId: string, userId: string): Promise<void> => {
  await db.transaction(async (tx) => {
    const { rows: locked } = await tx.execute<{ status: string }>(sql`
      select status::text as status from orders
      where id = cast(${orderId} as uuid) for update
    `);
    if (locked[0]?.status !== 'pending') return;

    await tx.execute(sql`
      update product_variants pv
      set stock = pv.stock + oi.quantity
      from order_items oi
      where oi.order_id = cast(${orderId} as uuid)
        and pv.id = oi.variant_id
    `);
    await tx.execute(sql`
      update stock_reservations set status = 'released'
      where order_id = cast(${orderId} as uuid) and status = 'confirmed'
    `);
    await tx.execute(sql`
      update orders set status = 'payment_failed'
      where id = cast(${orderId} as uuid) and status = 'pending'
    `);
    await releasePromotionHolds(orderId, tx);
  });

  const failed = await getOrder(userId, orderId);
  if (failed) await publishToUser(userId, EVENTS.orderUpdated, failed);
};

export const createOrderIntent = async (
  userId: string,
  idempotencyKey: string,
  input: CreateOrderInput,
): Promise<OrderDto> => {
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
    track({
      type: 'payment_declined',
      userId,
      sessionId: priced.lines.find((l) => l.liveSessionId !== null)?.liveSessionId ?? null,
      productId: null,
      payload: { reason: preauth.reason, paymentMethod: input.paymentMethod },
    });
    throw new AppError(402, 'payment_declined', `payment declined: ${preauth.reason}`);
  }

  const expiresAt = new Date(now.getTime() + env.ORDER_RESERVATION_TTL_SECONDS * 1000);
  let committedOrderId: string | null = null;

  try {
    const result = await db.transaction(async (tx) => {
      const revalidated = await priceCart(userId, new Date(), tx);
      const policy = await loadActivePolicy();
      if (revalidated.totalMinorUnits < policy.minOrderMinorUnits) {
        throw badRequest('below_min_order');
      }
      if (revalidated.totalMinorUnits !== priced.totalMinorUnits) {
        throw conflict('pricing_changed', 'prices changed while checking out', {
          totals: {
            subtotalMinorUnits: revalidated.subtotalMinorUnits,
            discountMinorUnits: revalidated.discountMinorUnits,
            totalMinorUnits: revalidated.totalMinorUnits,
          },
        });
      }

      for (const line of revalidated.lines) {
        const available = await availableStock(line.variantId, tx);
        if (available < line.quantity) {
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
        values (cast(${userId} as uuid), 'pending', ${revalidated.subtotalMinorUnits},
                ${revalidated.discountMinorUnits}, ${revalidated.totalMinorUnits},
                cast(${JSON.stringify(applied)} as jsonb), ${input.paymentMethod},
                ${preauth.paymentRef}, ${input.pincode}, ${idempotencyKey})
        returning id
      `);
      const insertedId = orderRows[0]?.id;
      if (!insertedId) throw new AppError(500, 'order_insert_failed');

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
        await tx.execute(sql`
          insert into stock_reservations (order_id, variant_id, quantity, status, expires_at)
          values (cast(${insertedId} as uuid), cast(${line.variantId} as uuid), ${line.quantity},
                  'active', ${expiresAt})
        `);
      }

      await insertPromotionHolds(tx, userId, insertedId, applied);
      await clearCartWithin(tx, userId);
      return { insertedId, applied };
    });

    committedOrderId = result.insertedId;
    for (const ap of result.applied) promotionAppliedTotal.inc({ code: ap.code });

    try {
      await enqueueCaptureJob(result.insertedId);
    } catch (enqueueErr) {
      logger.error({ err: enqueueErr, orderId: result.insertedId }, 'capture enqueue failed');
      await failPendingOrder(result.insertedId, userId, preauth.paymentRef);
      throw new AppError(503, 'checkout_unavailable', 'could not queue order for capture');
    }

    const order = await getOrder(userId, result.insertedId);
    if (!order) {
      await failPendingOrder(result.insertedId, userId, preauth.paymentRef);
      throw new AppError(500, 'order_read_failed');
    }
    await publishToUser(userId, EVENTS.orderUpdated, order);
    return order;
  } catch (err) {
    if (!committedOrderId) await voidPreauthorization(preauth.paymentRef);
    throw err;
  }
};

export const captureOrder = async (orderId: string): Promise<void> => {
  const order = await db.transaction(async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      user_id: string;
      status: string;
      payment_ref: string;
    }>(sql`
      select id, user_id, status::text as status, payment_ref
      from orders
      where id = cast(${orderId} as uuid) and status = 'pending'
      for update skip locked
    `);
    return rows[0] ?? null;
  });
  if (!order) return;

  let stockCommitted = false;
  try {
    await db.transaction(async (tx) => {
      const { rows: locked } = await tx.execute<{ status: string }>(sql`
        select status::text as status from orders
        where id = cast(${orderId} as uuid) for update
      `);
      if (locked[0]?.status !== 'pending') return;

      const { rows: lines } = await tx.execute<{ variant_id: string; quantity: number }>(sql`
        select variant_id, quantity from order_items where order_id = cast(${orderId} as uuid)
      `);

      for (const line of lines) {
        const { rows: dec } = await tx.execute(sql`
          update product_variants
          set stock = stock - ${line.quantity}
          where id = cast(${line.variant_id} as uuid) and stock >= ${line.quantity}
          returning stock
        `);
        if (dec.length === 0) {
          throw conflict('out_of_stock', 'stock unavailable at capture', {
            variantId: line.variant_id,
          });
        }
      }

      await tx.execute(sql`
        update stock_reservations set status = 'confirmed'
        where order_id = cast(${orderId} as uuid) and status = 'active'
      `);
    });
    stockCommitted = true;
  } catch (err) {
    await db.execute(sql`
      update orders set status = 'payment_failed'
      where id = cast(${orderId} as uuid) and status = 'pending'
    `);
    await db.execute(sql`
      update stock_reservations set status = 'released'
      where order_id = cast(${orderId} as uuid) and status = 'active'
    `);
    await releasePromotionHolds(orderId);
    await voidPreauthorization(order.payment_ref);
    logger.error({ err, orderId }, 'order capture stock commit failed');
    const failed = await getOrder(order.user_id, orderId);
    if (failed) await publishToUser(order.user_id, EVENTS.orderUpdated, failed);
    return;
  }

  const captured = await capture(order.payment_ref);
  if (!captured.ok) {
    if (stockCommitted) await rollbackCommittedStock(orderId, order.user_id);
    await voidPreauthorization(order.payment_ref);
    return;
  }

  const { rows: paidRows } = await db.execute<{ id: string }>(sql`
    update orders set status = 'paid'
    where id = cast(${orderId} as uuid) and status = 'pending'
    returning id
  `);
  if (paidRows.length === 0) return;

  await invalidateCatalogCache();
  const paid = await getOrder(order.user_id, orderId);
  if (!paid) return;

  await Promise.all([
    publishToUser(order.user_id, EVENTS.orderCreated, paid),
    publishToUser(order.user_id, EVENTS.orderUpdated, paid),
  ]);
  track({
    type: 'order_created',
    userId: order.user_id,
    payload: { orderId, totalMinorUnits: paid.totalMinorUnits },
  });
};

export const expireStaleOrders = async (): Promise<number> => {
  const { rows } = await db.execute<{ order_id: string; payment_ref: string; user_id: string }>(sql`
    select distinct o.id as order_id, o.payment_ref, o.user_id
    from orders o
    join stock_reservations sr on sr.order_id = o.id
    where o.status = 'pending'
      and sr.status = 'active'
      and sr.expires_at < now()
  `);

  let expired = 0;
  for (const row of rows) {
    await voidPreauthorization(row.payment_ref);
    await db.execute(sql`
      update orders set status = 'expired'
      where id = cast(${row.order_id} as uuid) and status = 'pending'
    `);
    await db.execute(sql`
      update stock_reservations set status = 'expired'
      where order_id = cast(${row.order_id} as uuid) and status = 'active'
    `);
    await releasePromotionHolds(row.order_id);
    const dto = await getOrder(row.user_id, row.order_id);
    if (dto) await publishToUser(row.user_id, EVENTS.orderUpdated, dto);
    expired += 1;
  }
  return expired;
};
