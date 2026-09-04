import { check } from 'k6';
import crypto from 'k6/crypto';
import { Counter, Trend } from 'k6/metrics';
import http from 'k6/http';

/**
 * L7 — MCP streamable HTTP tool execution with per-conversation HMAC headers.
 *
 * 100 VUs POST JSON-RPC `tools/call` to `/mcp` with valid signed headers against
 * `get_conversation_context` and `get_cart`, isolating MCP auth + handler overhead
 * from Agora-managed LLM latency.
 */

const API = __ENV.API_BASE || 'http://127.0.0.1:8080';
const SECRET = __ENV.CONVO_LLM_SHARED_SECRET || '';
const conversationFixture = JSON.parse(open('../.generated/conversations.json'));

const toolCompleteMs = new Trend('mcp_tool_complete_ms', true);
const authFailures = new Counter('mcp_auth_failures');
const contextCalls = new Counter('mcp_context_calls');
const cartCalls = new Counter('mcp_cart_calls');

export const options = {
  scenarios: {
    mcp: { executor: 'constant-vus', vus: 100, duration: '30s' },
  },
  thresholds: {
    http_req_waiting: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
    mcp_auth_failures: ['count==0'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  if (SECRET.length === 0) {
    throw new Error('L7 needs CONVO_LLM_SHARED_SECRET in the environment to sign MCP requests');
  }
  if (!conversationFixture.conversations || conversationFixture.conversations.length === 0) {
    throw new Error(
      'L7: loadtest/.generated/conversations.json is empty — run npm run loadtest:seed',
    );
  }
  return {};
}

const signedHeaders = (conversationId, turnId) => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const signature = crypto.hmac('sha256', SECRET, `${conversationId}.${expires}`, 'base64rawurl');
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'X-Convo-Id': conversationId,
    'X-Convo-Expires': String(expires),
    'X-Convo-Signature': signature,
    'X-Convo-Turn-Id': String(turnId),
  };
};

const toolCallBody = (toolName, args, id) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  });

export default function mcpProxy() {
  const entry =
    conversationFixture.conversations[(__VU - 1) % conversationFixture.conversations.length];
  const conversationId = entry.conversationId;
  const turnId = __ITER;
  const toolName = __ITER % 2 === 0 ? 'get_conversation_context' : 'get_cart';
  const tag = toolName === 'get_conversation_context' ? 'mcp.context' : 'mcp.cart';

  if (toolName === 'get_conversation_context') contextCalls.add(1);
  else cartCalls.add(1);

  const res = http.post(
    `${API}/mcp`,
    toolCallBody(toolName, {}, turnId),
    {
      headers: signedHeaders(conversationId, turnId),
      tags: { name: tag },
    },
  );

  if (res.status === 401) authFailures.add(1);
  toolCompleteMs.add(res.timings.duration);

  const body = String(res.body || '');
  check(res, {
    'mcp 200': (r) => r.status === 200,
    'jsonrpc result present': () => body.includes('"result"') || body.includes('structuredContent'),
  });
}

export function handleSummary(data) {
  const m = data.metrics;
  return {
    'loadtest/results/mcp-proxy.json': JSON.stringify(data, null, 2),
    stdout:
      `L7 mcp-proxy: ttfb_p95=${Math.round(m.http_req_waiting.values['p(95)'])}ms ` +
      `tool_p95=${m.mcp_tool_complete_ms ? Math.round(m.mcp_tool_complete_ms.values['p(95)']) : 'n/a'}ms ` +
      `context=${m.mcp_context_calls ? m.mcp_context_calls.values.count : 0} ` +
      `cart=${m.mcp_cart_calls ? m.mcp_cart_calls.values.count : 0} ` +
      `auth_failures=${m.mcp_auth_failures ? m.mcp_auth_failures.values.count : 0}\n`,
  };
}
