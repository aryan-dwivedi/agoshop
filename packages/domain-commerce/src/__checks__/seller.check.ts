import type { PublicUser } from '@shop/shared';
import type { SQL } from 'drizzle-orm';
import type { Server } from 'node:http';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createApp } from '@shop/api/app.js';
import { router as authRouter } from '@shop/api/routes/auth.js';
import { router as catalogRouter } from '@shop/api/routes/catalog.js';
import { router as healthRouter } from '@shop/api/routes/health.js';
import { router as sellerRouter } from '@shop/api/routes/seller.js';
import { db, pool } from '@shop/db/client.js';
import { closeRedis } from '@shop/platform/lib/redis.js';

import { LOW_STOCK_THRESHOLD, sellerOverview, sessionAnalytics } from '../analytics.js';
import { invalidateCatalogCache } from '../catalog.js';

const PASSWORD = 'demo1234';
const SELLER_EMAIL = 'seller@demo.test';
const SHOPPER_EMAIL = 'shopper@demo.test';
const CATEGORY_SLUG = 'home';
const MARK = `zephyrine${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const TITLE = `Zephyrine ${MARK} Stovetop Kettle`;
const PRICE_SMALL = 249900;
const PRICE_LARGE = 329900;
const STOCK_SMALL = 12;
const STOCK_LARGE = 5;
type Fixtures = {
    foreignSellerId: string;
    productIds: string[];
};
const fixtures: Fixtures = { foreignSellerId: '', productIds: [] };
const one = async <T extends Record<string, unknown>>(statement: SQL): Promise<T> => {
    const { rows } = await db.execute<T>(statement);
    const row = rows[0] as T | undefined;
    assert.ok(row, 'expected exactly one row');
    return row;
};
const insertFixtures = async (): Promise<void> => {
    const seller = await one<{
        id: string;
    }>(sql`
    insert into sellers (slug, display_name) values (${`${MARK}-seller`}, ${'Unowned Seller'})
    returning id
  `);
    fixtures.foreignSellerId = seller.id;
};
const cleanup = async (): Promise<void> => {
    for (const productId of fixtures.productIds) {
        await db.execute(
            sql`delete from product_views where product_id = cast(${productId} as uuid)`,
        );
        await db.execute(
            sql`delete from product_variants where product_id = cast(${productId} as uuid)`,
        );
        await db.execute(sql`delete from products where id = cast(${productId} as uuid)`);
    }
    if (fixtures.foreignSellerId) {
        await db.execute(
            sql`delete from sellers where id = cast(${fixtures.foreignSellerId} as uuid)`,
        );
    }
    await invalidateCatalogCache();
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
type UserBody = {
    user: PublicUser;
};
type VariantDto = {
    id: string;
    sku: string;
    label: string;
    priceMinorUnits: number;
    mrpMinorUnits: number | null;
    stock: number;
    isDefault: boolean;
};
type SellerProductDto = {
    productId: string;
    slug: string;
    title: string;
    brand: string;
    categorySlug: string;
    imageUrl: string | null;
    rating: number;
    sellerId: string;
    priceMinorUnits: number;
    totalStock: number;
    lowStock: boolean;
    variants: VariantDto[];
};
type CreatedBody = {
    product: SellerProductDto;
};
type InventoryBody = {
    lowStockThreshold: number;
    sellerId: string;
    sellers: {
        id: string;
        slug: string;
        displayName: string;
    }[];
    products: SellerProductDto[];
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
const createBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    title: TITLE,
    brand: 'Zephyrine',
    description: `A fixture kettle created by the seller acceptance check, run ${MARK}.`,
    categorySlug: CATEGORY_SLUG,
    images: ['/img/check-kettle.png'],
    highlights: ['Triple-ply base', 'Whistling spout'],
    specs: { Capacity: '1.5 L', Material: 'Stainless steel' },
    variants: [
        { label: '1.5 litre', priceMinorUnits: PRICE_SMALL, stock: STOCK_SMALL },
        { label: '2.5 litre', priceMinorUnits: PRICE_LARGE, stock: STOCK_LARGE, isDefault: true },
    ],
    ...overrides,
});
const login = async (client: Client, email: string): Promise<void> => {
    const res = await client.request<UserBody>('POST', '/api/auth/login', {
        email,
        password: PASSWORD,
    });
    assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
};
const pass = (label: string): void => {
    console.log(`  ok  ${label}`);
};
const run = async (): Promise<void> => {
    await insertFixtures();
    const app = createApp([healthRouter, authRouter, catalogRouter, sellerRouter]);
    const listening = Promise.withResolvers<Server>();
    const server: Server = app.listen(0, () => listening.resolve(server));
    await listening.promise;
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    try {
        console.log(`seller.check — listings tagged ${MARK}`);
        const seller = makeClient(base);
        await login(seller, SELLER_EMAIL);
        pass(`POST /api/auth/login signs in ${SELLER_EMAIL}`);
        const created = await seller.request<CreatedBody>(
            'POST',
            '/api/seller/products',
            createBody(),
        );
        assert.equal(created.status, 201, JSON.stringify(created.body));
        const product = created.body.product;
        fixtures.productIds.push(product.productId);
        assert.equal(product.title, TITLE);
        assert.equal(product.categorySlug, CATEGORY_SLUG);
        assert.equal(product.imageUrl, '/img/check-kettle.png');
        assert.equal(product.variants.length, 2, 'both variants must come back');
        assert.equal(
            product.variants.filter((v) => v.isDefault).length,
            1,
            'exactly one variant is the default',
        );
        const flaggedDefault = product.variants.find((v) => v.isDefault);
        assert.ok(flaggedDefault);
        assert.equal(flaggedDefault.label, '2.5 litre', 'the flagged variant stays the default');
        assert.equal(
            product.priceMinorUnits,
            PRICE_SMALL,
            'the listed price is the CHEAPEST variant, not the default one',
        );
        assert.equal(product.totalStock, STOCK_SMALL + STOCK_LARGE);
        assert.equal(product.lowStock, product.totalStock <= LOW_STOCK_THRESHOLD);
        for (const variant of product.variants) {
            assert.ok(variant.sku.length >= 3, 'an omitted SKU is derived, never left empty');
            assert.equal(variant.mrpMinorUnits, null, 'no MRP was published');
        }
        assert.equal(
            new Set(product.variants.map((v) => v.sku)).size,
            2,
            'derived SKUs must differ per variant',
        );
        pass('POST /api/seller/products returns 201 with both variants and one default');
        const basePrice = await one<{
            base_price_minor_units: number;
        }>(sql`
      select base_price_minor_units from products where id = cast(${product.productId} as uuid)
    `);
        assert.equal(
            basePrice.base_price_minor_units,
            PRICE_SMALL,
            'products.basePriceMinorUnits is the minimum variant price',
        );
        pass('products.base_price_minor_units stores the minimum variant price');
        const inventory = await seller.request<InventoryBody>('GET', '/api/seller/products');
        assert.equal(inventory.status, 200, JSON.stringify(inventory.body));
        const listed = inventory.body.products.find((p) => p.productId === product.productId);
        assert.ok(listed, 'GET /api/seller/products must return the new listing');
        assert.equal(listed.slug, product.slug, 'the create response and the listing agree');
        assert.equal(listed.totalStock, product.totalStock);
        pass('GET /api/seller/products includes the new listing in the same shape');
        const pdp = await seller.request<{
            product: {
                id: string;
                slug: string;
            };
        }>('GET', `/api/products/${product.slug}`);
        assert.equal(pdp.status, 200, JSON.stringify(pdp.body));
        assert.equal(pdp.body.product.id, product.productId);
        pass('GET /api/products/:slug serves the new listing publicly');
        const search = await seller.request<{
            items: {
                id: string;
            }[];
            total: number;
        }>('GET', `/api/products?q=${MARK}&sort=relevance`);
        assert.equal(search.status, 200, JSON.stringify(search.body));
        assert.ok(
            search.body.items.some((i) => i.id === product.productId),
            'the FTS expression index must cover rows inserted after the index was built',
        );
        pass('GET /api/products?q= matches the new listing through the FTS index');
        const twin = await seller.request<CreatedBody>(
            'POST',
            '/api/seller/products',
            createBody({
                variants: [
                    {
                        label: '1.5 litre',
                        sku: `${MARK}-twin-a`,
                        priceMinorUnits: PRICE_SMALL,
                        stock: 3,
                    },
                ],
            }),
        );
        assert.equal(twin.status, 201, JSON.stringify(twin.body));
        fixtures.productIds.push(twin.body.product.productId);
        assert.equal(twin.body.product.slug, `${product.slug}-2`, 'a slug collision counts up');
        assert.equal(
            twin.body.product.variants[0]?.isDefault,
            true,
            'a lone unflagged variant becomes the default',
        );
        pass('a duplicate title yields slug -2 and defaults its only variant');
        const shopper = makeClient(base);
        await login(shopper, SHOPPER_EMAIL);
        const refusedShopper = await shopper.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({ title: `${TITLE} Shopper Attempt` }),
        );
        assert.equal(refusedShopper.status, 403, JSON.stringify(refusedShopper.body));
        assert.equal(refusedShopper.body.error.code, 'insufficient_role');
        pass('a shopper is refused with 403 insufficient_role');
        const anonymous = makeClient(base);
        const refusedAnonymous = await anonymous.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({ title: `${TITLE} Anonymous Attempt` }),
        );
        assert.equal(refusedAnonymous.status, 401, JSON.stringify(refusedAnonymous.body));
        pass('an unauthenticated call is refused with 401');
        const foreign = await seller.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({ sellerId: fixtures.foreignSellerId, title: `${TITLE} Foreign Attempt` }),
        );
        assert.equal(foreign.status, 403, JSON.stringify(foreign.body));
        assert.equal(foreign.body.error.code, 'seller_not_owned');
        pass("listing under another owner's seller is seller_not_owned");
        const takenSku = product.variants[0]?.sku;
        assert.ok(takenSku);
        const duplicate = await seller.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({
                title: `${TITLE} Duplicate SKU`,
                variants: [
                    { label: 'Clash', sku: takenSku, priceMinorUnits: PRICE_SMALL, stock: 1 },
                ],
            }),
        );
        assert.equal(duplicate.status, 400, JSON.stringify(duplicate.body));
        assert.equal(duplicate.body.error.code, 'sku_taken');
        pass('a SKU already in use is sku_taken, not a 500');
        const orphans = await one<{
            n: number;
        }>(sql`
      select count(*)::int as n from products where title = ${`${TITLE} Duplicate SKU`}
    `);
        assert.equal(orphans.n, 0, 'a refused create must not leave a product row behind');
        pass('the refused create left no product row behind');
        const badMrp = await seller.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({
                title: `${TITLE} Bad MRP`,
                variants: [
                    {
                        label: 'Marked down to nothing',
                        priceMinorUnits: PRICE_SMALL,
                        mrpMinorUnits: PRICE_SMALL,
                        stock: 1,
                    },
                ],
            }),
        );
        assert.equal(badMrp.status, 400, JSON.stringify(badMrp.body));
        assert.equal(badMrp.body.error.code, 'mrp_below_price');
        pass('an MRP at or below the price is mrp_below_price');
        const badCategory = await seller.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({ title: `${TITLE} Bad Category`, categorySlug: `${MARK}-nope` }),
        );
        assert.equal(badCategory.status, 400, JSON.stringify(badCategory.body));
        assert.equal(badCategory.body.error.code, 'unknown_category');
        pass('an unknown categorySlug is unknown_category');
        const twoDefaults = await seller.request<ErrorBody>(
            'POST',
            '/api/seller/products',
            createBody({
                title: `${TITLE} Two Defaults`,
                variants: [
                    { label: 'A', priceMinorUnits: PRICE_SMALL, stock: 1, isDefault: true },
                    { label: 'B', priceMinorUnits: PRICE_LARGE, stock: 1, isDefault: true },
                ],
            }),
        );
        assert.equal(twoDefaults.status, 400, JSON.stringify(twoDefaults.body));
        assert.equal(twoDefaults.body.error.code, 'invalid_body');
        pass('two variants flagged as default is invalid_body');
        console.log('\nseller.check PASSED');
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
        console.error('\nseller.check FAILED');
        console.error(err);
        await shutdown();
        process.exit(1);
    });
