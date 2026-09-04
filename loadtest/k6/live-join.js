import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import http from 'k6/http';

/**
 * L2 — authenticated live join + presence heartbeats across two API replicas.
 *
 * 300 VUs, each joining once and sending 5 heartbeats. With RTC_TIER_MAX_VIEWERS=150 the
 * pruned viewer count crosses the threshold mid-run, so the one-way rtc -> cdn flip
 * (decision 8) happens under real concurrency rather than at the first join.
 *
 * What is asserted here, and how it maps to "exactly one transition":
 *  - `tier_reverts` counts any VU that saw `cdn` and later `rtc`. Decision 8 forbids that,
 *    so the threshold is count==0.
 *  - `tier_final_not_cdn` counts a teardown read of the session that is not `cdn`, proving
 *    the flip happened and is stored for later joiners.
 *  Together with `A15` (which asserts the single published event server-side, something a
 *  k6 script cannot observe), that is the full claim.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const fixture = JSON.parse(open('../.generated/sessions.json'));

const joinsRtc = new Counter('joins_rtc');
const joinsCdn = new Counter('joins_cdn');
const tierReverts = new Counter('tier_reverts');
const tierFinalNotCdn = new Counter('tier_final_not_cdn');

export const options = {
  scenarios: {
    join: { executor: 'per-vu-iterations', vus: 300, iterations: 1, maxDuration: '90s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
    tier_reverts: ['count==0'],
    tier_final_not_cdn: ['count==0'],
    checks: ['rate>0.99'],
  },
};

export default function liveJoin() {
  const user = fixture.users[(__VU - 1) % fixture.users.length];
  const params = { headers: { Cookie: user.cookie, 'Content-Type': 'application/json' } };

  const join = http.post(`${API}/api/sessions/${fixture.sessionId}/join`, '{}', {
    ...params,
    tags: { name: 'sessions.join' },
  });
  const ok = check(join, {
    'join 200': (r) => r.status === 200,
    'join returns a tier': (r) =>
      r.json('deliveryTier') === 'rtc' || r.json('deliveryTier') === 'cdn',
    'join returns the frozen shard count': (r) =>
      r.json('chatShardCount') === fixture.chatShardCount,
  });
  if (!ok) return;

  let tier = join.json('deliveryTier');
  if (tier === 'cdn') joinsCdn.add(1);
  else joinsRtc.add(1);

  for (let i = 0; i < 5; i += 1) {
    sleep(1);
    const beat = http.post(`${API}/api/sessions/${fixture.sessionId}/heartbeat`, '{}', {
      ...params,
      tags: { name: 'sessions.heartbeat' },
    });
    check(beat, { 'heartbeat 200': (r) => r.status === 200 });
  }

  // Re-read the session: a VU that saw cdn must never see rtc again.
  const after = http.get(`${API}/api/sessions/${fixture.sessionSlug}`, {
    ...params,
    tags: { name: 'sessions.read' },
  });
  if (after.status === 200) {
    const observed = after.json('session.deliveryTier') || after.json('deliveryTier');
    if (tier === 'cdn' && observed === 'rtc') tierReverts.add(1);
    tier = observed;
  }
}

export function teardown() {
  const res = http.get(`${API}/api/sessions/${fixture.sessionSlug}`);
  const tier =
    res.status === 200 ? res.json('session.deliveryTier') || res.json('deliveryTier') : null;
  if (tier !== 'cdn') {
    tierFinalNotCdn.add(1);
    console.error(`L2: expected the session to end on the cdn tier, saw ${tier}`);
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/live-join.json': JSON.stringify(data, null, 2),
    stdout:
      `L2 live-join: p95=${Math.round(m.http_req_duration.values['p(95)'])}ms ` +
      `rtc_joins=${m.joins_rtc ? m.joins_rtc.values.count : 0} ` +
      `cdn_joins=${m.joins_cdn ? m.joins_cdn.values.count : 0} ` +
      `reverts=${m.tier_reverts ? m.tier_reverts.values.count : 0}\n`,
  };
}
