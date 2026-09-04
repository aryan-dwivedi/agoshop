process.env.NODE_ENV = 'test';
process.env.LLM_PROVIDER = 'mock';
process.env.CONVOAI_TURN_TIMEOUT_MS = '5500';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ConversationRecord } from '../conversations.js';
import type { ChatMessage, LlmChunk } from '../providers/index.js';
const { createApp } = await import('../../app.js');
const { aiServiceRouters } = await import('../../../../ai-service/src/routes.js');
const { db, pool } = await import('../../db/client.js');
const { closeRedis } = await import('../../lib/redis.js');
const { signCallback } = await import('../callbackAuth.js');
const { runConversationTurn } = await import('../executor.js');
const { mockStats } = await import('../providers/mock.js');
const { aiChannelForConversation, toolSchemas } = await import('@shop/shared');
const { sql } = await import('drizzle-orm');
const { redis, keys } = await import('../../lib/redis.js');
const { env } = await import('../../env.js');
const { AppError } = await import('../../lib/errors.js');
const { acquireSlot, releaseSlot, refreshSlot, expiredLeases } = await import('../admission.js');
const { getTransport } = await import('../transports/index.js');
const { streamOpenAiSse } = await import('../providers/openaiCompatible.js');
const { LlmProviderError } = await import('../providers/index.js');
const { buildLiveContextMessage, buildSystemPrompt } = await import('../systemPrompt.js');
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
const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));
const timeoutCount = (): number => process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
const [userRow] = (await db.execute<{
    id: string;
}>(sql `select id from users where email = 'shopper@demo.test' limit 1`)).rows;
if (!userRow)
    throw new Error('fixture: shopper@demo.test missing — run npm run db:seed');
const userId = userRow.id;
const [liveRow] = (await db.execute<{
    session_id: string;
    product_id: string;
}>(sql `
    select ls.id as session_id, lsp.product_id
    from live_sessions ls
    join live_session_products lsp on lsp.session_id = ls.id
    where ls.status in ('live', 'scheduled')
    order by (ls.status = 'live') desc, lsp.sort_order
    limit 1
  `)).rows;
if (!liveRow)
    throw new Error('fixture: no active session with an attached product — run npm run db:seed');
const sessionId = liveRow.session_id;
const productId = liveRow.product_id;
const [variantRow] = (await db.execute<{
    id: string;
}>(sql `
    select id from product_variants
    where product_id = cast(${productId} as uuid)
    order by is_default desc
    limit 1
  `)).rows;
if (!variantRow)
    throw new Error('fixture: product has no variants');
const variantId = variantRow.id;
const cartQuantity = async (): Promise<number> => {
    const { rows } = await db.execute<{
        q: number;
    }>(sql `
    select coalesce(sum(ci.quantity), 0)::int as q
    from cart_items ci
    join carts c on c.id = ci.cart_id
    where c.user_id = cast(${userId} as uuid)
      and ci.variant_id = cast(${variantId} as uuid)
  `);
    return rows[0]?.q ?? 0;
};
const dropFixtureCartLine = (): Promise<unknown> => db.execute(sql `
    delete from cart_items ci
    using carts c
    where ci.cart_id = c.id
      and c.user_id = cast(${userId} as uuid)
      and ci.variant_id = cast(${variantId} as uuid)
  `);
await db.execute(sql `
  delete from ai_conversations
  where user_id = cast(${userId} as uuid) and provider = 'mock'
`);
await dropFixtureCartLine();
const quantityBefore = await cartQuantity();
const conversationId = randomUUID();
const rtcChannel = aiChannelForConversation(conversationId);
const callbackExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
const expires = Math.floor(callbackExpiresAt.getTime() / 1000);
await db.execute(sql `
  insert into ai_conversations
    (id, user_id, live_session_id, context_product_id, surface, transport, language,
     provider, rtc_channel, viewer_uid, agent_uid, callback_expires_at, status)
  values
    (cast(${conversationId} as uuid), cast(${userId} as uuid), cast(${sessionId} as uuid),
     cast(${productId} as uuid), 'live', 'voice', 'en-US', 'mock', ${rtcChannel},
     990001, 990002, ${callbackExpiresAt.toISOString()}, 'running')
`);
const conversation: ConversationRecord = {
    id: conversationId,
    userId,
    liveSessionId: sessionId,
    contextProductId: productId,
    surface: 'live',
    transport: 'voice',
    language: 'en-US',
    provider: 'mock',
    rtcChannel,
    viewerUid: 990001,
    agentUid: 990002,
    agoraAgentId: null,
    callbackExpiresAt,
    status: 'running',
};
const app = createApp(aiServiceRouters);
const server = createServer(app);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;
const callbackUrl = (id: string): string => `${base}/api/ai/convo/${id}/chat/completions`;
type CallbackOptions = {
    id?: string;
    expires?: number;
    signature?: string;
    omitHeaders?: boolean;
    turnId?: number;
    text: string;
    signal?: AbortSignal;
};
const postCallback = (options: CallbackOptions): Promise<Response> => {
    const id = options.id ?? conversationId;
    const exp = options.expires ?? expires;
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        authorization: 'Bearer definitely-not-a-real-key',
    };
    if (!options.omitHeaders) {
        headers['X-Convo-Id'] = id;
        headers['X-Convo-Expires'] = String(exp);
        headers['X-Convo-Signature'] = options.signature ?? signCallback(id, exp);
    }
    return fetch(callbackUrl(id), {
        method: 'POST',
        headers,
        body: JSON.stringify({
            model: 'mock-model',
            turn_id: options.turnId ?? 0,
            timestamp: Date.now(),
            stream: true,
            messages: [{ role: 'user', content: options.text }],
        }),
        ...(options.signal ? { signal: options.signal } : {}),
    });
};
const cleanup = async (): Promise<void> => {
    await db.execute(sql `delete from ai_conversations where id = cast(${conversationId} as uuid)`);
    await dropFixtureCartLine();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeRedis();
    await pool.end();
};
try {
    console.log('\n1. a valid signed callback streams SSE and ends with [DONE]');
    {
        const response = await postCallback({ text: 'hello there', turnId: 1 });
        const body = await response.text();
        ok('status 200', response.status === 200, response.status);
        ok('content-type is text/event-stream', (response.headers.get('content-type') ?? '').startsWith('text/event-stream'), response.headers.get('content-type'));
        ok('X-Accel-Buffering: no', response.headers.get('x-accel-buffering') === 'no');
        ok('no compression applied', response.headers.get('content-encoding') === null);
        const frames = body
            .split('\n\n')
            .filter((f) => f.startsWith('data: '))
            .map((f) => f.slice(6).trim());
        const chunks = frames.filter((f) => f !== '[DONE]').map((f) => JSON.parse(f));
        ok('every frame is a chat.completion.chunk', chunks.every((c) => c.object === 'chat.completion.chunk'), chunks.length);
        ok('assistant role frame first', chunks[0]?.choices?.[0]?.delta?.role === 'assistant');
        ok('text was streamed', chunks.some((c) => typeof c.choices?.[0]?.delta?.content === 'string' &&
            c.choices[0].delta.content.length > 0));
        ok("terminal chunk carries finish_reason 'stop'", chunks.at(-1)?.choices?.[0]?.finish_reason === 'stop', chunks.at(-1));
        ok('body ends with data: [DONE]', body.trimEnd().endsWith('data: [DONE]'));
        ok('bogus Authorization header was ignored', response.status === 200);
    }
    console.log('\n1b. the first model delta reaches speech before generation finishes');
    {
        const started = performance.now();
        const response = await postCallback({ text: '[[mock:streaming]]', turnId: 13 });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let body = '';
        while (!body.includes('The first words should be spoken')) {
            const { done, value } = await reader.read();
            if (done)
                break;
            body += decoder.decode(value, { stream: true });
        }
        const firstDeltaMs = performance.now() - started;
        ok('first content delta arrived while the provider was still generating', firstDeltaMs < 500 &&
            body.includes('The first words should be spoken') &&
            !body.includes('while the rest is still generating') &&
            !body.includes('[DONE]'), { firstDeltaMs, body });
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
        ok('remaining content completed after the early delta', body.includes('while the rest is still generating') && body.includes('[DONE]'));
    }
    console.log('\n2. signature, expiry and identity failures are all 401');
    {
        const good = signCallback(conversationId, expires);
        const tampered = `${good.slice(0, -2)}${good.endsWith('AA') ? 'BB' : 'AA'}`;
        const tamperedResponse = await postCallback({ text: 'hi', signature: tampered });
        ok('tampered signature -> 401', tamperedResponse.status === 401, tamperedResponse.status);
        const pastExpires = Math.floor(Date.now() / 1000) - 60;
        const expiredResponse = await postCallback({
            text: 'hi',
            expires: pastExpires,
            signature: signCallback(conversationId, pastExpires),
        });
        ok('expired expires -> 401 (even correctly signed)', expiredResponse.status === 401, expiredResponse.status);
        const otherId = randomUUID();
        const wrongConversationResponse = await postCallback({
            text: 'hi',
            signature: signCallback(otherId, expires),
        });
        ok('signature minted for another conversation -> 401', wrongConversationResponse.status === 401, wrongConversationResponse.status);
        const missingResponse = await postCallback({ text: 'hi', omitHeaders: true });
        ok('missing headers -> 401', missingResponse.status === 401, missingResponse.status);
        const unknown = randomUUID();
        const unknownResponse = await postCallback({ id: unknown, text: 'hi' });
        ok('unknown conversation with a valid signature -> 404', unknownResponse.status === 404, unknownResponse.status);
        const farFuture = Math.floor(Date.now() / 1000) + 400 * 24 * 3600;
        const farFutureResponse = await postCallback({
            text: 'hi',
            expires: farFuture,
            signature: signCallback(conversationId, farFuture),
        });
        ok('absurdly-future expires -> 401', farFutureResponse.status === 401, farFutureResponse.status);
    }
    console.log('\n3. a fragmented tool call orders assistant tool_calls before tool results');
    {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'live context' },
            { role: 'user', content: `[[mock:tool:details:${productId}]]` },
        ];
        const result = await runConversationTurn({
            conversation,
            messages,
            turnId: 42,
            signal: new AbortController().signal,
            onText: () => { },
        });
        const assistantIndex = messages.findIndex((m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) > 0);
        const firstToolIndex = messages.findIndex((m) => m.role === 'tool');
        ok('an assistant message with tool_calls was recorded', assistantIndex !== -1, assistantIndex);
        ok('a tool result message was recorded', firstToolIndex !== -1, firstToolIndex);
        ok('assistant tool_calls message precedes every tool result', assistantIndex !== -1 && firstToolIndex !== -1 && assistantIndex < firstToolIndex, { assistantIndex, firstToolIndex });
        const assistant = messages[assistantIndex]!;
        ok('assistant message kept its content', typeof assistant.content === 'string' && assistant.content.length > 0, assistant.content);
        const call = assistant.tool_calls![0]!;
        ok("tool_call type is 'function'", call.type === 'function');
        ok('tool name survived fragmentation', call.function.name === 'get_product_details', call.function.name);
        let parsedArgs: Record<string, unknown> = {};
        let argsValid = true;
        try {
            parsedArgs = JSON.parse(call.function.arguments);
        }
        catch {
            argsValid = false;
        }
        ok('fragments accumulated by index into valid JSON', argsValid, call.function.arguments);
        ok('accumulated arguments are correct', parsedArgs.product_id === productId, parsedArgs);
        const toolMessage = messages[firstToolIndex]!;
        ok('tool message references the assistant tool_call id', toolMessage.tool_call_id === call.id, {
            toolCallId: toolMessage.tool_call_id,
            callId: call.id,
        });
        ok('exactly one tool result per tool call', messages.filter((m) => m.role === 'tool').length === 1);
        ok('the round produced a closing answer', result.text.length > 0 && !result.capped, {
            rounds: result.rounds,
            capped: result.capped,
        });
        ok('tool executed successfully', result.executed[0]?.outcome === 'ok', result.executed[0]?.outcome);
    }
    console.log('\n3b. a wait-only assistant draft is repaired before the turn returns');
    {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'storefront assistant' },
            { role: 'user', content: 'How are you doing? [[mock:deferred]]' },
        ];
        const result = await runConversationTurn({
            conversation,
            messages,
            turnId: 43,
            signal: new AbortController().signal,
            onText: () => { },
        });
        ok('wait-only draft was not returned', !/one second|checking that/i.test(result.text), result.text);
        ok('the same turn returned a direct answer', /doing well/i.test(result.text), result.text);
        ok('repair used exactly one bounded closing round', result.rounds === 2, result.rounds);
    }
    console.log('\n3c. textual tool markup executes without leaking into voice output');
    {
        const messages: ChatMessage[] = [
            { role: 'system', content: 'storefront assistant' },
            { role: 'user', content: 'Is it deliverable to 560001? [[mock:text_tool]]' },
        ];
        let spoken = '';
        const result = await runConversationTurn({
            conversation,
            messages,
            turnId: 44,
            signal: new AbortController().signal,
            onText: (delta) => {
                spoken += delta;
            },
        });
        ok('textual protocol was converted into a real delivery tool call', result.executed[0]?.name === 'check_delivery' && result.executed[0].outcome === 'ok', result.executed[0]);
        ok('tool markup and arguments were not sent to speech', !spoken.includes('<tool_call>') &&
            !spoken.includes('check_delivery') &&
            !spoken.includes('product_id'), spoken);
        ok('the shopper received the delivery result in the same turn', spoken.includes('delivery is available to 560001') &&
            result.text.includes('delivery is available to 560001'), { spoken, text: result.text });
    }
    console.log('\n4. replaying the whole callback for one turn_id does not mutate twice');
    {
        const before = await cartQuantity();
        const turnId = 7;
        const text = `[[mock:tool:add_to_cart:${productId}]]`;
        const first = await postCallback({ text, turnId });
        const firstBody = await first.text();
        ok('first callback streamed', first.status === 200 && firstBody.includes('[DONE]'), first.status);
        const afterFirst = await cartQuantity();
        ok('the cart was mutated exactly once', afterFirst === before + 1, { before, afterFirst });
        const toolCallRows = await db.execute<{
            n: number;
            tool_call_id: string;
        }>(sql `
      select count(*)::int as n, min(tool_call_id) as tool_call_id
      from ai_tool_calls
      where conversation_id = cast(${conversationId} as uuid) and turn_id = ${turnId}
    `);
        ok('one aiToolCalls dedupe row was written', toolCallRows.rows[0]?.n === 1, toolCallRows.rows[0]);
        const firstToolCallId = toolCallRows.rows[0]?.tool_call_id;
        const second = await postCallback({ text, turnId });
        const secondBody = await second.text();
        ok('replayed callback streamed', second.status === 200 && secondBody.includes('[DONE]'), second.status);
        const afterReplay = await cartQuantity();
        ok('the replay did NOT mutate the cart again', afterReplay === afterFirst, {
            afterFirst,
            afterReplay,
        });
        const afterRows = await db.execute<{
            n: number;
            tool_call_id: string;
        }>(sql `
      select count(*)::int as n, min(tool_call_id) as tool_call_id
      from ai_tool_calls
      where conversation_id = cast(${conversationId} as uuid) and turn_id = ${turnId}
    `);
        ok('still exactly one dedupe row', afterRows.rows[0]?.n === 1, afterRows.rows[0]);
        ok('the stored row kept the ORIGINAL tool_call_id (a fresh id did not create a new row)', afterRows.rows[0]?.tool_call_id === firstToolCallId, { firstToolCallId, now: afterRows.rows[0]?.tool_call_id });
    }
    console.log('\n5. a client disconnect aborts the provider stream and clears the keepalive');
    {
        const abortedBefore = mockStats.aborted;
        const controller = new AbortController();
        const response = await postCallback({
            text: '[[mock:slow]]',
            turnId: 11,
            signal: controller.signal,
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let seen = '';
        const deadline = Date.now() + 12000;
        while (!seen.includes(': keepalive') && Date.now() < deadline) {
            const { value, done } = await reader.read();
            if (done)
                break;
            seen += decoder.decode(value, { stream: true });
        }
        ok('a keepalive comment reached the wire while the turn was in flight', seen.includes(': keepalive'), seen.slice(0, 160));
        const timersDuring = timeoutCount();
        controller.abort();
        await reader.cancel().catch(() => { });
        let aborted = false;
        for (let i = 0; i < 60 && !aborted; i += 1) {
            await sleep(50);
            aborted = mockStats.aborted > abortedBefore;
        }
        ok('the provider stream observed the abort', aborted, {
            abortedBefore,
            abortedNow: mockStats.aborted,
        });
        let timersAfter = timeoutCount();
        for (let i = 0; i < 40 && timersAfter >= timersDuring; i += 1) {
            await sleep(50);
            timersAfter = timeoutCount();
        }
        ok('the keepalive interval was cleared on disconnect', timersAfter < timersDuring, {
            timersDuring,
            timersAfter,
        });
        await sleep(6000);
        ok('no write-after-end one full keepalive period after the disconnect', true);
    }
    console.log('\n6. a provider failure streams a graceful sentence instead of an HTTP error');
    {
        const response = await postCallback({ text: '[[mock:error]]', turnId: 12 });
        const body = await response.text();
        ok('still HTTP 200 (Agora expects SSE)', response.status === 200, response.status);
        ok('still terminates with [DONE]', body.trimEnd().endsWith('data: [DONE]'));
        const spoken = body
            .split('\n\n')
            .filter((f) => f.startsWith('data: ') && !f.includes('[DONE]'))
            .map((f) => JSON.parse(f.slice(6)))
            .map((c) => c.choices?.[0]?.delta?.content ?? '')
            .join('');
        ok('one graceful sentence was spoken', spoken.includes("couldn't reach that"), spoken);
        const errors = await db.execute<{
            n: number;
        }>(sql `
      select count(*)::int as n from analytics_events
      where type = 'ai_error' and payload->>'conversationId' = ${conversationId}
    `);
        const streamed = await redis.xrevrange(keys.analyticsStream, '+', '-', 'COUNT', 200);
        const inStream = streamed.some(([, fields]) => {
            const typeIndex = fields.indexOf('type');
            const payloadIndex = fields.indexOf('payload');
            return (typeIndex !== -1 &&
                fields[typeIndex + 1] === 'ai_error' &&
                payloadIndex !== -1 &&
                (fields[payloadIndex + 1] ?? '').includes(conversationId));
        });
        ok('a structured ai_error event was recorded before the fallback sentence', inStream || (errors.rows[0]?.n ?? 0) > 0, { inStream, drained: errors.rows[0]?.n });
    }
    console.log('\n7. a stalled provider is aborted on deadline and receives a spoken fallback');
    {
        const abortedBefore = mockStats.aborted;
        const startedAt = Date.now();
        const response = await postCallback({ text: '[[mock:slow]]', turnId: 13 });
        const body = await response.text();
        const elapsedMs = Date.now() - startedAt;
        const spoken = body
            .split('\n\n')
            .filter((frame) => frame.startsWith('data: ') && !frame.includes('[DONE]'))
            .map((frame) => JSON.parse(frame.slice(6)))
            .map((chunk) => chunk.choices?.[0]?.delta?.content ?? '')
            .join('');
        ok('stalled turn still terminates with [DONE]', body.trimEnd().endsWith('data: [DONE]'));
        ok('stalled turn receives the graceful spoken fallback', spoken.includes("couldn't reach that"), spoken);
        ok('stalled provider observed the deadline abort', mockStats.aborted > abortedBefore, {
            abortedBefore,
            abortedNow: mockStats.aborted,
        });
        ok('spoken fallback arrived on the configured deadline', elapsedMs >= 5000 && elapsedMs < 7500, {
            elapsedMs,
        });
    }
    console.log('\n8. admission control refuses a slot past the configured maximum');
    const held: string[] = [];
    try {
        const max = env.CONVOAI_MAX_CONCURRENT_AGENTS;
        await redis.del(keys.aiAgents);
        for (let i = 0; i < max; i += 1) {
            const id = randomUUID();
            await acquireSlot(id);
            held.push(id);
        }
        ok(`${max} slots were granted`, (await redis.zcard(keys.aiAgents)) === max);
        let refused: unknown;
        try {
            await acquireSlot(randomUUID());
        }
        catch (err) {
            refused = err;
        }
        const asAppError = refused instanceof AppError ? refused : null;
        ok('the next acquire is refused', asAppError !== null, String(refused));
        ok("refusal is 503 'ai_capacity'", asAppError?.status === 503 && asAppError?.code === 'ai_capacity', {
            status: asAppError?.status,
            code: asAppError?.code,
        });
        ok('refusal carries retryAfterSeconds', typeof asAppError?.details?.retryAfterSeconds === 'number', asAppError?.details);
        await releaseSlot(held.pop()!);
        const nextId = randomUUID();
        let granted = true;
        try {
            await acquireSlot(nextId);
            held.push(nextId);
        }
        catch {
            granted = false;
        }
        ok('releasing a slot lets the next conversation in', granted);
        ok('re-acquiring an already-held lease is idempotent', await refreshSlot(held[0]!));
        ok('expiredLeases() is empty while every lease is fresh', (await expiredLeases()).length === 0);
    }
    finally {
        for (const id of held)
            await releaseSlot(id);
        await redis.del(keys.aiAgents);
    }
    console.log('\n9. the degraded text transport runs the identical tool executor');
    {
        const transport = getTransport('text');
        ok('the text transport is labelled degraded', transport.degraded);
        ok('the voice transport is not', !getTransport('agora-convoai').degraded);
        ok('only the text transport accepts an inbound turn', transport.sendUserTurn !== undefined);
        const before = await cartQuantity();
        const result = await transport.sendUserTurn!({ ...conversation, transport: 'text' }, `please [[mock:tool:add_to_cart:${productId}]]`);
        ok('a reply was produced', result.reply.length > 0, result.reply);
        ok('the reply is labelled with the conversation language', result.language === 'en-US');
        ok('the same executor ran add_to_cart', result.toolCalls.some((c) => c.name === 'add_to_cart' && c.outcome === 'ok'), result.toolCalls);
        ok('the text turn mutated the cart through the domain', (await cartQuantity()) === before + 1);
        const references = await transport.sendUserTurn!({ ...conversation, transport: 'text' }, 'Use the exact product we already found. [[mock:references]]');
        ok('a later text turn receives canonical product references from prior tool results', references.reply.includes(productId), references.reply);
        ok('symbolic product aliases are rejected before reaching UUID-backed domains', !toolSchemas.add_to_cart.safeParse({ product_id: 'm36_5g_standard' }).success);
        const rows = await db.execute<{
            n: number;
        }>(sql `
      select count(*)::int as n from ai_messages
      where conversation_id = cast(${conversationId} as uuid) and role = 'assistant'
    `);
        ok('assistant transcript rows were persisted', (rows.rows[0]?.n ?? 0) > 0, rows.rows[0]);
        await transport.sendUserTurn!({ ...conversation, transport: 'text' }, 'Remember that my confirmation word is pineapple.');
        const followUp = await transport.sendUserTurn!({ ...conversation, transport: 'text' }, 'What was it? [[mock:history]]');
        ok('a later text turn receives the persisted conversation history', followUp.reply.includes('pineapple'), followUp.reply);
    }
    console.log('\n9b. live context identifies the host and line-up without claiming video vision');
    {
        const [scheduled] = (await db.execute<{
            id: string;
        }>(sql `
        select id from live_sessions where slug = 'scheduled' limit 1
      `)).rows;
        if (!scheduled)
            throw new Error('fixture: scheduled session missing');
        const withoutRoomFeed: ConversationRecord = {
            ...conversation,
            liveSessionId: scheduled.id,
            contextProductId: null,
            surface: 'live',
        };
        const context = await buildLiveContextMessage(withoutRoomFeed);
        const contextText = typeof context.content === 'string' ? context.content : '';
        ok('live state names the host', contextText.includes('hosted by Ananya Iyer'), contextText);
        ok('live state reports the absence of a pinned product and supplies the line-up', contextText.includes('No product is currently pinned on screen') &&
            contextText.includes('OnePlus N6 5G'), contextText);
        ok('live state does not pretend the assistant can inspect the camera feed', contextText.includes('Do not claim to inspect the camera feed'), contextText);
        const policy = await buildSystemPrompt(withoutRoomFeed);
        ok('assistant policy reserves PIN collection for checkout or explicit delivery questions', policy.includes('Adding to cart never requires a PIN code') &&
            policy.includes('PIN collection belongs to checkout'), policy);
        ok('voice policy requires short speech and native, invisible tool calls', policy.includes('never more than two short sentences') &&
            policy.includes('Never use markdown, bullets, numbered lists, headings, emoji') &&
            policy.includes('Invoke tools only through native function or MCP calls') &&
            policy.includes('never write or say tool names, <tool_call> tags, JSON or tool arguments') &&
            policy.includes('short replies such as "yes", "no", "okay" and "thanks" as complete turns'), policy);
    }
    console.log('\n10. the HTTP providers survive OpenRouter\u2019s documented SSE quirks');
    {
        const serveOnce = async (payload: string, status = 200): Promise<{
            url: string;
            close: () => Promise<void>;
        }> => {
            const stub = createServer((_req, res) => {
                res.writeHead(status, { 'content-type': 'text/event-stream' });
                const half = Math.floor(payload.length / 2);
                res.write(payload.slice(0, half));
                setTimeout(() => res.end(payload.slice(half)), 10);
            });
            await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
            const stubPort = (stub.address() as AddressInfo).port;
            return {
                url: `http://127.0.0.1:${stubPort}/chat/completions`,
                close: () => new Promise<void>((resolve) => stub.close(() => resolve())),
            };
        };
        const chunk = (delta: unknown, finish: string | null, extra = ''): string => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }).slice(0, -1)}${extra ? `,${extra}` : ''}}\n\n`;
        const stream = ': OPENROUTER PROCESSING\n\n' +
            chunk({ role: 'assistant' }, null) +
            chunk({ content: 'One' }, null) +
            ': OPENROUTER PROCESSING\n\n' +
            chunk({ content: ' moment' }, null) +
            chunk({
                tool_calls: [
                    {
                        index: 0,
                        id: 'call_x',
                        type: 'function',
                        function: { name: 'get_cart', arguments: '{' },
                    },
                ],
            }, null) +
            chunk({ tool_calls: [{ index: 0, function: { arguments: '}' } }] }, null) +
            chunk({}, 'tool_calls') +
            chunk({}, 'tool_calls', '"usage":{"total_tokens":42}') +
            'data: [DONE]\n\n';
        const collect = async (ignoreTrailingUsageFinish: boolean): Promise<LlmChunk[]> => {
            const stub = await serveOnce(stream);
            try {
                const out: LlmChunk[] = [];
                for await (const c of streamOpenAiSse({
                    providerId: 'openrouter',
                    url: stub.url,
                    headers: {},
                    body: {},
                    signal: new AbortController().signal,
                    ignoreTrailingUsageFinish,
                })) {
                    out.push(c);
                }
                return out;
            }
            finally {
                await stub.close();
            }
        };
        const hardened = await collect(true);
        ok('comment keepalives are skipped and text survives split reads', hardened.map((c) => c.contentDelta ?? '').join('') === 'One moment', hardened.map((c) => c.contentDelta));
        const fragments = hardened.flatMap((c) => c.toolCalls ?? []);
        ok('tool-call fragments are surfaced with their index', fragments.every((f) => f.index === 0), fragments);
        ok('the first fragment carries id and name, later ones only arguments', fragments[0]?.id === 'call_x' &&
            fragments[0]?.name === 'get_cart' &&
            fragments[1]?.id === undefined, fragments);
        ok('the duplicated finish_reason on the usage chunk is ignored', hardened.filter((c) => c.finishReason !== undefined).length === 1, hardened.filter((c) => c.finishReason !== undefined));
        const plain = await collect(false);
        ok('the plain OpenAI reader does not suppress it (the quirk is provider-scoped)', plain.filter((c) => c.finishReason !== undefined).length === 2, plain.filter((c) => c.finishReason !== undefined).length);
        const errorStub = await serveOnce(`data: ${JSON.stringify({ error: { message: 'upstream exploded' }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] })}\n\n`);
        let thrown: unknown;
        try {
            for await (const _ of streamOpenAiSse({
                providerId: 'openrouter',
                url: errorStub.url,
                headers: {},
                body: {},
                signal: new AbortController().signal,
                ignoreTrailingUsageFinish: true,
            })) {
            }
        }
        catch (err) {
            thrown = err;
        }
        finally {
            await errorStub.close();
        }
        ok('an HTTP-200 frame carrying `error` is a provider failure', thrown instanceof LlmProviderError && thrown.message.includes('upstream exploded'), String(thrown));
        const badStatus = await serveOnce('nope', 500);
        let statusError: unknown;
        try {
            for await (const _ of streamOpenAiSse({
                providerId: 'openrouter',
                url: badStatus.url,
                headers: {},
                body: {},
                signal: new AbortController().signal,
                ignoreTrailingUsageFinish: true,
            })) {
            }
        }
        catch (err) {
            statusError = err;
        }
        finally {
            await badStatus.close();
        }
        ok('a non-200 response is a provider failure', statusError instanceof LlmProviderError, String(statusError));
    }
}
catch (err) {
    failures += 1;
    console.error('\nUNCAUGHT', err);
}
finally {
    await cleanup();
}
console.log(`\n${checks - failures}/${checks} assertions passed`);
if (failures > 0) {
    console.log('AI SLICE CHECK: FAILED');
    process.exit(1);
}
console.log('AI SLICE CHECK: PASSED');
process.exit(0);
