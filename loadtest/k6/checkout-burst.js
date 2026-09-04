import { check } from 'k6';
import { Counter } from 'k6/metrics';
import http from 'k6/http';

/**
 * L4 — checkout throughput against the high-stock variant.
 *
 * `ramping-arrival-rate` 50 -> 200 iterations/s over 30 s. The linear ramp yields roughly
 * 3,750 iterations, i.e. about 6 orders per load user in 30 s (~12.5 orders/min/user),
 * comfortably inside the 60/min per-user budget.
 *
 * Each iteration is add-to-cart followed by `POST /api/orders` with a fresh per-user
 * `Idempotency-Key`. `paymentMethod: 'upi'` is used deliberately: card and EMI require a
 * card number, and this scenario measures the checkout transaction, not card validation.
 * The 200 ms mock pre-authorization happens OUTSIDE any database transaction, which is
 * what keeps this latency profile achievable at all.
 *
 * Thresholds: p(95) < 750 ms, unexpected failures < 2%.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const RUN_ID = __ENV.RUN_ID || `run-${Date.now()}`;
const fixture = JSON.parse(open('../.generated/sessions.json'));

const ordersCreated = new Counter('orders_created');
const outOfStock = new Counter('out_of_stock');
const unexpected = new Counter('unexpected_status');

export const options = {
  scenarios: {
    checkout: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 300,
      maxVUs: 600,
      stages: [{ target: 200, duration: '30s' }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<750'],
    http_req_failed: ['rate<0.02'],
    unexpected_status: ['count==0'],
    checks: ['rate>0.98'],
  },
};

export default function checkout() {
  const user = fixture.users[(__VU - 1) % fixture.users.length];
  const params = { headers: { Cookie: user.cookie, 'Content-Type': 'application/json' } };
  const key = `${RUN_ID}-${__VU}-${__ITER}`;

  const add = http.post(
    `${API}/api/cart/items`,
    JSON.stringify({
      productId: fixture.productId,
      variantId: fixture.checkoutVariantId,
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
    // 560001 is seeded serviceable; the policy has requireServiceablePincode.
    JSON.stringify({ paymentMethod: 'upi', pincode: '560001' }),
    {
      ...params,
      headers: { ...params.headers, 'Idempotency-Key': `order-${key}` },
      tags: { name: 'orders.create' },
    },
  );

  if (order.status === 201 || order.status === 202) ordersCreated.add(1);
  else if (order.status === 409 && order.json('error.code') === 'out_of_stock') outOfStock.add(1);
  else {
    unexpected.add(1);
    console.error(`L4 unexpected ${order.status}: ${String(order.body).slice(0, 200)}`);
  }

  check(order, { 'order accepted': (r) => r.status === 201 || r.status === 202 });
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/checkout-burst.json': JSON.stringify(data, null, 2),
    stdout:
      `L4 checkout-burst: p95=${Math.round(m.http_req_duration.values['p(95)'])}ms ` +
      `orders=${m.orders_created ? m.orders_created.values.count : 0} ` +
      `failed=${(m.http_req_failed.values.rate * 100).toFixed(2)}%\n`,
  };
}
