import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import bcrypt from 'bcryptjs';
import { asc, eq, sql } from 'drizzle-orm';

import { MAX_CHAT_SHARDS } from '@shop/shared';

import { db, pool } from '../apps/api/src/db/client.js';
import {
  aiConversations,
  categories,
  liveSessionProducts,
  liveSessions,
  pollOptions,
  polls,
  productVariants,
  products,
  sellers,
  users,
} from '../apps/api/src/db/schema.js';
import { env } from '../apps/api/src/env.js';
import { closeRedis, keys, redis } from '../apps/api/src/lib/redis.js';

/**
 * Deterministic load fixtures. Run once after `db:seed`; `loadtest/reset.ts` then runs
 * before EVERY scenario to restore the mutable state.
 *
 * Nothing here touches the four demo personas — every load identity is
 * `load+<n>@loadtest.invalid`, so a load run can never distort the demo.
 *
 * Produces:
 *  - 600 load users, each with a **pre-signed Redis session**, so k6 never spends a
 *    single iteration on /api/auth/login (which is rate limited to 10/min per IP by
 *    design and would otherwise be the thing under test).
 *  - one load product with two variants: a high-stock checkout variant (L4) and a
 *    separate oversell variant with stock **exactly 100** (L5).
 *  - one live session with `expectedPeakViewers:300`, which at RTM_CHAT_SHARD_TARGET=2
 *    clamps to 49 chat shards — exercising both the clamp and the host's bounded
 *    fan-out while staying under RTM's 50-channels-per-client limit.
 *  - one open poll (L3 votes on it).
 *  - 100 `aiConversations` rows (`status:'running'`, far-future `callbackExpiresAt`), so
 *    L6 signs real conversations instead of measuring a 404 path.
 */

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = resolve(here, '.generated');

const USER_COUNT = 600;
const CONVERSATION_COUNT = 100;
const CHECKOUT_STOCK = 1_000_000;
const OVERSELL_STOCK = 100;
const EXPECTED_PEAK_VIEWERS = 300;

const LOAD_EMAIL_PREFIX = 'load+';
const LOAD_EMAIL_DOMAIN = '@loadtest.invalid';
const LOAD_PRODUCT_SLUG = 'loadtest-bundle';
const CHECKOUT_SKU = 'LOADTEST-CHECKOUT';
const OVERSELL_SKU = 'LOADTEST-OVERSELL';
const LOAD_SESSION_SLUG = 'loadtest-live';
const LOAD_SELLER_SLUG = 'loadtest-fixtures';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Express's `res.cookie(..., {signed:true})` stores `s:<value>.<hmac>`, where the hmac is
 * base64 with padding stripped (cookie-signature). k6 sends the encoded form verbatim.
 */
const signedCookieValue = (sessionId: string): string => {
  const mac = createHmac('sha256', env.SESSION_COOKIE_SECRET)
    .update(sessionId)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sessionId}.${mac}`;
};

const purgeLoadData = async (): Promise<void> => {
  // Order matters: `orders.userId` and `promotionRedemptions.userId` are ON DELETE
  // RESTRICT, so the load users' commerce rows go before the users themselves, and the
  // load product goes last because `orderItems.variantId` is RESTRICT too.
  await db.execute(sql`
    delete from promotion_redemptions
    where user_id in (select id from users where email like ${`${LOAD_EMAIL_PREFIX}%${LOAD_EMAIL_DOMAIN}`})
  `);
  await db.execute(sql`
    delete from orders
    where user_id in (select id from users where email like ${`${LOAD_EMAIL_PREFIX}%${LOAD_EMAIL_DOMAIN}`})
  `);
  await db.execute(sql`
    delete from users where email like ${`${LOAD_EMAIL_PREFIX}%${LOAD_EMAIL_DOMAIN}`}
  `);
  await db.execute(sql`delete from live_sessions where slug = ${LOAD_SESSION_SLUG}`);
  await db.execute(sql`delete from products where slug = ${LOAD_PRODUCT_SLUG}`);
  await db.execute(sql`delete from sellers where slug = ${LOAD_SELLER_SLUG}`);

  // Only the PREVIOUS run's load sessions are revoked, read back from the fixture file.
  // A blanket `sess:*` sweep would log the demo personas out too, which a load fixture
  // has no business doing.
  try {
    const previous = JSON.parse(readFileSync(join(generatedDir, 'sessions.json'), 'utf8')) as {
      users?: { cookie?: string }[];
    };
    const sessionIds = (previous.users ?? [])
      .map((u) => /^sid=s%3A([^.]+)\./.exec(u.cookie ?? '')?.[1])
      .filter((id): id is string => Boolean(id))
      .map((id) => keys.session(decodeURIComponent(id)));
    if (sessionIds.length > 0) await redis.del(...sessionIds);
  } catch {
    // No previous fixture: nothing to revoke. Orphaned keys expire on their own TTL.
  }
};

const run = async (): Promise<void> => {
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .orderBy(asc(categories.slug))
    .limit(1);
  const [host] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, 'seller@demo.test'));
  if (!category || !host) {
    throw new Error('loadtest/seed: run `npm run db:seed` first — the demo catalog is missing');
  }

  console.log('loadtest/seed: purging previous load-only rows and Redis sessions');
  await purgeLoadData();

  // A dedicated seller with no owner, so the synthetic product and session never appear
  // on any demo seller's dashboard. (Each demo storefront has its own owner login;
  // `seller@demo.test` owns Pulse Audio, which is the one this fixture hosts under.)
  const [seller] = await db
    .insert(sellers)
    .values({
      slug: LOAD_SELLER_SLUG,
      displayName: 'Loadtest Fixtures',
      ownerUserId: null,
      rating: 4,
    })
    .returning({ id: sellers.id });
  if (!seller) throw new Error('loadtest/seed: could not create the load seller');

  // One bcrypt hash reused across all 600 identities: the cost-10 work factor is the
  // point of the login path, not of fixture creation.
  const passwordHash = bcrypt.hashSync('loadtest1234', 10);
  const userRows = await db
    .insert(users)
    .values(
      Array.from({ length: USER_COUNT }, (_, i) => ({
        email: `${LOAD_EMAIL_PREFIX}${i}${LOAD_EMAIL_DOMAIN}`,
        passwordHash,
        displayName: `Load User ${i}`,
        role: 'shopper' as const,
        defaultPincode: '560001',
      })),
    )
    .returning({ id: users.id, email: users.email });

  const sessionUsers = userRows.map((user) => {
    const sessionId = randomBytes(32).toString('base64url');
    return {
      userId: user.id,
      email: user.email,
      sessionId,
      cookie: `sid=${encodeURIComponent(signedCookieValue(sessionId))}`,
    };
  });

  const pipeline = redis.pipeline();
  for (const user of sessionUsers) {
    pipeline.set(
      keys.session(user.sessionId),
      JSON.stringify({ userId: user.userId, role: 'shopper' }),
      'EX',
      SESSION_TTL_SECONDS,
    );
  }
  await pipeline.exec();

  const [product] = await db
    .insert(products)
    .values({
      slug: LOAD_PRODUCT_SLUG,
      categoryId: category.id,
      sellerId: seller.id,
      title: 'Loadtest Bundle (synthetic)',
      brand: 'Loadtest',
      description:
        'Synthetic fixture used only by the k6 suite. Never shown in the demo storefront.',
      highlights: ['Load-test fixture'],
      specs: { Purpose: 'load fixture' },
      images: [],
      rating: 4,
      ratingCount: 0,
      basePriceMinorUnits: 100000,
    })
    .returning({ id: products.id });

  const variantRows = await db
    .insert(productVariants)
    .values([
      {
        productId: product!.id,
        sku: CHECKOUT_SKU,
        label: 'Checkout burst (high stock)',
        attrs: { Purpose: 'checkout' },
        priceMinorUnits: 100000,
        stock: CHECKOUT_STOCK,
        isDefault: true,
      },
      {
        productId: product!.id,
        sku: OVERSELL_SKU,
        // Exactly 100: L5 races 500 unique users for it and asserts 100 paid / 400 409s.
        label: 'Oversell race (stock 100)',
        attrs: { Purpose: 'oversell' },
        priceMinorUnits: 100000,
        stock: OVERSELL_STOCK,
        isDefault: false,
      },
    ])
    .returning({ id: productVariants.id, sku: productVariants.sku });

  const variantId = (sku: string): string => {
    const row = variantRows.find((v) => v.sku === sku);
    if (!row) throw new Error(`loadtest/seed: variant ${sku} missing`);
    return row.id;
  };

  const chatShardCount = Math.min(
    Math.max(Math.ceil(EXPECTED_PEAK_VIEWERS / env.RTM_CHAT_SHARD_TARGET), 1),
    MAX_CHAT_SHARDS,
  );

  const [session] = await db
    .insert(liveSessions)
    .values({
      slug: LOAD_SESSION_SLUG,
      sellerId: seller.id,
      title: 'Loadtest Live (synthetic)',
      description: 'Synthetic live session driven by the k6 suite.',
      hostName: 'Loadtest Host',
      hostUserId: host.id,
      status: 'live',
      scheduledFor: new Date(Date.now() - 10 * 60_000),
      startedAt: new Date(Date.now() - 5 * 60_000),
      rtcChannel: `live-${LOAD_SESSION_SLUG}`,
      language: 'en-US',
      expectedPeakViewers: EXPECTED_PEAK_VIEWERS,
      chatShardCount,
      deliveryTier: 'rtc',
      recordingConsentAt: new Date(),
      peakViewers: 0,
    })
    .returning({ id: liveSessions.id });

  await db.insert(liveSessionProducts).values({
    sessionId: session!.id,
    productId: product!.id,
    sortOrder: 0,
    isFeatured: true,
    pinnedAt: new Date(),
  });

  const [poll] = await db
    .insert(polls)
    .values({ sessionId: session!.id, question: 'Loadtest poll: which variant?', status: 'open' })
    .returning({ id: polls.id });
  const optionRows = await db
    .insert(pollOptions)
    .values([
      { pollId: poll!.id, label: 'Option A', sortOrder: 0 },
      { pollId: poll!.id, label: 'Option B', sortOrder: 1 },
      { pollId: poll!.id, label: 'Option C', sortOrder: 2 },
    ])
    .returning({ id: pollOptions.id, label: pollOptions.label });

  // Uids come from the same Postgres sequence the API uses, so a load conversation can
  // never collide with a real viewer, agent, recorder or caption-bot uid.
  const { rows: uidRows } = await pool.query<{ uid: string }>(
    `select nextval('agora_uid_seq')::bigint::text as uid from generate_series(1, $1)`,
    [CONVERSATION_COUNT * 2],
  );

  const farFuture = new Date(Date.now() + 12 * 60 * 60 * 1_000);
  const conversationRows = Array.from({ length: CONVERSATION_COUNT }, (_, i) => {
    const id = randomUUID();
    return {
      id,
      userId: sessionUsers[i % sessionUsers.length]!.userId,
      liveSessionId: session!.id,
      contextProductId: product!.id,
      surface: 'live' as const,
      transport: 'voice' as const,
      language: 'en-US',
      provider: env.LLM_PROVIDER,
      rtcChannel: `ai-${id}`,
      viewerUid: Number.parseInt(uidRows[i * 2]!.uid, 10),
      agentUid: Number.parseInt(uidRows[i * 2 + 1]!.uid, 10),
      agoraAgentId: `loadtest-agent-${i}`,
      // Far future so the background lease sweeper never reaps a conversation L6 is
      // still driving.
      callbackExpiresAt: farFuture,
      status: 'running' as const,
    };
  });
  await db.insert(aiConversations).values(conversationRows);

  // The one-way delivery-tier state and presence keys reset.ts restores per scenario.
  await redis.set(keys.sessionStatus(session!.id), 'live');
  await redis.set(keys.sessionTier(session!.id), 'rtc');
  await redis.del(keys.sessionViewers(session!.id));

  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(
    join(generatedDir, 'sessions.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sessionId: session!.id,
        sessionSlug: LOAD_SESSION_SLUG,
        chatShardCount,
        expectedPeakViewers: EXPECTED_PEAK_VIEWERS,
        productId: product!.id,
        productSlug: LOAD_PRODUCT_SLUG,
        checkoutVariantId: variantId(CHECKOUT_SKU),
        oversellVariantId: variantId(OVERSELL_SKU),
        oversellStock: OVERSELL_STOCK,
        pollId: poll!.id,
        pollOptionIds: optionRows.map((o) => o.id),
        users: sessionUsers.map((u) => ({ userId: u.userId, cookie: u.cookie })),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(generatedDir, 'conversations.json'),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        // L6 mints `X-Convo-Signature` itself with k6/crypto from CONVO_LLM_SHARED_SECRET,
        // so the fixture carries ids only and never a signature that could go stale.
        conversations: conversationRows.map((c) => ({ conversationId: c.id, userId: c.userId })),
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    [
      '',
      'loadtest/seed: complete',
      `  users                 ${sessionUsers.length} (${LOAD_EMAIL_PREFIX}<n>${LOAD_EMAIL_DOMAIN}, Redis sessions pre-signed)`,
      `  live session          ${LOAD_SESSION_SLUG} (${session!.id})`,
      `  expectedPeakViewers   ${EXPECTED_PEAK_VIEWERS} -> chatShardCount ${chatShardCount} (target ${env.RTM_CHAT_SHARD_TARGET}, clamp ${MAX_CHAT_SHARDS})`,
      `  checkout variant      ${CHECKOUT_SKU} stock ${CHECKOUT_STOCK}`,
      `  oversell variant      ${OVERSELL_SKU} stock ${OVERSELL_STOCK}`,
      `  open poll             ${poll!.id} (${optionRows.length} options)`,
      `  ai conversations      ${conversationRows.length} running, callbackExpiresAt ${farFuture.toISOString()}`,
      `  fixtures              loadtest/.generated/sessions.json, conversations.json`,
      '',
      `  NOTE the load stack expects RTC_TIER_MAX_VIEWERS=150 (currently ${env.RTC_TIER_MAX_VIEWERS})`,
      `       and RTM_CHAT_SHARD_TARGET=2 (currently ${env.RTM_CHAT_SHARD_TARGET}).`,
      '',
    ].join('\n'),
  );
};

run()
  .then(async () => {
    await closeRedis();
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await closeRedis();
    await pool.end();
    process.exit(1);
  });
