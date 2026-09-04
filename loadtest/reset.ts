import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';

import { db, pool } from '../apps/api/src/db/client.js';
import { closeRedis, keys, redis } from '../apps/api/src/lib/redis.js';

/**
 * Runs before EVERY k6 scenario, so each one starts from the same state and the suite is
 * repeatable rather than only correct on a cold database.
 *
 * Restores:
 *  - variant stock (checkout variant high, oversell variant back to exactly 100)
 *  - load users' carts, orders and promotion redemptions (so L4/L5 idempotency keys,
 *    the `first_order` segment and per-user redemption caps all start clean)
 *  - poll votes and the Redis poll counters
 *  - viewer presence
 *  - the Redis stream + consumer-group state, so L3's backlog assertion measures this
 *    run's drain and not a previous one's leftovers
 *  - the load session's ONE-WAY state: `liveSessions.deliveryTier='rtc'`,
 *    `session:<id>:deliveryTier='rtc'`, `session:<id>:status='live'` and an empty
 *    `session:<id>:viewers`. Without this, the rtc -> cdn transition would only ever be
 *    observable on the very first run, because decision 8 forbids it flipping back.
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '.generated/sessions.json');

const LOAD_EMAIL_LIKE = 'load+%@loadtest.invalid';
const CHECKOUT_SKU = 'LOADTEST-CHECKOUT';
const OVERSELL_SKU = 'LOADTEST-OVERSELL';
const CHECKOUT_STOCK = 1_000_000;
const OVERSELL_STOCK = 100;

type Fixture = { sessionId: string; pollId: string };

const run = async (): Promise<void> => {
  let fixture: Fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
  } catch {
    throw new Error(
      `loadtest/reset: ${join('loadtest', '.generated/sessions.json')} missing — run npm run loadtest:seed`,
    );
  }

  await db.execute(
    sql`update product_variants set stock = ${CHECKOUT_STOCK} where sku = ${CHECKOUT_SKU}`,
  );
  await db.execute(
    sql`update product_variants set stock = ${OVERSELL_STOCK} where sku = ${OVERSELL_SKU}`,
  );

  // Carts cascade to cart_items; orders cascade to order_items. Redemptions are
  // RESTRICT-bound to users, so they go before anything else touches them.
  await db.execute(sql`
    delete from promotion_redemptions where user_id in (select id from users where email like ${LOAD_EMAIL_LIKE})
  `);
  await db.execute(sql`
    delete from orders where user_id in (select id from users where email like ${LOAD_EMAIL_LIKE})
  `);
  await db.execute(sql`
    delete from carts where user_id in (select id from users where email like ${LOAD_EMAIL_LIKE})
  `);
  await db.execute(sql`delete from poll_votes where poll_id = ${fixture.pollId}`);
  await db.execute(sql`
    update live_sessions set delivery_tier = 'rtc', status = 'live', peak_viewers = 0, ended_at = null
    where id = ${fixture.sessionId}
  `);

  await redis.del(keys.pollVotes(fixture.pollId));
  await redis.del(keys.sessionViewers(fixture.sessionId));
  await redis.del(keys.sessionReactions(fixture.sessionId));
  await redis.set(keys.sessionStatus(fixture.sessionId), 'live');
  await redis.set(keys.sessionTier(fixture.sessionId), 'rtc');

  // Dropping the stream keys drops their consumer groups with them; background.ts
  // recreates the group on the next tick when it sees NOGROUP.
  await redis.del(keys.analyticsStream, keys.summaryStream);

  console.log(
    `loadtest/reset: stock restored (${CHECKOUT_SKU}=${CHECKOUT_STOCK}, ${OVERSELL_SKU}=${OVERSELL_STOCK}), ` +
      `load carts/orders/redemptions cleared, poll votes cleared, presence cleared, ` +
      `analytics + summary streams reset, session ${fixture.sessionId} back to status=live tier=rtc`,
  );
};

run()
  .then(async () => {
    await closeRedis();
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeRedis();
    await pool.end();
    process.exit(1);
  });
