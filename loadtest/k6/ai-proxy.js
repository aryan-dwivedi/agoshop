import { check } from 'k6';
import crypto from 'k6/crypto';
import { Counter, Trend } from 'k6/metrics';
import http from 'k6/http';

/**
 * L6 — the custom-LLM callback and tool executor, with no browser and no model latency.
 *
 * 100 VUs POST Agora-shaped bodies to `/api/ai/convo/:conversationId/chat/completions`
 * with valid per-conversation HMAC headers, against `LLM_PROVIDER=mock`. That isolates
 * proxy overhead — signature verification, the fresh live-context system message, tool
 * execution, `aiToolCalls` deduplication and SSE framing — from provider latency.
 *
 * This also exercises the PSTN seam: nothing in this path assumes a browser.
 *
 * Two special iterations per VU, by design:
 *   iter 0 — a FRAGMENTED `add_to_cart` tool call (the mock provider splits the call
 *            across chunks), proving delta accumulation by `index`.
 *   iter 1 — the SAME callback body replayed with the SAME `turn_id`. The model re-runs
 *            and mints a fresh `call_…` id, so only the `(conversationId, turnId, name,
 *            argsHash)` row can dedupe it; the cart must not be mutated twice.
 *
 * On the metric: k6's HTTP client buffers the whole response, so `http_req_duration`
 * cannot express time-to-first-SSE-chunk. `http_req_waiting` is time-to-first-response-
 * byte, and the route calls `res.flushHeaders()` before any provider work begins — so
 * that IS the latency Agora sees before the stream opens, and it is what the < 150 ms
 * threshold is set on. Full stream completion is reported separately, unthresholded.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const SECRET = __ENV.CONVO_LLM_SHARED_SECRET || '';
const fixture = JSON.parse(open('../.generated/sessions.json'));
const conversationFixture = JSON.parse(open('../.generated/conversations.json'));

const streamCompleteMs = new Trend('stream_complete_ms', true);
const toolIterations = new Counter('tool_call_iterations');
const replayIterations = new Counter('replay_iterations');
const authFailures = new Counter('callback_auth_failures');
const badFraming = new Counter('bad_sse_framing');

export const options = {
  scenarios: {
    proxy: { executor: 'constant-vus', vus: 100, duration: '30s' },
  },
  thresholds: {
    // Time to first response byte, i.e. when Agora can start reading the SSE stream.
    http_req_waiting: ['p(95)<150'],
    http_req_failed: ['rate<0.01'],
    callback_auth_failures: ['count==0'],
    bad_sse_framing: ['count==0'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  if (SECRET.length === 0) {
    throw new Error('L6 needs CONVO_LLM_SHARED_SECRET in the environment to sign callbacks');
  }
  if (!conversationFixture.conversations || conversationFixture.conversations.length === 0) {
    throw new Error(
      'L6: loadtest/.generated/conversations.json is empty — run npm run loadtest:seed',
    );
  }
  return {};
}

/** signature = base64url(HMAC-SHA256(secret, `<conversationId>.<expires>`)) — unpadded. */
const signedHeaders = (conversationId) => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = crypto.hmac('sha256', SECRET, `${conversationId}.${expires}`, 'base64rawurl');
  return {
    'Content-Type': 'application/json',
    'X-Convo-Id': conversationId,
    'X-Convo-Expires': String(expires),
    'X-Convo-Signature': signature,
    // Placed here only because Agora may require a non-empty key; the route never reads it.
    Authorization: `Bearer ${signature}`,
  };
};

/** The body Agora sends a `vendor:"custom"` / `style:"openai"` endpoint. */
const callbackBody = (turnId, userText) =>
  JSON.stringify({
    context: { channel: `ai-load-${__VU}` },
    model: 'mock',
    messages: [
      { role: 'system', content: 'You are a live-shopping assistant.' },
      { role: 'user', content: userText },
    ],
    turn_id: turnId,
    timestamp: Date.now(),
    tool_choice: 'auto',
    parallel_tool_calls: true,
    stream: true,
    stream_options: { include_usage: true },
    modalities: ['text'],
  });

export default function aiProxy() {
  const entry =
    conversationFixture.conversations[(__VU - 1) % conversationFixture.conversations.length];
  const conversationId = entry.conversationId;

  let turnId = __ITER;
  let userText = `[[mock:text]] what is the price of the featured product? (${__VU}/${__ITER})`;
  let tag = 'ai.text';

  if (__ITER === 0) {
    userText = `[[mock:tool:add_to_cart:${fixture.productId}]] add the featured product to my cart`;
    tag = 'ai.tool';
    toolIterations.add(1);
  } else if (__ITER === 1) {
    // Byte-identical intent AND turn_id as iteration 0: the dedupe row is the only thing
    // that can stop a second cart mutation.
    turnId = 0;
    userText = `[[mock:tool:add_to_cart:${fixture.productId}]] add the featured product to my cart`;
    tag = 'ai.replay';
    replayIterations.add(1);
  }

  const res = http.post(
    `${API}/api/ai/convo/${conversationId}/chat/completions`,
    callbackBody(turnId, userText),
    {
      headers: signedHeaders(conversationId),
      tags: { name: tag },
    },
  );

  if (res.status === 401) authFailures.add(1);
  streamCompleteMs.add(res.timings.duration);

  const body = String(res.body || '');
  const framed = res.status === 200 && body.includes('data: ') && body.includes('data: [DONE]');
  if (!framed) badFraming.add(1);

  check(res, {
    'callback 200': (r) => r.status === 200,
    'content-type is event-stream': (r) =>
      String(r.headers['Content-Type'] || '').includes('text/event-stream'),
    'stream terminates with [DONE]': () => framed,
  });
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/ai-proxy.json': JSON.stringify(data, null, 2),
    stdout:
      `L6 ai-proxy: ttfb_p95=${Math.round(m.http_req_waiting.values['p(95)'])}ms ` +
      `stream_p95=${m.stream_complete_ms ? Math.round(m.stream_complete_ms.values['p(95)']) : 'n/a'}ms ` +
      `tool_iters=${m.tool_call_iterations ? m.tool_call_iterations.values.count : 0} ` +
      `replay_iters=${m.replay_iterations ? m.replay_iterations.values.count : 0} ` +
      `auth_failures=${m.callback_auth_failures ? m.callback_auth_failures.values.count : 0}\n`,
  };
}
