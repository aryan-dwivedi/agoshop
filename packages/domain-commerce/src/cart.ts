import type { Executor } from './eligibility.js';
import type { Tx } from '@shop/db/client.js';
import type { CartDto, CartLineDto, CartNotice, Promotion, Surface } from '@shop/shared';

import { sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { AppError, badRequest, notFound } from '@shop/platform/lib/errors.js';
import { evaluatePromotions } from '@shop/shared';

import { defaultVariantId, resolveLineContext } from './eligibility.js';
import { isLiveRule, loadActivePromotions, withSessionLiveRule } from './promotions.js';

export type AddItemInput = {
    productId: string;
    variantId?: string;
    quantity?: number;
    liveSessionId?: string | null;
    surface?: Surface;
};
type CartItemRow = {
    id: string;
    product_id: string;
    variant_id: string;
    quantity: number;
    live_session_id: string | null;
};
const MAX_LINE_QUANTITY = 20;
const emptyCart = (): CartDto => ({
    items: [],
    totals: { subtotalMinorUnits: 0, discountMinorUnits: 0, totalMinorUnits: 0 },
    notices: [],
});
const cartIdFor = async (userId: string, exec: Executor = db): Promise<string | null> => {
    const { rows } = await exec.execute<{
        id: string;
    }>(sql`select id from carts where user_id = cast(${userId} as uuid)`);
    return rows[0]?.id ?? null;
};
const ensureCart = async (userId: string, exec: Executor = db): Promise<string> => {
    const { rows } = await exec.execute<{
        id: string;
    }>(sql`
    insert into carts (user_id) values (cast(${userId} as uuid))
    on conflict (user_id) do update set updated_at = now()
    returning id
  `);
    const id = rows[0]?.id;
    if (!id) throw notFound('cart_not_found');
    return id;
};
export const loadCartItems = async (
    cartId: string,
    exec: Executor = db,
): Promise<CartItemRow[]> => {
    const { rows } = await exec.execute<CartItemRow>(sql`
    select id, product_id, variant_id, quantity, live_session_id
    from cart_items
    where cart_id = cast(${cartId} as uuid)
    order by added_at asc
  `);
    return rows;
};
const currentSubtotal = async (cartId: string, exec: Executor = db): Promise<number> => {
    const { rows } = await exec.execute<{
        subtotal: number;
    }>(sql`
    select coalesce(sum(pv.price_minor_units * ci.quantity), 0)::int as subtotal
    from cart_items ci
    join product_variants pv on pv.id = ci.variant_id
    where ci.cart_id = cast(${cartId} as uuid)
  `);
    return rows[0]?.subtotal ?? 0;
};
export type PricedLine = {
    line: CartLineDto;
    liveSessionEnded: boolean;
    liveDiscountActive: boolean;
    variantStock: number;
};
export const priceCartItem = async (
    userId: string,
    item: CartItemRow,
    orderSubtotalMinorUnits: number,
    now: Date,
    exec: Executor = db,
    promotionsOrUndefined?: Promotion[],
): Promise<PricedLine> => {
    const promotions =
        promotionsOrUndefined ?? (await loadActivePromotions(exec === db ? undefined : exec));
    const surface: Surface = item.live_session_id ? 'live' : 'browse';
    const resolved = await resolveLineContext(
        userId,
        {
            variantId: item.variant_id,
            quantity: item.quantity,
            surface,
            liveSessionId: item.live_session_id,
            orderSubtotalMinorUnits,
        },
        now,
        exec,
    );
    const candidates = withSessionLiveRule(
        promotions,
        resolved.ctx,
        resolved.sessionDiscountPercent,
    );
    const evaluation = evaluatePromotions(candidates, resolved.ctx, env.MAX_TOTAL_DISCOUNT_PCT);
    const liveCodes = candidates.filter(isLiveRule).map((p) => p.code);
    return {
        line: {
            id: item.id,
            productId: resolved.productId,
            productTitle: resolved.productTitle,
            productSlug: resolved.productSlug,
            variantId: item.variant_id,
            variantLabel: resolved.variantLabel,
            imageUrl: resolved.imageUrl,
            quantity: item.quantity,
            liveSessionId: item.live_session_id,
            liveEligible: resolved.ctx.liveEligible,
            pricing: {
                unitPriceMinorUnits: resolved.variantPriceMinorUnits,
                unitMrpMinorUnits: resolved.variantMrpMinorUnits,
                grossMinorUnits: evaluation.grossMinorUnits,
                discountMinorUnits: evaluation.discountMinorUnits,
                netMinorUnits: evaluation.netMinorUnits,
            },
            applied: evaluation.applied,
            suppressed: evaluation.suppressed,
        },
        liveSessionEnded: resolved.liveSessionEnded,
        liveDiscountActive:
            resolved.ctx.liveEligible &&
            evaluation.applied.some((ap) => liveCodes.includes(ap.code)),
        variantStock: resolved.variantStock,
    };
};
export const getCart = async (userId: string, exec: Executor = db): Promise<CartDto> => {
    const cartId = await cartIdFor(userId, exec);
    if (!cartId) return emptyCart();
    const items = await loadCartItems(cartId, exec);
    if (items.length === 0) return emptyCart();
    const subtotal = await currentSubtotal(cartId, exec);
    const promotions = await loadActivePromotions(exec === db ? undefined : exec);
    const now = new Date();
    const priced: PricedLine[] = [];
    for (const item of items) {
        priced.push(await priceCartItem(userId, item, subtotal, now, exec, promotions));
    }
    const totals = priced.reduce(
        (acc, p) => ({
            subtotalMinorUnits: acc.subtotalMinorUnits + p.line.pricing.grossMinorUnits,
            discountMinorUnits: acc.discountMinorUnits + p.line.pricing.discountMinorUnits,
            totalMinorUnits: acc.totalMinorUnits + p.line.pricing.netMinorUnits,
        }),
        { subtotalMinorUnits: 0, discountMinorUnits: 0, totalMinorUnits: 0 },
    );
    const notices: CartNotice[] = [];
    if (priced.some((p) => p.liveDiscountActive)) notices.push('live_discount_active');
    if (priced.some((p) => p.liveSessionEnded)) notices.push('live_discount_expired');
    if (totals.discountMinorUnits > 0) notices.push('promotion_applied');
    return { items: priced.map((p) => p.line), totals, notices };
};
export const addItem = async (userId: string, input: AddItemInput): Promise<CartDto> => {
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
        throw badRequest('invalid_quantity', `quantity must be 1..${MAX_LINE_QUANTITY}`);
    }
    const requestedSession = input.liveSessionId ?? null;
    const variantId = input.variantId ?? (await defaultVariantId(input.productId));
    if (!variantId) throw notFound('variant_not_found');
    const cartId = await ensureCart(userId);
    const subtotal = await currentSubtotal(cartId);
    const surface: Surface = input.surface ?? (requestedSession ? 'live' : 'browse');
    const resolved = await resolveLineContext(
        userId,
        {
            variantId,
            quantity,
            surface,
            liveSessionId: requestedSession,
            orderSubtotalMinorUnits: subtotal,
        },
        new Date(),
    );
    if (resolved.productId !== input.productId) {
        throw badRequest(
            requestedSession ? 'invalid_live_session_product' : 'invalid_variant',
            'variant does not belong to the requested product',
        );
    }
    if (requestedSession && (!resolved.sessionExists || !resolved.productAttachedToSession)) {
        throw badRequest(
            'invalid_live_session_product',
            'product is not featured in that live session',
        );
    }
    const storedSessionId = resolved.ctx.liveEligible ? requestedSession : null;
    await db.execute(sql`
    insert into cart_items (cart_id, product_id, variant_id, quantity, unit_price_minor_units, live_session_id)
    values (cast(${cartId} as uuid), cast(${resolved.productId} as uuid), cast(${variantId} as uuid),
            ${quantity}, ${resolved.variantPriceMinorUnits}, cast(${storedSessionId} as uuid))
    on conflict (cart_id, variant_id, live_session_id) do update
      set quantity = least(${MAX_LINE_QUANTITY}, cart_items.quantity + excluded.quantity),
          unit_price_minor_units = excluded.unit_price_minor_units,
          added_at = now()
  `);
    await touchCart(cartId);
    track({
        type: 'add_to_cart',
        userId,
        sessionId: storedSessionId,
        productId: resolved.productId,
    });
    return getCart(userId);
};
export const setQuantity = async (
    userId: string,
    itemId: string,
    quantity: number,
): Promise<CartDto> => {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_LINE_QUANTITY) {
        throw badRequest('invalid_quantity', `quantity must be 0..${MAX_LINE_QUANTITY}`);
    }
    const cartId = await cartIdFor(userId);
    if (!cartId) throw notFound('cart_item_not_found');
    const { rowCount } =
        quantity === 0
            ? await db.execute(sql`
          delete from cart_items
          where id = cast(${itemId} as uuid) and cart_id = cast(${cartId} as uuid)
        `)
            : await db.execute(sql`
          update cart_items set quantity = ${quantity}
          where id = cast(${itemId} as uuid) and cart_id = cast(${cartId} as uuid)
        `);
    if (!rowCount) throw notFound('cart_item_not_found');
    await touchCart(cartId);
    return getCart(userId);
};
export const removeItem = async (userId: string, itemId: string): Promise<CartDto> => {
    const cartId = await cartIdFor(userId);
    if (!cartId) throw notFound('cart_item_not_found');
    const { rowCount } = await db.execute(sql`
    delete from cart_items
    where id = cast(${itemId} as uuid) and cart_id = cast(${cartId} as uuid)
  `);
    if (!rowCount) throw notFound('cart_item_not_found');
    await touchCart(cartId);
    return getCart(userId);
};
const touchCart = async (cartId: string, exec: Executor = db): Promise<void> => {
    await exec.execute(sql`update carts set updated_at = now() where id = cast(${cartId} as uuid)`);
};
export const clearCartWithin = async (
    tx: Tx,
    userId: string,
    lines: { cartItemId: string; quantity: number }[],
): Promise<void> => {
    for (const line of lines) {
        const deleted = await tx.execute(sql`
      delete from cart_items
      where id = cast(${line.cartItemId} as uuid)
        and quantity = ${line.quantity}
        and cart_id in (select id from carts where user_id = cast(${userId} as uuid))
    `);
        if (deleted.rowCount !== 1) {
            throw new AppError(409, 'cart_changed', 'cart changed while checking out');
        }
    }
    await tx.execute(
        sql`update carts set updated_at = now() where user_id = cast(${userId} as uuid)`,
    );
};
export const adoptGuestCart = async (guestUserId: string, userId: string): Promise<void> => {
    if (guestUserId === userId) return;
    await db.transaction(async (tx) => {
        const from = await cartIdFor(guestUserId, tx);
        if (from === null) return;
        const { rows } = await tx.execute<{
            id: string;
        }>(sql`select id from cart_items where cart_id = cast(${from} as uuid) limit 1`);
        if (rows.length === 0) return;
        const to = await ensureCart(userId, tx);
        await tx.execute(sql`
      insert into cart_items
        (cart_id, product_id, variant_id, quantity, unit_price_minor_units, live_session_id)
      select cast(${to} as uuid), product_id, variant_id, quantity, unit_price_minor_units,
             live_session_id
      from cart_items
      where cart_id = cast(${from} as uuid)
      on conflict on constraint cart_items_line_unique do update
        set quantity = least(${MAX_LINE_QUANTITY}, cart_items.quantity + excluded.quantity)
    `);
        await tx.execute(sql`delete from cart_items where cart_id = cast(${from} as uuid)`);
        await touchCart(to, tx);
    });
};
export { cartIdFor, currentSubtotal, ensureCart };
export type { CartItemRow };
