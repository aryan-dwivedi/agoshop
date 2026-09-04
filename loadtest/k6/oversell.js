import { check } from 'k6';
import { Counter, Gauge } from 'k6/metrics';
import http from 'k6/http';

/**
 * L5 — the no-oversell proof. Correctness, not latency.
 *
 * 500 unique load users race for a variant with stock exactly 100. The conditional
 * decrement (`UPDATE ... SET stock = stock - $qty WHERE id = $id AND stock >= $qty`) makes
 * overselling structurally impossible, so the expected outcome is exact:
 *   - 100 x `201` paid orders
 *   - 400 x `409 out_of_stock`
 *   - final stock 0
 *   - zero idempotency replays, i.e. no duplicate (userId, idempotencyKey)
 *
 * Every VU uses a distinct user AND a run-scoped key, so a replay would be a real defect
 * rather than an artifact of re-running the suite. `Idempotent-Replay: true` is the
 * observable signal — a replay returns the stored 201, so status alone proves nothing.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const RUN_ID = __ENV.RUN_ID || `run-${Date.now()}`;
const fixture = JSON.parse(open('../.generated/sessions.json'));

const RACERS = 500;

const paid = new Counter('paid_orders');
const outOfStock = new Counter('out_of_stock');
const replays = new Counter('idempotency_replays');
const unexpected = new Counter('unexpected_status');
const finalStock = new Gauge('final_stock');

export const options = {
  scenarios: {
    race: { executor: 'per-vu-iterations', vus: RACERS, iterations: 1, maxDuration: '120s' },
  },
  thresholds: {
    paid_orders: [`count==${fixture.oversellStock}`],
    out_of_stock: [`count==${RACERS - fixture.oversellStock}`],
    idempotency_replays: ['count==0'],
    unexpected_status: ['count==0'],
    final_stock: ['value==0'],
  },
};

export default function oversell() {
  // One user per VU: 500 distinct identities, so per-user rate limits and the
  // `first_order` segment behave identically for every racer.
  const user = fixture.users[(__VU - 1) % fixture.users.length];
  const params = { headers: { Cookie: user.cookie, 'Content-Type': 'application/json' } };
  const key = `${RUN_ID}-oversell-${__VU}`;

  const add = http.post(
    `${API}/api/cart/items`,
    JSON.stringify({
      productId: fixture.productId,
      variantId: fixture.oversellVariantId,
      quantity: 1,
    }),
    {
      ...params,
      headers: { ...params.headers, 'Idempotency-Key': `add-${key}` },
      tags: { name: 'cart.add' },
    },
  );
  if (!check(add, { 'add-to-cart 200': (r) => r.status === 200 })) return;

  const order = http.post(
    `${API}/api/orders`,
    JSON.stringify({ paymentMethod: 'upi', pincode: '560001' }),
    {
      ...params,
      headers: { ...params.headers, 'Idempotency-Key': `order-${key}` },
      tags: { name: 'orders.create' },
    },
  );

  if (order.headers['Idempotent-Replay'] === 'true') replays.add(1);

  if (order.status === 201) paid.add(1);
  else if (order.status === 409 && order.json('error.code') === 'out_of_stock') outOfStock.add(1);
  else {
    unexpected.add(1);
    console.error(`L5 unexpected ${order.status}: ${String(order.body).slice(0, 200)}`);
  }
}

export function teardown() {
  const res = http.get(`${API}/api/products/${fixture.productSlug}`);
  if (res.status !== 200) {
    console.error(`L5: could not read the fixture product (${res.status})`);
    finalStock.add(-1);
    return;
  }
  const variant = res.json('product.variants').find((v) => v.id === fixture.oversellVariantId);
  const stock = variant ? variant.stock : -1;
  finalStock.add(stock);
  console.log(`L5: final stock on the oversell variant = ${stock}`);
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/oversell.json': JSON.stringify(data, null, 2),
    stdout:
      `L5 oversell: paid=${m.paid_orders ? m.paid_orders.values.count : 0} ` +
      `out_of_stock=${m.out_of_stock ? m.out_of_stock.values.count : 0} ` +
      `replays=${m.idempotency_replays ? m.idempotency_replays.values.count : 0} ` +
      `final_stock=${m.final_stock ? m.final_stock.values.value : 'n/a'}\n`,
  };
}
