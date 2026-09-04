import type { CartDto, OrderDto, PublicUser } from '@shop/shared';
import type { SQL } from 'drizzle-orm';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createApp } from '@shop/api/app.js';
import { router as adminRouter } from '@shop/api/routes/admin.js';
import { router as authRouter } from '@shop/api/routes/auth.js';
import { router as cartRouter } from '@shop/api/routes/cart.js';
import { router as catalogRouter } from '@shop/api/routes/catalog.js';
import { router as checkoutRouter } from '@shop/api/routes/checkout.js';
import { router as configRouter } from '@shop/api/routes/config.js';
import { router as eventsRouter } from '@shop/api/routes/eventsStub.js';
import { router as healthRouter } from '@shop/api/routes/health.js';
import { router as meRouter } from '@shop/api/routes/me.js';
import { router as ordersRouter } from '@shop/api/routes/orders.js';
import { router as wishlistRouter } from '@shop/api/routes/wishlist.js';
import { db, pool } from '@shop/db/client.js';
import { invalidateCatalogCache } from '@shop/domain-commerce/catalog.js';
import { endSession } from '@shop/domain-live/sessions/lifecycle.js';
import { closeRedis, keys, redis } from '@shop/platform/lib/redis.js';
import { drainAnalyticsOnce } from '@shop/worker/background.js';

import { compareProducts } from '../catalog.js';
import { personalizedOffers, resolveLiveOffer } from '../promotions.js';
import { recommend } from '../recommendations.js';
import { checkDelivery } from '../serviceability.js';

const TAG = `chk-${randomUUID().slice(0, 8)}`;
const PRICE = 250000;
const STOCK = 7;
type Fixtures = {
    categoryId: string;
    sellerId: string;
    productId: string;
    variantId: string;
    otherProductId: string;
    otherVariantId: string;
    liveSessionId: string;
    policyId: string | null;
    pincodeInserted: boolean;
    promotionId: string;
    extraPromotionIds: string[];
    userIds: string[];
};
const fixtures: Fixtures = {
    categoryId: '',
    sellerId: '',
    productId: '',
    variantId: '',
    otherProductId: '',
    otherVariantId: '',
    liveSessionId: '',
    policyId: null,
    pincodeInserted: false,
    promotionId: '',
    extraPromotionIds: [],
    userIds: [],
};
const one = async <T extends Record<string, unknown>>(statement: SQL): Promise<T> => {
    const { rows } = await db.execute<T>(statement);
    const row = rows[0] as T | undefined;
    assert.ok(row, 'expected exactly one row');
    return row;
};
const insertFixtures = async (): Promise<void> => {
    const category = await one<{
        id: string;
    }>(sql`
    insert into categories (slug, name) values (${`${TAG}-cat`}, ${`Check Category ${TAG}`})
    returning id
  `);
    fixtures.categoryId = category.id;
    const seller = await one<{
        id: string;
    }>(sql`
    insert into sellers (slug, display_name) values (${`${TAG}-seller`}, ${`Check Seller ${TAG}`})
    returning id
  `);
    fixtures.sellerId = seller.id;
    const product = await one<{
        id: string;
    }>(sql`
    insert into products (slug, category_id, seller_id, title, brand, description,
                          base_price_minor_units, images)
    values (${`${TAG}-product`}, cast(${fixtures.categoryId} as uuid),
            cast(${fixtures.sellerId} as uuid), ${'Check Widget'}, ${'CheckBrand'},
            ${'A fixture product used by the commerce acceptance check.'}, ${PRICE},
            cast(${JSON.stringify(['/img/check.png'])} as jsonb))
    returning id
  `);
    fixtures.productId = product.id;
    const variant = await one<{
        id: string;
    }>(sql`
    insert into product_variants (product_id, sku, label, price_minor_units, stock, is_default)
    values (cast(${fixtures.productId} as uuid), ${`${TAG}-sku`}, ${'Default'}, ${PRICE},
            ${STOCK}, true)
    returning id
  `);
    fixtures.variantId = variant.id;
    const otherProduct = await one<{
        id: string;
    }>(sql`
    insert into products (slug, category_id, seller_id, title, brand, description,
                          base_price_minor_units)
    values (${`${TAG}-product-2`}, cast(${fixtures.categoryId} as uuid),
            cast(${fixtures.sellerId} as uuid), ${'Unrelated Widget'}, ${'CheckBrand'},
            ${'A fixture product deliberately not attached to the session.'}, ${PRICE})
    returning id
  `);
    fixtures.otherProductId = otherProduct.id;
    const otherVariant = await one<{
        id: string;
    }>(sql`
    insert into product_variants (product_id, sku, label, price_minor_units, stock, is_default)
    values (cast(${fixtures.otherProductId} as uuid), ${`${TAG}-sku-2`}, ${'Default'}, ${PRICE},
            ${STOCK}, true)
    returning id
  `);
    fixtures.otherVariantId = otherVariant.id;
    const session = await one<{
        id: string;
    }>(sql`
    insert into live_sessions (slug, seller_id, title, host_name, status, started_at, rtc_channel)
    values (${`${TAG}-session`}, cast(${fixtures.sellerId} as uuid), ${'Check Session'},
            ${'Check Host'}, 'live', now(), ${`live-${TAG}-session`})
    returning id
  `);
    fixtures.liveSessionId = session.id;
    await db.execute(sql`
    insert into live_session_products (session_id, product_id, sort_order, is_featured)
    values (cast(${fixtures.liveSessionId} as uuid), cast(${fixtures.productId} as uuid), 0, true)
  `);
    const promotion = await one<{
        id: string;
    }>(sql`
    insert into promotions (code, label, kind, value, priority, stackable, conditions, active)
    values (${`${TAG.toUpperCase().replace(/-/g, '_')}_LIVE`}, ${'Check live offer'}, 'percent', 20,
            100, false, cast(${JSON.stringify({ requiresLiveSession: true })} as jsonb), true)
    returning id
  `);
    fixtures.promotionId = promotion.id;
    const { rows: policies } = await db.execute<{
        id: string;
    }>(sql`select id from checkout_policies where active = true limit 1`);
    if (policies.length === 0) {
        const policy = await one<{
            id: string;
        }>(sql`
      insert into checkout_policies (name, min_order_minor_units, cod_max_order_minor_units,
                                     emi_min_order_minor_units, allowed_methods, blocked_pincodes,
                                     require_serviceable_pincode, active)
      values (${`${TAG}-policy`}, 0, 500000, 300000,
              cast(${JSON.stringify(['card', 'upi', 'cod', 'emi'])} as jsonb),
              cast(${JSON.stringify([])} as jsonb), false, true)
      returning id
    `);
        fixtures.policyId = policy.id;
    }
    const { rowCount: pincodeInserted } = await db.execute(sql`
    insert into pincodes (pincode, city, state, serviceable, cod_available, eta_days)
    values ('560001', 'Bengaluru', 'Karnataka', true, true, 2)
    on conflict (pincode) do nothing
  `);
    fixtures.pincodeInserted = (pincodeInserted ?? 0) > 0;
    await invalidateCatalogCache();
    await redis.del(keys.promotionsCache, keys.checkoutPolicyCache);
};
const cleanup = async (): Promise<void> => {
    const users = fixtures.userIds;
    if (users.length > 0) {
        const ids = sql.join(
            users.map((u) => sql`cast(${u} as uuid)`),
            sql`, `,
        );
        await db.execute(sql`delete from promotion_redemptions where user_id in (${ids})`);
        await db.execute(
            sql`delete from order_items where order_id in (select id from orders where user_id in (${ids}))`,
        );
        await db.execute(sql`delete from orders where user_id in (${ids})`);
        await db.execute(
            sql`delete from cart_items where cart_id in (select id from carts where user_id in (${ids}))`,
        );
        await db.execute(sql`delete from carts where user_id in (${ids})`);
        await db.execute(sql`delete from product_views where user_id in (${ids})`);
        await db.execute(sql`delete from wishlist_items where user_id in (${ids})`);
        await db.execute(sql`delete from users where id in (${ids})`);
    }
    if (fixtures.promotionId) {
        await db.execute(
            sql`delete from promotions where id = cast(${fixtures.promotionId} as uuid)`,
        );
    }
    for (const promotionId of fixtures.extraPromotionIds) {
        await db.execute(sql`delete from promotions where id = cast(${promotionId} as uuid)`);
    }
    if (fixtures.policyId) {
        await db.execute(
            sql`delete from checkout_policies where id = cast(${fixtures.policyId} as uuid)`,
        );
    }
    if (fixtures.pincodeInserted) {
        await db.execute(sql`delete from pincodes where pincode = '560001'`);
    }
    if (fixtures.liveSessionId) {
        await db.execute(
            sql`delete from live_session_products where session_id = cast(${fixtures.liveSessionId} as uuid)`,
        );
        await db.execute(
            sql`delete from live_sessions where id = cast(${fixtures.liveSessionId} as uuid)`,
        );
    }
    for (const productId of [fixtures.productId, fixtures.otherProductId]) {
        if (!productId) continue;
        await db.execute(
            sql`delete from product_views where product_id = cast(${productId} as uuid)`,
        );
        await db.execute(
            sql`delete from product_variants where product_id = cast(${productId} as uuid)`,
        );
        await db.execute(sql`delete from products where id = cast(${productId} as uuid)`);
    }
    if (fixtures.sellerId) {
        await db.execute(sql`delete from sellers where id = cast(${fixtures.sellerId} as uuid)`);
    }
    if (fixtures.categoryId) {
        await db.execute(
            sql`delete from categories where id = cast(${fixtures.categoryId} as uuid)`,
        );
    }
    await Promise.all([
        invalidateCatalogCache(),
        redis.del(keys.promotionsCache, keys.checkoutPolicyCache),
    ]);
};
type ApiResponse<T> = {
    status: number;
    body: T;
};
type ErrorBody = {
    error: {
        code: string;
        message: string;
        requestId: string;
    };
};
type HealthBody = {
    status: string;
    db: string;
    redis: string;
    version: string;
};
type UserBody = {
    user: PublicUser;
};
type OrderBody = {
    order: OrderDto;
};
type Client = {
    cookie: string | null;
    request: <T>(
        method: string,
        path: string,
        body?: unknown,
        headers?: Record<string, string>,
    ) => Promise<ApiResponse<T>>;
};
const makeClient = (base: string): Client => {
    const client: Client = {
        cookie: null,
        request: async <T>(
            method: string,
            path: string,
            body?: unknown,
            headers: Record<string, string> = {},
        ): Promise<ApiResponse<T>> => {
            const res = await fetch(`${base}${path}`, {
                method,
                headers: {
                    'content-type': 'application/json',
                    ...(client.cookie ? { cookie: client.cookie } : {}),
                    ...headers,
                },
                body: body === undefined ? undefined : JSON.stringify(body),
            });
            const setCookie = res.headers.getSetCookie();
            if (setCookie.length > 0) {
                client.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
            }
            const text = await res.text();
            let parsed: unknown = null;
            try {
                parsed = text ? JSON.parse(text) : null;
            } catch {
                parsed = text;
            }
            return { status: res.status, body: parsed as T };
        },
    };
    return client;
};
const stockOf = async (variantId: string): Promise<number> => {
    const row = await one<{
        stock: number;
    }>(sql`select stock from product_variants where id = cast(${variantId} as uuid)`);
    return row.stock;
};
const countRows = async (statement: SQL): Promise<number> => {
    const row = await one<{
        n: number;
    }>(statement);
    return row.n;
};
const pass = (label: string): void => {
    console.log(`  ok  ${label}`);
};
const settleAfter = (ms: number): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
};
const run = async (): Promise<void> => {
    await insertFixtures();
    const app = createApp([
        healthRouter,
        configRouter,
        authRouter,
        catalogRouter,
        cartRouter,
        checkoutRouter,
        ordersRouter,
        wishlistRouter,
        adminRouter,
        eventsRouter,
        meRouter,
    ]);
    const server: Server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const api = makeClient(base);
    try {
        console.log(`commerce.check — fixtures tagged ${TAG}`);
        const health = await api.request<HealthBody>('GET', '/api/health');
        assert.equal(health.status, 200, JSON.stringify(health.body));
        assert.equal(health.body.db, 'up');
        assert.equal(health.body.redis, 'up');
        pass('GET /api/health reports db and redis up');
        const email = `${TAG}@checks.invalid`;
        const registered = await api.request<UserBody>('POST', '/api/auth/register', {
            email,
            password: 'check1234',
            displayName: 'Check Shopper',
            defaultPincode: '560001',
        });
        assert.equal(registered.status, 201, JSON.stringify(registered.body));
        const userId = registered.body.user.id;
        fixtures.userIds.push(userId);
        pass(`POST /api/auth/register created ${email}`);
        const me = await api.request<UserBody>('GET', '/api/auth/me');
        assert.equal(me.status, 200);
        assert.equal(me.body.user.id, userId);
        pass('GET /api/auth/me resolves the session cookie');
        const pdp = await api.request<{
            product: {
                id: string;
                variants: {
                    id: string;
                }[];
            };
        }>('GET', `/api/products/${TAG}-product`);
        assert.equal(pdp.status, 200, JSON.stringify(pdp.body));
        assert.equal(pdp.body.product.id, fixtures.productId);
        const viewCount = await countRows(sql`
      select count(*)::int as n from product_views
      where user_id = cast(${userId} as uuid) and product_id = cast(${fixtures.productId} as uuid)
    `);
        assert.equal(viewCount, 1, 'GET /api/products/:slug must record a productViews row');
        pass('GET /api/products/:slug returns the product and records a productViews row');
        const search = await api.request<{
            items: {
                id: string;
            }[];
            total: number;
        }>('GET', '/api/products?q=CheckBrand%20Widget&sort=relevance');
        assert.equal(search.status, 200, JSON.stringify(search.body));
        assert.ok(
            search.body.items.some((i) => i.id === fixtures.productId),
            'full-text search must find the fixture product',
        );
        pass('GET /api/products?q= matches through to_tsvector/plainto_tsquery');
        for (const [term, source] of [
            [`Check Seller ${TAG}`, 'seller'],
            [`Check Category ${TAG}`, 'category'],
            [`${TAG}-sku`, 'SKU'],
        ] as const) {
            const discovery = await api.request<{
                items: {
                    id: string;
                }[];
            }>('GET', `/api/products?q=${encodeURIComponent(term)}&sort=relevance`);
            assert.equal(discovery.status, 200, JSON.stringify(discovery.body));
            assert.ok(
                discovery.body.items.some((i) => i.id === fixtures.productId),
                `catalog search must find the fixture by ${source}`,
            );
        }
        pass('GET /api/products?q= also matches seller, category, and variant SKU');
        const first = await api.request<CartDto>(
            'POST',
            '/api/cart/items',
            { productId: fixtures.productId, variantId: fixtures.variantId, quantity: 1 },
            { 'Idempotency-Key': `${TAG}-add-1` },
        );
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const second = await api.request<CartDto>(
            'POST',
            '/api/cart/items',
            { productId: fixtures.productId, variantId: fixtures.variantId, quantity: 1 },
            { 'Idempotency-Key': `${TAG}-add-2` },
        );
        assert.equal(second.status, 200, JSON.stringify(second.body));
        const cart = second.body;
        assert.equal(cart.items.length, 1, 'two browse adds must coalesce into one cart line');
        assert.equal(cart.items[0]?.quantity, 2);
        assert.equal(cart.items[0]?.liveSessionId, null);
        assert.equal(cart.items[0]?.pricing.grossMinorUnits, PRICE * 2);
        const lineCount = await countRows(sql`
      select count(*)::int as n from cart_items ci
      join carts c on c.id = ci.cart_id
      where c.user_id = cast(${userId} as uuid)
    `);
        assert.equal(lineCount, 1, 'exactly one cart_items row must exist');
        pass('two identical browse adds coalesce into ONE cart_items row (qty 2)');
        const lineId = cart.items[0]?.id ?? '';
        const patched = await api.request<CartDto>('PATCH', `/api/cart/items/${lineId}`, {
            quantity: 4,
        });
        assert.equal(patched.status, 200, JSON.stringify(patched.body));
        assert.equal(patched.body.items[0]?.quantity, 4);
        assert.equal(patched.body.items[0]?.pricing.grossMinorUnits, PRICE * 4);
        const restored = await api.request<CartDto>('PATCH', `/api/cart/items/${lineId}`, {
            quantity: 2,
        });
        assert.equal(restored.body.items[0]?.quantity, 2);
        const extra = await api.request<CartDto>(
            'POST',
            '/api/cart/items',
            { productId: fixtures.otherProductId, variantId: fixtures.otherVariantId, quantity: 1 },
            { 'Idempotency-Key': `${TAG}-add-other` },
        );
        assert.equal(extra.body.items.length, 2);
        const extraLineId = extra.body.items.find(
            (i) => i.productId === fixtures.otherProductId,
        )?.id;
        assert.ok(extraLineId);
        const deleted = await api.request<CartDto>('DELETE', `/api/cart/items/${extraLineId}`);
        assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
        assert.equal(deleted.body.items.length, 1, 'the deleted line is gone');
        pass('PATCH quantity re-prices the line and DELETE removes it');
        const mismatch = await api.request<ErrorBody>(
            'POST',
            '/api/cart/items',
            {
                productId: fixtures.otherProductId,
                variantId: fixtures.otherVariantId,
                quantity: 1,
                liveSessionId: fixtures.liveSessionId,
            },
            { 'Idempotency-Key': `${TAG}-mismatch` },
        );
        assert.equal(mismatch.status, 400, JSON.stringify(mismatch.body));
        assert.equal(mismatch.body.error.code, 'invalid_live_session_product');
        pass('unrelated (liveSessionId, productId) pair -> 400 invalid_live_session_product');
        const liveAdd = await api.request<CartDto>(
            'POST',
            '/api/cart/items',
            {
                productId: fixtures.productId,
                variantId: fixtures.variantId,
                quantity: 1,
                liveSessionId: fixtures.liveSessionId,
            },
            { 'Idempotency-Key': `${TAG}-live-add` },
        );
        assert.equal(liveAdd.status, 200, JSON.stringify(liveAdd.body));
        assert.equal(liveAdd.body.items.length, 2, 'the live line is a separate cart line');
        const liveLine = liveAdd.body.items.find((i) => i.liveSessionId === fixtures.liveSessionId);
        assert.ok(liveLine, 'a line bound to the live session must exist');
        assert.equal(liveLine.liveEligible, true);
        assert.equal(liveLine.pricing.discountMinorUnits, PRICE / 5, '20% of one unit');
        assert.ok(liveAdd.body.notices.includes('live_discount_active'));
        pass('live-eligible line receives the live promotion and raises live_discount_active');
        await endSession(fixtures.liveSessionId);
        const repriced = await api.request<CartDto>('GET', '/api/cart');
        assert.equal(repriced.status, 200, JSON.stringify(repriced.body));
        const endedLine = repriced.body.items.find(
            (i) => i.liveSessionId === fixtures.liveSessionId,
        );
        assert.ok(endedLine, 'the live-bound line survives session end');
        assert.equal(endedLine.liveEligible, false);
        assert.equal(endedLine.pricing.discountMinorUnits, 0, 'live discount must drop');
        assert.equal(endedLine.pricing.netMinorUnits, PRICE, 'back to shop price');
        assert.ok(repriced.body.notices.includes('live_discount_expired'));
        assert.ok(!repriced.body.notices.includes('live_discount_active'));
        pass('session end drops live discount and raises live_discount_expired');
        const options = await api.request<{
            methods: string[];
            blockedReason: string | null;
        }>('GET', '/api/checkout/options?pincode=560001');
        assert.equal(options.status, 200, JSON.stringify(options.body));
        assert.equal(options.body.blockedReason, null);
        assert.ok(options.body.methods.includes('card'), 'card must be an allowed method');
        pass('GET /api/checkout/options answers from the active checkout_policies row');
        const stockBefore = await stockOf(fixtures.variantId);
        const declined = await api.request<ErrorBody>(
            'POST',
            '/api/orders',
            {
                paymentMethod: 'card',
                pincode: '560001',
                card: { number: '4111111111110000', expiry: '12/30', cvv: '123', name: 'Check' },
            },
            { 'Idempotency-Key': `${TAG}-order-declined` },
        );
        assert.equal(declined.status, 402, JSON.stringify(declined.body));
        assert.equal(declined.body.error.code, 'payment_declined');
        const orderCount = await countRows(
            sql`select count(*)::int as n from orders where user_id = cast(${userId} as uuid)`,
        );
        assert.equal(orderCount, 0, 'a declined pre-authorization must write no order row');
        assert.equal(await stockOf(fixtures.variantId), stockBefore, 'stock must be unchanged');
        const survived = await api.request<CartDto>('GET', '/api/cart');
        assert.equal(survived.body.items.length, 2, 'the cart must survive a decline');
        pass('card ending 0000 -> 402 payment_declined, no order row, stock unchanged');
        const declineRowsFor = async (): Promise<number> =>
            countRows(sql`
        select count(*)::int as n from analytics_events
        where type = 'payment_declined' and user_id = cast(${userId} as uuid)
      `);
        let declineRows = 0;
        for (let attempt = 0; attempt < 15 && declineRows === 0; attempt += 1) {
            await drainAnalyticsOnce().catch(() => 0);
            declineRows = await declineRowsFor();
            if (declineRows === 0) await settleAfter(200);
        }
        assert.equal(declineRows, 1, 'a decline must write exactly one analytics row');
        const declineRow = await one<{
            payload: Record<string, unknown>;
        }>(sql`
      select payload from analytics_events
      where type = 'payment_declined' and user_id = cast(${userId} as uuid)
    `);
        assert.ok(
            !JSON.stringify(declineRow.payload).includes('4111'),
            'decline telemetry must never carry card data',
        );
        pass('a decline records one payment_declined event, with no card data');
        const expectedTotal = survived.body.totals.totalMinorUnits;
        const paid = await api.request<OrderBody>(
            'POST',
            '/api/orders',
            {
                paymentMethod: 'card',
                pincode: '560001',
                card: { number: '4111111111111111', expiry: '12/30', cvv: '123', name: 'Check' },
            },
            { 'Idempotency-Key': `${TAG}-order-paid` },
        );
        assert.ok([201, 202].includes(paid.status), JSON.stringify(paid.body));
        if (paid.body.order.status === 'pending') {
            const { captureOrder } = await import('../ordersAsync.js');
            await captureOrder(paid.body.order.id);
            const settled = await api.request<OrderBody>(
                'GET',
                `/api/orders/${paid.body.order.id}`,
            );
            paid.body = settled.body;
        }
        assert.equal(paid.body.order.status, 'paid');
        assert.equal(paid.body.order.totalMinorUnits, expectedTotal);
        assert.equal(await stockOf(fixtures.variantId), stockBefore - 3, 'stock decremented by 3');
        const emptied = await api.request<CartDto>('GET', '/api/cart');
        assert.equal(emptied.body.items.length, 0, 'the cart is cleared on success');
        const liveAttributed = paid.body.order.items.filter(
            (i) => i.liveSessionId === fixtures.liveSessionId,
        );
        assert.equal(liveAttributed.length, 1, 'live attribution is stored per order line');
        pass('paid order: stock decremented, cart cleared, per-line live attribution stored');
        const replay = await api.request<OrderBody>(
            'POST',
            '/api/orders',
            { paymentMethod: 'card', pincode: '560001', card: { number: '4111111111111111' } },
            { 'Idempotency-Key': `${TAG}-order-paid` },
        );
        assert.ok([201, 202].includes(replay.status));
        assert.equal(
            replay.body.order.id,
            paid.body.order.id,
            'the same key replays the same order',
        );
        assert.equal(
            await stockOf(fixtures.variantId),
            stockBefore - 3,
            'a replay decrements nothing',
        );
        pass('replayed Idempotency-Key returns the original order without touching stock');
        const history = await api.request<{
            orders: OrderDto[];
        }>('GET', '/api/orders');
        assert.equal(history.status, 200);
        assert.equal(history.body.orders.length, 1, 'exactly one order was persisted');
        const detail = await api.request<OrderBody>('GET', `/api/orders/${paid.body.order.id}`);
        assert.equal(detail.status, 200, JSON.stringify(detail.body));
        assert.equal(detail.body.order.id, paid.body.order.id);
        assert.ok(detail.body.order.items.length >= 1);
        pass('GET /api/orders and /api/orders/:id return the order with its breakdown');
        const wishAdd = await api.request<{
            added: boolean;
        }>('POST', '/api/wishlist', {
            productId: fixtures.productId,
        });
        assert.equal(wishAdd.status, 200, JSON.stringify(wishAdd.body));
        assert.equal(wishAdd.body.added, true);
        const wishList = await api.request<{
            items: {
                id: string;
            }[];
        }>('GET', '/api/wishlist');
        assert.ok(wishList.body.items.some((p) => p.id === fixtures.productId));
        const wishDel = await api.request<{
            removed: boolean;
        }>('DELETE', `/api/wishlist?productId=${fixtures.productId}`);
        assert.equal(wishDel.body.removed, true);
        pass('wishlist add / list / delete round trip');
        const sseAbort = new AbortController();
        const sse = await fetch(`${base}/api/events?sessionId=${fixtures.liveSessionId}`, {
            headers: { cookie: api.cookie ?? '' },
            signal: sseAbort.signal,
        });
        assert.equal(sse.status, 200);
        assert.equal(sse.headers.get('content-type'), 'text/event-stream');
        assert.equal(sse.headers.get('cache-control'), 'no-cache');
        assert.equal(sse.headers.get('x-accel-buffering'), 'no');
        const reader = sse.body?.getReader();
        const chunk = await reader?.read();
        assert.ok(
            new TextDecoder().decode(chunk?.value).includes(': connected'),
            'the stream must open with a comment frame',
        );
        sseAbort.abort();
        pass('GET /api/events streams with text/event-stream, no-cache, X-Accel-Buffering: no');
        const forbidden = await api.request<ErrorBody>('GET', '/api/admin/promotions');
        assert.equal(forbidden.status, 403, 'a shopper must not read the promotion rules');
        assert.equal(forbidden.body.error.code, 'insufficient_role');
        const adminApi = makeClient(base);
        const adminEmail = `${TAG}-admin@checks.invalid`;
        const adminUser = await adminApi.request<UserBody>('POST', '/api/auth/register', {
            email: adminEmail,
            password: 'check1234',
            displayName: 'Check Admin',
        });
        assert.equal(adminUser.status, 201, JSON.stringify(adminUser.body));
        fixtures.userIds.push(adminUser.body.user.id);
        await db.execute(
            sql`update users set role = 'admin' where id = cast(${adminUser.body.user.id} as uuid)`,
        );
        await adminApi.request<UserBody>('POST', '/api/auth/login', {
            email: adminEmail,
            password: 'check1234',
        });
        const rules = await adminApi.request<{
            promotions: {
                id: string;
                code: string;
            }[];
        }>('GET', '/api/admin/promotions');
        assert.equal(rules.status, 200, JSON.stringify(rules.body));
        assert.ok(rules.body.promotions.some((p) => p.id === fixtures.promotionId));
        const createdCode = `${TAG.toUpperCase().replace(/-/g, '_')}_FLAT`;
        const created = await adminApi.request<{
            promotion: {
                id: string;
                active: boolean;
            };
        }>('POST', '/api/admin/promotions', {
            code: createdCode,
            label: 'Check flat rule',
            kind: 'flat',
            value: 10000,
            priority: 10,
            stackable: true,
            conditions: { categorySlugs: [`${TAG}-cat`] },
        });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        fixtures.extraPromotionIds.push(created.body.promotion.id);
        const promoPatched = await adminApi.request<{
            promotion: {
                active: boolean;
                value: number;
            };
        }>('PATCH', `/api/admin/promotions/${created.body.promotion.id}`, {
            active: false,
            value: 20000,
        });
        assert.equal(promoPatched.status, 200, JSON.stringify(promoPatched.body));
        assert.equal(promoPatched.body.promotion.active, false);
        assert.equal(promoPatched.body.promotion.value, 20000);
        const policy = await adminApi.request<{
            policy: {
                id: string;
                minOrderMinorUnits: number;
            };
        }>('GET', '/api/admin/checkout-policy');
        assert.equal(policy.status, 200, JSON.stringify(policy.body));
        const policyPatched = await adminApi.request<{
            policy: {
                minOrderMinorUnits: number;
            };
        }>('PATCH', '/api/admin/checkout-policy', {
            minOrderMinorUnits: policy.body.policy.minOrderMinorUnits,
        });
        assert.equal(policyPatched.status, 200, JSON.stringify(policyPatched.body));
        assert.equal(
            policyPatched.body.policy.minOrderMinorUnits,
            policy.body.policy.minOrderMinorUnits,
        );
        pass('admin promotions CRUD + checkout-policy patch behind requireRole(admin)');
        const offer = await resolveLiveOffer({
            userId,
            liveSessionId: fixtures.liveSessionId,
            productId: fixtures.productId,
            surface: 'live',
        });
        assert.equal(offer.active, true, JSON.stringify(offer));
        assert.equal(offer.kind, 'percent');
        assert.equal(offer.value, 20);
        assert.equal(offer.effectiveDiscountMinorUnits, PRICE / 5);
        assert.deepEqual(offer.eligibleProductIds, [fixtures.productId]);
        const browseOffer = await resolveLiveOffer({
            userId,
            liveSessionId: null,
            productId: fixtures.productId,
            surface: 'browse',
        });
        assert.equal(browseOffer.active, false);
        assert.equal(browseOffer.effectiveDiscountMinorUnits, 0);
        pass('resolveLiveOffer reports kind/value/effective amount from the rule, not a constant');
        const offers = await personalizedOffers({ userId, productId: fixtures.productId });
        assert.ok(Array.isArray(offers.applied) && Array.isArray(offers.suppressed));
        const comparison = await compareProducts([fixtures.productId, fixtures.otherProductId]);
        assert.equal(comparison.rows.length, 2);
        assert.equal(comparison.rows[0]?.priceMinorUnits, PRICE);
        const recommended = await recommend({ userId, productId: fixtures.productId, limit: 4 });
        assert.ok(
            recommended.every((p) => p.id !== fixtures.productId),
            'recommendations never include the product they are based on',
        );
        const delivery = await checkDelivery('560001');
        assert.equal(delivery.serviceable, true);
        const unknownPincode = await checkDelivery('999999');
        assert.equal(unknownPincode.serviceable, false);
        assert.equal(unknownPincode.reason, 'unknown_pincode');
        pass('personalizedOffers / compareProducts / recommend / checkDelivery contracts hold');
        const erasedApi = makeClient(base);
        const erasedEmail = `${TAG}-erase@checks.invalid`;
        const erasedUser = await erasedApi.request<UserBody>('POST', '/api/auth/register', {
            email: erasedEmail,
            password: 'check1234',
            displayName: 'Check Erasure',
        });
        assert.equal(erasedUser.status, 201, JSON.stringify(erasedUser.body));
        const erasedId = erasedUser.body.user.id;
        fixtures.userIds.push(erasedId);
        await erasedApi.request<{
            added: boolean;
        }>('POST', '/api/wishlist', {
            productId: fixtures.productId,
        });
        const erasure = await erasedApi.request<{
            erased: boolean;
        }>('DELETE', '/api/me/data');
        assert.equal(erasure.status, 200, JSON.stringify(erasure.body));
        const leftovers = await countRows(
            sql`select count(*)::int as n from wishlist_items where user_id = cast(${erasedId} as uuid)`,
        );
        assert.equal(leftovers, 0, 'wishlist rows must be gone');
        const tombstone = await one<{
            email: string;
            display_name: string;
            deleted_at: string | null;
        }>(
            sql`select email, display_name, deleted_at from users where id = cast(${erasedId} as uuid)`,
        );
        assert.ok(tombstone.deleted_at, 'the user row is tombstoned, not deleted');
        assert.notEqual(tombstone.email, erasedEmail, 'the email must be scrubbed');
        assert.equal(tombstone.display_name, 'Erased user');
        pass('DELETE /api/me/data removes personal rows and tombstones the user');
        console.log('\ncommerce.check PASSED');
    } finally {
        server.close();
        await cleanup();
    }
};
const shutdown = async (): Promise<void> => {
    await closeRedis();
    await pool.end();
};
run()
    .then(shutdown)
    .catch(async (err) => {
        console.error('\ncommerce.check FAILED');
        console.error(err);
        await shutdown();
        process.exit(1);
    });
