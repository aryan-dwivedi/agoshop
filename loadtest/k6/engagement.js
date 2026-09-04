import { check, sleep } from 'k6';
import { Gauge, Trend } from 'k6/metrics';
import http from 'k6/http';

/**
 * L3 — chat + reactions + poll votes under sustained load, and the analytics drain.
 *
 * 300 VUs for 60 s; each VU sends one chat message and one reaction per second, and
 * exactly one poll vote for the whole run. That is:
 *   - <= 300 RTM REST publishes/s — 60% of Agora's 500 req/s per-App-ID default, leaving
 *     headroom for host fan-out and moderation. The 120/min per-user chat and reaction
 *     budgets are sized exactly for this profile.
 *   - ~600 analytics events/s against a configured drain of 2,000 rows/s
 *     (ANALYTICS_DRAIN_BATCH=500 every ANALYTICS_DRAIN_INTERVAL_MS=250).
 *
 * The backlog is read from the API's own `analytics_stream_backlog` gauge through nginx,
 * so it measures the deployed drain, not a local estimate.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const fixture = JSON.parse(open('../.generated/sessions.json'));

const backlogAtEnd = new Gauge('analytics_backlog_at_end');
const backlogDrainSeconds = new Trend('analytics_backlog_drain_seconds');

const EMOJI = ['\u2764\ufe0f', '\ud83d\udd25', '\ud83d\udc4f', '\ud83d\ude2e'];

export const options = {
  scenarios: {
    engage: { executor: 'constant-vus', vus: 300, duration: '60s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<250'],
    http_req_failed: ['rate<0.01'],
    // The drain must be keeping up at the end of the run, and fully caught up shortly after.
    analytics_backlog_at_end: ['value<2000'],
    analytics_backlog_drain_seconds: ['max<15'],
    checks: ['rate>0.99'],
  },
};

const readBacklog = () => {
  const res = http.get(`${API}/metrics`, { tags: { name: 'metrics' } });
  if (res.status !== 200) return null;
  const line = res.body.split('\n').find((l) => l.startsWith('analytics_stream_backlog '));
  if (!line) return null;
  const value = Number.parseFloat(line.split(' ')[1]);
  return Number.isFinite(value) ? value : null;
};

export default function engagement() {
  const user = fixture.users[(__VU - 1) % fixture.users.length];
  const params = { headers: { Cookie: user.cookie, 'Content-Type': 'application/json' } };

  const chat = http.post(
    `${API}/api/sessions/${fixture.sessionId}/chat`,
    JSON.stringify({ messageId: `k6-${__VU}-${__ITER}`, text: `load message ${__VU}/${__ITER}` }),
    { ...params, tags: { name: 'sessions.chat' } },
  );
  check(chat, { 'chat 200': (r) => r.status === 200 });

  const reaction = http.post(
    `${API}/api/sessions/${fixture.sessionId}/reactions`,
    JSON.stringify({ emoji: EMOJI[__ITER % EMOJI.length] }),
    { ...params, tags: { name: 'sessions.reaction' } },
  );
  check(reaction, { 'reaction 200': (r) => r.status === 200 });

  // One vote per VU for the whole run: the (pollId, userId) primary key makes a second
  // vote a rejection, which is L3's correctness check rather than a load signal.
  if (__ITER === 0) {
    const optionId = fixture.pollOptionIds[__VU % fixture.pollOptionIds.length];
    const vote = http.post(
      `${API}/api/polls/${fixture.pollId}/vote`,
      JSON.stringify({ optionId }),
      {
        ...params,
        tags: { name: 'polls.vote' },
      },
    );
    check(vote, { 'vote 200': (r) => r.status === 200 });
  }

  sleep(1);
}

export function teardown() {
  const atEnd = readBacklog();
  if (atEnd === null) {
    console.error('L3: could not read analytics_stream_backlog from /metrics');
    backlogAtEnd.add(Number.MAX_SAFE_INTEGER);
    return;
  }
  backlogAtEnd.add(atEnd);
  console.log(`L3: analytics backlog at end of run = ${atEnd}`);

  // The drain target is 2,000 rows/s against ~600/s offered, so a fully caught-up stream
  // is the expected steady state within seconds of the load stopping.
  const started = Date.now();
  for (let elapsed = 0; elapsed < 15; elapsed += 1) {
    const backlog = readBacklog();
    if (backlog === 0) {
      const seconds = (Date.now() - started) / 1000;
      backlogDrainSeconds.add(seconds);
      console.log(`L3: backlog reached 0 after ${seconds.toFixed(1)}s`);
      return;
    }
    sleep(1);
  }
  backlogDrainSeconds.add(15);
  console.error('L3: backlog did not reach 0 within 15s');
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/engagement.json': JSON.stringify(data, null, 2),
    stdout:
      `L3 engagement: p95=${Math.round(m.http_req_duration.values['p(95)'])}ms ` +
      `backlog_at_end=${m.analytics_backlog_at_end ? m.analytics_backlog_at_end.values.value : 'n/a'} ` +
      `drain_seconds=${m.analytics_backlog_drain_seconds ? m.analytics_backlog_drain_seconds.values.max : 'n/a'}\n`,
  };
}
