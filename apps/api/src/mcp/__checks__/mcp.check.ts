/**
 * MCP slice check — exercises HMAC auth and a read-only tool round-trip over streamable HTTP:
 *
 *   node --env-file=.env --import tsx apps/api/src/mcp/__checks__/mcp.check.ts
 */
process.env.NODE_ENV = 'test';

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { aiChannelForConversation } from '@shop/shared';
import { sql } from 'drizzle-orm';

const { createApp } = await import('../../app.js');
const { aiServiceRouters } = await import('../../../../ai-service/src/routes.js');
const { db, pool } = await import('../../db/client.js');
const { closeRedis } = await import('../../lib/redis.js');
const { signCallback } = await import('../../ai/callbackAuth.js');

let failures = 0;
let checks = 0;

const ok = (label: string, condition: boolean, detail?: unknown): void => {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

const [userRow] = (
  await db.execute<{ id: string }>(
    sql`select id from users where email = 'shopper@demo.test' limit 1`,
  )
).rows;
if (!userRow) throw new Error('fixture: shopper@demo.test missing — run npm run db:seed');

const [liveRow] = (
  await db.execute<{ id: string }>(sql`
    select id from live_sessions where status in ('live', 'scheduled') limit 1
  `)
).rows;
if (!liveRow) throw new Error('fixture: no live session — run npm run db:seed');

const conversationId = randomUUID();
const rtcChannel = aiChannelForConversation(conversationId);
const callbackExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const expires = Math.floor(callbackExpiresAt.getTime() / 1000);

await db.execute(sql`
  insert into ai_conversations
    (id, user_id, live_session_id, surface, transport, language, provider, rtc_channel,
     viewer_uid, agent_uid, callback_expires_at, status)
  values
    (cast(${conversationId} as uuid), cast(${userRow.id} as uuid), cast(${liveRow.id} as uuid),
     'live', 'voice', 'en-US', 'mock', ${rtcChannel}, 990001, 990002,
     ${callbackExpiresAt.toISOString()}, 'running')
`);

const app = createApp(aiServiceRouters);
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const signedHeaders = (id: string, exp: number, sig?: string): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'X-Convo-Id': id,
  'X-Convo-Expires': String(exp),
  'X-Convo-Signature': sig ?? signCallback(id, exp),
  'X-Convo-Turn-Id': '1',
});

const postMcp = (body: unknown, headers: Record<string, string>): Promise<Response> =>
  fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(body) });

console.log('\n=== MCP auth ===');
const badSig = await postMcp(
  { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_cart', arguments: {} } },
  signedHeaders(conversationId, expires, 'not-a-valid-signature'),
);
ok('invalid signature → 401', badSig.status === 401);

const missing = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'get_cart', arguments: {} },
  }),
});
ok('missing headers → 401', missing.status === 401);

console.log('\n=== MCP tools/call ===');
const toolRes = await postMcp(
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'get_conversation_context', arguments: {} },
  },
  signedHeaders(conversationId, expires),
);
const toolBody = await toolRes.text();
ok('get_conversation_context → 200', toolRes.status === 200, toolRes.status);
ok(
  'context payload mentions surface or session',
  toolBody.includes('live') || toolBody.includes('session'),
  toolBody.slice(0, 200),
);

const invalidArgs = await postMcp(
  {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'search_products', arguments: {} },
  },
  signedHeaders(conversationId, expires),
);
const invalidBody = await invalidArgs.text();
ok(
  'missing required args surfaces validation error',
  invalidArgs.status === 200 &&
    (invalidBody.includes('invalid_arguments') ||
      invalidBody.includes('Input validation error') ||
      invalidBody.includes('isError')),
  invalidBody.slice(0, 200),
);

await db.execute(
  sql`delete from ai_conversations where id = cast(${conversationId} as uuid)`,
);
server.close();
await pool.end();
await closeRedis();

console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
