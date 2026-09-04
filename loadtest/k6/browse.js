import { check, sleep } from 'k6';
import http from 'k6/http';

/**
 * L1 — unauthenticated storefront browse.
 *
 * 200 VUs for 60 s over `GET /api/products` with mixed facets and `GET /api/products/:slug`.
 * The generator runs from a RATE_LIMIT_TRUSTED_CIDRS address, so the shared *IP* bucket
 * does not distort the measurement; per-user buckets are never bypassed and this
 * scenario is unauthenticated anyway.
 *
 * Thresholds: p(95) < 200 ms, unexpected HTTP failures < 1%.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';

export const options = {
  scenarios: {
    browse: { executor: 'constant-vus', vus: 200, duration: '60s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  // Facets and slugs come from the live catalog, so the script never hardcodes seed data.
  const res = http.get(`${API}/api/products?pageSize=48`);
  if (res.status !== 200) throw new Error(`setup: GET /api/products returned ${res.status}`);
  const body = res.json();
  const slugs = body.items.map((p) => p.slug);
  const categories = (body.facets && body.facets.categories ? body.facets.categories : [])
    .map((c) => c.slug || c.categorySlug)
    .filter(Boolean);
  if (slugs.length === 0) throw new Error('setup: catalog is empty — run npm run db:seed');
  return { slugs, categories };
}

const QUERIES = [
  '',
  '?sort=price_asc',
  '?sort=rating&minRating=4.3',
  '?maxPriceMinorUnits=300000',
  '?q=linen',
  '?q=serum&sort=price_desc',
  '?page=2&pageSize=12',
];

export default function browse(data) {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const category =
    data.categories.length > 0
      ? data.categories[Math.floor(Math.random() * data.categories.length)]
      : '';
  const categoryParam = category
    ? query.startsWith('?')
      ? `&category=${category}`
      : `?category=${category}`
    : '';

  const list = http.get(`${API}/api/products${query}${categoryParam}`, {
    tags: { name: 'products.list' },
  });
  check(list, {
    'list 200': (r) => r.status === 200,
    'list has items array': (r) => Array.isArray(r.json('items')),
  });

  const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];
  const detail = http.get(`${API}/api/products/${slug}`, { tags: { name: 'products.detail' } });
  check(detail, {
    'detail 200': (r) => r.status === 200,
    'detail has variants': (r) => Array.isArray(r.json('product.variants')),
  });

  sleep(0.2);
}

export function handleSummary(data) {
  return {
    'loadtest/results/browse.json': JSON.stringify(data, null, 2),
    stdout: `L1 browse: p95=${Math.round(data.metrics.http_req_duration.values['p(95)'])}ms failed=${(
      data.metrics.http_req_failed.values.rate * 100
    ).toFixed(2)}%\n`,
  };
}
