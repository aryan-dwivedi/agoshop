import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { sql } from 'drizzle-orm';

import { aiChannelForConversation } from '@shop/shared';

process.env.NODE_ENV = 'test';
process.env.MCP_STATIC_API_KEY = 'mcp-static-check-secret-key';

const { createApp } = await import('@shop/api/app.js');
const { aiServiceRouters } = await import('@shop/ai-service/routes.js');
const { db, pool } = await import('@shop/db/client.js');
const { closeRedis } = await import('@shop/platform/lib/redis.js');
const { signCallback } = await import('../../callbackAuth.js');
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
await db.execute(sql`delete from users where email like 'mcp-check-%@checks.invalid'`);
const [userRow] = (
    await db.execute<{ id: string }>(sql`
    insert into users (email, password_hash, display_name, role)
    values (${`mcp-check-${randomUUID()}@checks.invalid`}, 'not-used', 'MCP Check', 'shopper')
    returning id
  `)
).rows;
if (!userRow) throw new Error('fixture: could not create shopper');
const [productRow] = (
    await db.execute<{ product_id: string; variant_id: string }>(sql`
    select p.id as product_id, pv.id as variant_id
    from products p
    join product_variants pv on pv.product_id = p.id
    order by pv.is_default desc, pv.id
    limit 1
  `)
).rows;
if (!productRow) throw new Error('fixture: no active product variant — run npm run db:seed');
const conversationId = randomUUID();
const rtcChannel = aiChannelForConversation(conversationId);
const callbackExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const expires = Math.floor(callbackExpiresAt.getTime() / 1000);
await db.execute(sql`
    insert into ai_conversations
    (id, user_id, surface, transport, language, provider, rtc_channel,
     viewer_uid, agent_uid, agora_agent_id, callback_expires_at, status)
  values
    (cast(${conversationId} as uuid), cast(${userRow.id} as uuid),
     'browse', 'voice', 'en-US', 'mock', ${rtcChannel}, 990001, 990002,
     'fixture-agent-id', ${callbackExpiresAt.toISOString()}, 'running')
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
const missingGet = await fetch(`${base}/mcp`, {
    method: 'GET',
    headers: { accept: 'text/event-stream' },
});
ok('GET without auth → 401', missingGet.status === 401);
const signedGet = await fetch(`${base}/mcp`, {
    method: 'GET',
    headers: {
        accept: 'text/event-stream',
        'X-Convo-Id': conversationId,
        'X-Convo-Expires': String(expires),
        'X-Convo-Signature': signCallback(conversationId, expires),
    },
});
ok('GET with auth is not rejected as 405', signedGet.status !== 405, signedGet.status);
const staticProbeHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer mcp-static-check-secret-key',
};
const consoleInitialize = await postMcp(
    {
        jsonrpc: '2.0',
        id: 0,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'agora-console', version: '1.0' },
        },
    },
    staticProbeHeaders,
);
const consoleInitializeBody = await consoleInitialize.text();
ok(
    'static bearer initialize (console probe) → 200',
    consoleInitialize.status === 200,
    consoleInitialize.status,
);
ok(
    'initialize response mentions protocol or server',
    consoleInitializeBody.includes('protocolVersion') ||
        consoleInitializeBody.includes('shop') ||
        consoleInitializeBody.includes('result'),
    consoleInitializeBody.slice(0, 200),
);
const consoleToolsList = await postMcp(
    { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
    staticProbeHeaders,
);
const consoleToolsBody = await consoleToolsList.text();
ok('static bearer tools/list (console probe) → 200', consoleToolsList.status === 200);
ok(
    'tools/list includes search_products',
    consoleToolsBody.includes('search_products'),
    consoleToolsBody.slice(0, 200),
);
const staticGet = await fetch(`${base}/mcp`, {
    method: 'GET',
    headers: {
        accept: 'text/event-stream',
        authorization: 'Bearer mcp-static-check-secret-key',
    },
});
ok('GET with static bearer is not rejected as 401', staticGet.status !== 401, staticGet.status);
console.log('\n=== MCP static auth ===');
const staticHeaders = (id: string): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer mcp-static-check-secret-key',
    'X-Convo-Id': id,
});
const staticTool = await postMcp(
    {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'get_conversation_context', arguments: {} },
    },
    staticHeaders(conversationId),
);
ok('static bearer + X-Convo-Id → 200', staticTool.status === 200, staticTool.status);
const staticMissingConvo = await postMcp(
    {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_cart', arguments: {} },
    },
    {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: 'Bearer mcp-static-check-secret-key',
    },
);
ok(
    'static bearer tools/call without X-Convo-Id resolves singleton session → 200',
    staticMissingConvo.status === 200,
    staticMissingConvo.status,
);
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
console.log('\n=== MCP mutation idempotency ===');
const mutation = {
    jsonrpc: '2.0',
    id: 'mutation-1',
    method: 'tools/call',
    params: {
        name: 'add_to_cart',
        arguments: {
            product_id: productRow.product_id,
            variant_id: productRow.variant_id,
            quantity: 1,
        },
    },
};
const firstMutation = await postMcp(mutation, signedHeaders(conversationId, expires));
await firstMutation.text();
const replayMutation = await postMcp(mutation, signedHeaders(conversationId, expires));
await replayMutation.text();
const secondMutation = await postMcp(
    { ...mutation, id: 'mutation-2' },
    signedHeaders(conversationId, expires),
);
await secondMutation.text();
const [cartQuantity] = (
    await db.execute<{ quantity: number }>(sql`
    select coalesce(sum(ci.quantity), 0)::int as quantity
    from carts c
    join cart_items ci on ci.cart_id = c.id
    where c.user_id = cast(${userRow.id} as uuid)
      and ci.variant_id = cast(${productRow.variant_id} as uuid)
  `)
).rows;
ok(
    'same JSON-RPC id replays while a new id executes identical arguments',
    firstMutation.status === 200 &&
        replayMutation.status === 200 &&
        secondMutation.status === 200 &&
        cartQuantity?.quantity === 2,
    cartQuantity,
);
const [callCount] = (
    await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from ai_tool_calls
    where conversation_id = cast(${conversationId} as uuid)
      and state = 'completed'
  `)
).rows;
ok('completed mutations are recorded once per tool-call id', callCount?.count === 2, callCount);
await db.execute(sql`
  update ai_conversations set status = 'stopped'
  where id = cast(${conversationId} as uuid)
`);
const stopped = await postMcp(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_cart', arguments: {} } },
    signedHeaders(conversationId, expires),
);
ok('stopped conversation → 401', stopped.status === 401, stopped.status);
await db.execute(sql`delete from users where id = cast(${userRow.id} as uuid)`);
await db.execute(sql`delete from ai_conversations where id = cast(${conversationId} as uuid)`);
server.close();
await pool.end();
await closeRedis();
console.log(`\n${checks - failures}/${checks} passed`);
if (failures > 0) process.exit(1);
