import type { ConversationRecord } from '../conversations.js';
import type { LlmChunk } from '../providers/index.js';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.LLM_PROVIDER = 'mock';

const { db, pool } = await import('@shop/db/client.js');
const { closeRedis } = await import('@shop/platform/lib/redis.js');
const { aiChannelForConversation, toolSchemas } = await import('@shop/shared');
const { sql } = await import('drizzle-orm');
const { redis, keys } = await import('@shop/platform/lib/redis.js');
const { env } = await import('@shop/platform/env.js');
const { AppError } = await import('@shop/platform/lib/errors.js');
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
const sleep = (ms: number): Promise<void> =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
const [userRow] = (
    await db.execute<{
        id: string;
    }>(sql`select id from users where email = 'shopper@demo.test' limit 1`)
).rows;
if (!userRow) throw new Error('fixture: shopper@demo.test missing — run npm run db:seed');
const userId = userRow.id;
const [liveRow] = (
    await db.execute<{
        session_id: string;
        product_id: string;
    }>(sql`
    select ls.id as session_id, lsp.product_id
    from live_sessions ls
    join live_session_products lsp on lsp.session_id = ls.id
    where ls.status in ('live', 'scheduled')
    order by (ls.status = 'live') desc, lsp.sort_order
    limit 1
  `)
).rows;
if (!liveRow)
    throw new Error('fixture: no active session with an attached product — run npm run db:seed');
const sessionId = liveRow.session_id;
const productId = liveRow.product_id;
const [variantRow] = (
    await db.execute<{
        id: string;
    }>(sql`
    select id from product_variants
    where product_id = cast(${productId} as uuid)
    order by is_default desc
    limit 1
  `)
).rows;
if (!variantRow) throw new Error('fixture: product has no variants');
const variantId = variantRow.id;
const cartQuantity = async (): Promise<number> => {
    const { rows } = await db.execute<{
        q: number;
    }>(sql`
    select coalesce(sum(ci.quantity), 0)::int as q
    from cart_items ci
    join carts c on c.id = ci.cart_id
    where c.user_id = cast(${userId} as uuid)
      and ci.variant_id = cast(${variantId} as uuid)
  `);
    return rows[0]?.q ?? 0;
};
const dropFixtureCartLine = (): Promise<unknown> =>
    db.execute(sql`
    delete from cart_items ci
    using carts c
    where ci.cart_id = c.id
      and c.user_id = cast(${userId} as uuid)
      and ci.variant_id = cast(${variantId} as uuid)
  `);
await db.execute(sql`
  delete from ai_conversations
  where user_id = cast(${userId} as uuid) and provider = 'mock'
`);
await dropFixtureCartLine();
const quantityBefore = await cartQuantity();
const conversationId = randomUUID();
const rtcChannel = aiChannelForConversation(conversationId);
const callbackExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
await db.execute(sql`
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
const cleanup = async (): Promise<void> => {
    await db.execute(sql`delete from ai_conversations where id = cast(${conversationId} as uuid)`);
    await dropFixtureCartLine();
    await closeRedis();
    await pool.end();
};
try {
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
        } catch (err) {
            refused = err;
        }
        const asAppError = refused instanceof AppError ? refused : null;
        ok('the next acquire is refused', asAppError !== null, String(refused));
        ok(
            "refusal is 503 'ai_capacity'",
            asAppError?.status === 503 && asAppError?.code === 'ai_capacity',
            {
                status: asAppError?.status,
                code: asAppError?.code,
            },
        );
        ok(
            'refusal carries retryAfterSeconds',
            typeof asAppError?.details?.retryAfterSeconds === 'number',
            asAppError?.details,
        );
        await releaseSlot(held.pop()!);
        const nextId = randomUUID();
        let granted = true;
        try {
            await acquireSlot(nextId);
            held.push(nextId);
        } catch {
            granted = false;
        }
        ok('releasing a slot lets the next conversation in', granted);
        ok('re-acquiring an already-held lease is idempotent', await refreshSlot(held[0]!));
        ok(
            'expiredLeases() is empty while every lease is fresh',
            (await expiredLeases()).length === 0,
        );
    } finally {
        for (const id of held) await releaseSlot(id);
        await redis.del(keys.aiAgents);
    }
    console.log('\n9. the degraded text transport runs the identical tool executor');
    {
        const transport = getTransport('text');
        ok('the text transport is labelled degraded', transport.degraded);
        ok('the voice transport is not', !getTransport('agora-convoai').degraded);
        ok('only the text transport accepts an inbound turn', transport.sendUserTurn !== undefined);
        const before = await cartQuantity();
        const result = await transport.sendUserTurn!(
            { ...conversation, transport: 'text' },
            `please [[mock:tool:add_to_cart:${productId}]]`,
        );
        ok('a reply was produced', result.reply.length > 0, result.reply);
        ok('the reply is labelled with the conversation language', result.language === 'en-US');
        ok(
            'the same executor ran add_to_cart',
            result.toolCalls.some((c) => c.name === 'add_to_cart' && c.outcome === 'ok'),
            result.toolCalls,
        );
        ok(
            'the text turn mutated the cart through the domain',
            (await cartQuantity()) === before + 1,
        );
        const references = await transport.sendUserTurn!(
            { ...conversation, transport: 'text' },
            'Use the exact product we already found. [[mock:references]]',
        );
        ok(
            'a later text turn receives canonical product references from prior tool results',
            references.reply.includes(productId),
            references.reply,
        );
        ok(
            'symbolic product aliases are rejected before reaching UUID-backed domains',
            !toolSchemas.add_to_cart.safeParse({ product_id: 'm36_5g_standard' }).success,
        );
        const rows = await db.execute<{
            n: number;
        }>(sql`
      select count(*)::int as n from ai_messages
      where conversation_id = cast(${conversationId} as uuid) and role = 'assistant'
    `);
        ok('assistant transcript rows were persisted', (rows.rows[0]?.n ?? 0) > 0, rows.rows[0]);
        await transport.sendUserTurn!(
            { ...conversation, transport: 'text' },
            'Remember that my confirmation word is pineapple.',
        );
        const followUp = await transport.sendUserTurn!(
            { ...conversation, transport: 'text' },
            'What was it? [[mock:history]]',
        );
        ok(
            'a later text turn receives the persisted conversation history',
            followUp.reply.includes('pineapple'),
            followUp.reply,
        );
    }
    console.log('\n9b. live context identifies the host and line-up without claiming video vision');
    {
        const [scheduled] = (
            await db.execute<{
                id: string;
            }>(sql`
        select id from live_sessions where slug = 'scheduled' limit 1
      `)
        ).rows;
        if (!scheduled) throw new Error('fixture: scheduled session missing');
        const withoutRoomFeed: ConversationRecord = {
            ...conversation,
            liveSessionId: scheduled.id,
            contextProductId: null,
            surface: 'live',
        };
        const context = await buildLiveContextMessage(withoutRoomFeed);
        const contextText = typeof context.content === 'string' ? context.content : '';
        ok('live state names the host', contextText.includes('hosted by Ananya Iyer'), contextText);
        ok(
            'live state reports the absence of a pinned product and supplies the line-up',
            contextText.includes('No product is currently pinned on screen') &&
                contextText.includes('OnePlus N6 5G'),
            contextText,
        );
        ok(
            'live state does not pretend the assistant can inspect the camera feed',
            contextText.includes('Do not claim to inspect the camera feed'),
            contextText,
        );
        const policy = await buildSystemPrompt(withoutRoomFeed);
        ok(
            'assistant policy reserves PIN collection for checkout or explicit delivery questions',
            policy.includes('Adding to cart never requires a PIN code') &&
                policy.includes('PIN collection belongs to checkout'),
            policy,
        );
        ok(
            'voice policy requires short speech and native, invisible tool calls',
            policy.includes('never more than two short sentences') &&
                policy.includes('Never use markdown, bullets, numbered lists, headings, emoji') &&
                policy.includes('Invoke tools only through native function or MCP calls') &&
                policy.includes(
                    'never write or say tool names, <tool_call> tags, JSON or tool arguments',
                ) &&
                policy.includes(
                    'short replies such as "yes", "no", "okay" and "thanks" as complete turns',
                ),
            policy,
        );
    }
    console.log('\n10. the HTTP providers survive OpenRouter\u2019s documented SSE quirks');
    {
        const serveOnce = async (
            payload: string,
            status = 200,
        ): Promise<{
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
        const chunk = (delta: unknown, finish: string | null, extra = ''): string =>
            `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] }).slice(0, -1)}${extra ? `,${extra}` : ''}}\n\n`;
        const stream =
            ': OPENROUTER PROCESSING\n\n' +
            chunk({ role: 'assistant' }, null) +
            chunk({ content: 'One' }, null) +
            ': OPENROUTER PROCESSING\n\n' +
            chunk({ content: ' moment' }, null) +
            chunk(
                {
                    tool_calls: [
                        {
                            index: 0,
                            id: 'call_x',
                            type: 'function',
                            function: { name: 'get_cart', arguments: '{' },
                        },
                    ],
                },
                null,
            ) +
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
            } finally {
                await stub.close();
            }
        };
        const hardened = await collect(true);
        ok(
            'comment keepalives are skipped and text survives split reads',
            hardened.map((c) => c.contentDelta ?? '').join('') === 'One moment',
            hardened.map((c) => c.contentDelta),
        );
        const fragments = hardened.flatMap((c) => c.toolCalls ?? []);
        ok(
            'tool-call fragments are surfaced with their index',
            fragments.every((f) => f.index === 0),
            fragments,
        );
        ok(
            'the first fragment carries id and name, later ones only arguments',
            fragments[0]?.id === 'call_x' &&
                fragments[0]?.name === 'get_cart' &&
                fragments[1]?.id === undefined,
            fragments,
        );
        ok(
            'the duplicated finish_reason on the usage chunk is ignored',
            hardened.filter((c) => c.finishReason !== undefined).length === 1,
            hardened.filter((c) => c.finishReason !== undefined),
        );
        const plain = await collect(false);
        ok(
            'the plain OpenAI reader does not suppress it (the quirk is provider-scoped)',
            plain.filter((c) => c.finishReason !== undefined).length === 2,
            plain.filter((c) => c.finishReason !== undefined).length,
        );
        const errorStub = await serveOnce(
            `data: ${JSON.stringify({ error: { message: 'upstream exploded' }, choices: [{ index: 0, delta: {}, finish_reason: 'error' }] })}\n\n`,
        );
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
        } catch (err) {
            thrown = err;
        } finally {
            await errorStub.close();
        }
        ok(
            'an HTTP-200 frame carrying `error` is a provider failure',
            thrown instanceof LlmProviderError && thrown.message.includes('upstream exploded'),
            String(thrown),
        );
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
        } catch (err) {
            statusError = err;
        } finally {
            await badStatus.close();
        }
        ok(
            'a non-200 response is a provider failure',
            statusError instanceof LlmProviderError,
            String(statusError),
        );
    }
} catch (err) {
    failures += 1;
    console.error('\nUNCAUGHT', err);
} finally {
    await cleanup();
}
console.log(`\n${checks - failures}/${checks} assertions passed`);
if (failures > 0) {
    console.log('AI SLICE CHECK: FAILED');
    process.exit(1);
}
console.log('AI SLICE CHECK: PASSED');
process.exit(0);
