import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { and, eq, inArray, like } from 'drizzle-orm';
import { EVENTS, liveChannelForSlug, sessionChannel } from '@shop/shared';
import type { ServerEvent } from '@shop/shared';
import { db, pool } from '../../db/client.js';
import { chatMessages, liveSessions, products, sellers, users } from '../../db/schema.js';
import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { keys, redis } from '../../lib/redis.js';
import { listChatMessages, postChatMessage, shardIndexFor } from '../chat.js';
import { applyModeration } from '../moderation.js';
import { endSession, featuredProductId, frozenShardCount, joinSession, pinProduct, setSessionProducts, startSession, viewerCount, } from '../sessions.js';
let failures = 0;
let checks = 0;
const check = (label: string, ok: boolean, detail?: unknown): void => {
    checks += 1;
    if (ok) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}`, detail === undefined ? '' : detail);
};
const realFetch = globalThis.fetch;
let fetchCount = 0;
globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response('{"stubbed":true}', {
        status: 404,
        headers: { 'content-type': 'application/json' },
    });
}) as typeof realFetch;
const settle = (ms: number): Promise<void> => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});
const tag = randomUUID().slice(0, 8);
const slug = `check-live-${tag}`;
const tierEvents: ServerEvent[] = [];
const pinEvents: ServerEvent[] = [];
const statusEvents: ServerEvent[] = [];
const chatEvents: ServerEvent[] = [];
const degradedMessageIds = (): string[] => chatEvents.flatMap((event) => {
    const data = event.data;
    if (data === null || typeof data !== 'object')
        return [];
    if (!('action' in data) || data.action !== 'degraded_chat')
        return [];
    if (!('envelope' in data))
        return [];
    const envelope = data.envelope;
    if (envelope === null || typeof envelope !== 'object' || !('messageId' in envelope)) {
        return [];
    }
    return typeof envelope.messageId === 'string' ? [envelope.messageId] : [];
});
const pinnedProductIds = (): (string | null)[] => pinEvents.flatMap((event) => {
    const data = event.data;
    if (data === null || typeof data !== 'object' || !('productId' in data))
        return [];
    const value = data.productId;
    if (value === null)
        return [null];
    return typeof value === 'string' ? [value] : [];
});
const listener = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
const cleanup = async (sessionId: string | null, userIds: string[], sellerId: string | null) => {
    if (sessionId) {
        await db.delete(liveSessions).where(eq(liveSessions.id, sessionId));
        await redis.del(keys.sessionStatus(sessionId), keys.sessionTier(sessionId), keys.sessionViewers(sessionId), keys.sessionReactions(sessionId), `${keys.sessionReactions(sessionId)}:delta`, keys.sessionBans(sessionId), keys.sessionMutes(sessionId));
        const entries = await redis.xrange(keys.summaryStream, '-', '+');
        const mine = entries.filter(([, fields]) => fields.includes(sessionId)).map(([id]) => id);
        if (mine.length > 0)
            await redis.xdel(keys.summaryStream, ...mine);
    }
    if (sellerId)
        await db.delete(sellers).where(eq(sellers.id, sellerId));
    if (userIds.length > 0)
        await db.delete(users).where(inArray(users.id, userIds));
    await db.delete(users).where(like(users.email, `%@check-${tag}.invalid`));
};
const run = async (): Promise<void> => {
    const [hostUser] = await db
        .insert(users)
        .values({
        email: `host@check-${tag}.invalid`,
        passwordHash: 'x',
        displayName: 'Check Host',
        role: 'seller',
    })
        .returning({ id: users.id });
    const [chatterUser] = await db
        .insert(users)
        .values({
        email: `chatter@check-${tag}.invalid`,
        passwordHash: 'x',
        displayName: 'Check Chatter',
        role: 'shopper',
    })
        .returning({ id: users.id });
    if (!hostUser || !chatterUser)
        throw new Error('fixture users not created');
    const [seller] = await db
        .insert(sellers)
        .values({
        slug: `check-seller-${tag}`,
        displayName: 'Check Seller',
        ownerUserId: hostUser.id,
    })
        .returning({ id: sellers.id });
    if (!seller)
        throw new Error('fixture seller not created');
    const [session] = await db
        .insert(liveSessions)
        .values({
        slug,
        sellerId: seller.id,
        title: 'Live slice check',
        hostName: 'Check Host',
        hostUserId: hostUser.id,
        status: 'scheduled',
        rtcChannel: liveChannelForSlug(slug),
        expectedPeakViewers: 6,
    })
        .returning({ id: liveSessions.id });
    if (!session)
        throw new Error('fixture session not created');
    const sessionId = session.id;
    await listener.subscribe(sessionChannel(sessionId));
    listener.on('message', (_channel, payload) => {
        const event = JSON.parse(payload) as ServerEvent;
        if (event.event === EVENTS.sessionDeliveryTierChanged)
            tierEvents.push(event);
        if (event.event === EVENTS.sessionStatusChanged)
            statusEvents.push(event);
        if (event.event === EVENTS.chatModerated)
            chatEvents.push(event);
        if (event.event === EVENTS.sessionProductPinned)
            pinEvents.push(event);
    });
    console.log(`fixture session ${sessionId} (${slug})`);
    console.log(`config: RTC_TIER_MAX_VIEWERS=${env.RTC_TIER_MAX_VIEWERS} RTM_CHAT_SHARD_TARGET=${env.RTM_CHAT_SHARD_TARGET}`);
    try {
        console.log('\n1. ten concurrent start calls');
        const expectedShards = frozenShardCount(6);
        const starts = await Promise.allSettled(Array.from({ length: 10 }, () => startSession(sessionId, { consentAcknowledged: true })));
        const startOk = starts.filter((r) => r.status === 'fulfilled');
        const transitions = startOk.filter((r) => r.value.transitioned);
        check('all ten start calls succeeded', startOk.length === 10, {
            rejected: starts.filter((r) => r.status === 'rejected').map((r) => String(r.reason)),
        });
        check('exactly one scheduled -> live transition', transitions.length === 1, {
            transitions: transitions.length,
        });
        check('every start response reports the session live', startOk.every((r) => r.value.session.status === 'live'));
        const [afterStart] = await db
            .select({
            status: liveSessions.status,
            chatShardCount: liveSessions.chatShardCount,
            deliveryTier: liveSessions.deliveryTier,
        })
            .from(liveSessions)
            .where(eq(liveSessions.id, sessionId));
        check('db status is live', afterStart?.status === 'live', afterStart?.status);
        check(`chatShardCount frozen at ${expectedShards}`, afterStart?.chatShardCount === expectedShards, afterStart?.chatShardCount);
        check('redis status key written by the winner', (await redis.get(keys.sessionStatus(sessionId))) === 'live');
        check('redis tier key initialised to rtc', (await redis.get(keys.sessionTier(sessionId))) === 'rtc');
        await settle(150);
        check('exactly one session.status_changed published', statusEvents.length === 1, statusEvents.length);
        console.log('\n2. ten concurrent joins drive the one-way tier transition');
        await db
            .update(liveSessions)
            .set({ rttStatus: 'connecting' })
            .where(eq(liveSessions.id, sessionId));
        const viewerIds = Array.from({ length: 10 }, () => randomUUID());
        const joins = await Promise.all(viewerIds.map((userId) => joinSession(sessionId, { userId, role: 'shopper' })));
        check('captions remain enabled while live transcription connects', joins.every((join) => join.captionsEnabled));
        await db
            .update(liveSessions)
            .set({ rttStatus: 'failed' })
            .where(eq(liveSessions.id, sessionId));
        await settle(200);
        const pruned = await viewerCount(sessionId);
        check(`pruned viewer count reached the threshold (${pruned})`, pruned >= env.RTC_TIER_MAX_VIEWERS, pruned);
        check('exactly one session.delivery_tier_changed published', tierEvents.length === 1, tierEvents.length);
        const tierData = tierEvents[0]?.data;
        const tierPayloadOk = tierData !== null &&
            typeof tierData === 'object' &&
            'hlsUrl' in tierData &&
            typeof tierData.hlsUrl === 'string' &&
            'hlsOriginKind' in tierData &&
            tierData.hlsOriginKind === (env.MEDIA_PUSH_ENABLED ? 'media-push' : 'simulated-origin');
        check('the transition event carries an hls origin and its honest label', tierPayloadOk, tierData);
        check('redis tier key is cdn', (await redis.get(keys.sessionTier(sessionId))) === 'cdn');
        const [afterTier] = await db
            .select({ deliveryTier: liveSessions.deliveryTier })
            .from(liveSessions)
            .where(eq(liveSessions.id, sessionId));
        check('db delivery tier is cdn', afterTier?.deliveryTier === 'cdn', afterTier?.deliveryTier);
        check('at least one join already observed the cdn tier', joins.some((j) => j.deliveryTier === 'cdn'));
        check(`every join reports the frozen chatShardCount (${expectedShards})`, joins.every((j) => j.chatShardCount === expectedShards), joins.map((j) => j.chatShardCount));
        const laterJoins = await Promise.all(Array.from({ length: 5 }, () => joinSession(sessionId, { userId: randomUUID(), role: 'shopper' })));
        await settle(150);
        check('later joiners read the stored cdn tier', laterJoins.every((j) => j.deliveryTier === 'cdn'));
        check('the tier never reverted and never re-published', tierEvents.length === 1, tierEvents.length);
        console.log('\n3. shard assignment is stable while the viewer count moves');
        const probeUser = chatterUser.id;
        const before = await joinSession(sessionId, { userId: probeUser, role: 'shopper' });
        const countBefore = await viewerCount(sessionId);
        await Promise.all(Array.from({ length: 8 }, () => joinSession(sessionId, { userId: randomUUID(), role: 'shopper' })));
        const countAfter = await viewerCount(sessionId);
        const after = await joinSession(sessionId, { userId: probeUser, role: 'shopper' });
        check(`viewer count actually changed (${countBefore} -> ${countAfter})`, countAfter > countBefore);
        check('shardIndex unchanged', before.shardIndex === after.shardIndex, {
            before: before.shardIndex,
            after: after.shardIndex,
        });
        check('chatChannel unchanged', before.chatChannel === after.chatChannel);
        check('shardIndex matches the pure formula against the frozen count', after.shardIndex === shardIndexFor(probeUser, expectedShards));
        check('shardIndex is inside the frozen range', after.shardIndex < expectedShards);
        console.log('\n3b. pin then unpin the featured product');
        const [seededProduct] = await db.select({ id: products.id }).from(products).limit(1);
        if (!seededProduct)
            throw new Error('no seeded product to pin — run db:seed first');
        await setSessionProducts(sessionId, [{ productId: seededProduct.id }]);
        const pinned = await pinProduct(sessionId, seededProduct.id);
        await settle(150);
        check('pin marks exactly one product featured with a pinnedAt', pinned.filter((p) => p.isFeatured && p.pinnedAt !== null).length === 1, pinned);
        check('pin publishes session.product_pinned with the productId', pinnedProductIds().at(-1) === seededProduct.id, pinnedProductIds());
        const unpinned = await pinProduct(sessionId, null);
        await settle(150);
        check('unpin clears isFeatured and pinnedAt for the session', unpinned.every((p) => !p.isFeatured && p.pinnedAt === null), unpinned);
        check('unpin publishes session.product_pinned with productId null', pinnedProductIds().at(-1) === null, pinnedProductIds());
        check('no featured product remains', (await featuredProductId(sessionId)) === null);
        console.log('\n3c. host shares an addable product in chat');
        const sharedMessageId = `product-${tag}`;
        const shared = await postChatMessage({
            sessionId,
            actor: { id: hostUser.id, displayName: 'Check Host', role: 'seller' },
            clientMessageId: sharedMessageId,
            text: 'Take a look at this item',
            productId: seededProduct.id,
        });
        check('host chat envelope carries the attached session product', shared.message.product?.productId === seededProduct.id, shared.message.product);
        const history = await listChatMessages(sessionId, 50);
        check('late-join chat history restores the product card', history.find((message) => message.messageId === sharedMessageId)?.product?.productId ===
            seededProduct.id);
        let viewerShareCode = '';
        try {
            await postChatMessage({
                sessionId,
                actor: { id: probeUser, displayName: 'Check Chatter', role: 'shopper' },
                clientMessageId: `viewer-product-${tag}`,
                text: 'I should not attach seller products',
                productId: seededProduct.id,
            });
        }
        catch (err) {
            if (err instanceof AppError)
                viewerShareCode = err.code;
            else
                throw err;
        }
        check('viewers cannot attach product cards', viewerShareCode === 'not_session_host');
        console.log('\n4. muted user is refused before any publish is attempted');
        const accepted = await postChatMessage({
            sessionId,
            actor: { id: probeUser, displayName: 'Check Chatter', role: 'shopper' },
            clientMessageId: `pre-mute-${tag}`,
            text: 'hello before the mute',
        });
        check('an unmuted user is accepted', accepted.replayed === false);
        await settle(150);
        check(`the accepted message reached the publish stage via ${accepted.transport}`, accepted.transport === 'rtm-rest'
            ? fetchCount > 0
            : degradedMessageIds().includes(`pre-mute-${tag}`), { transport: accepted.transport, fetchCount, degraded: degradedMessageIds() });
        await applyModeration({
            sessionId,
            actor: { userId: hostUser.id, role: 'seller' },
            action: 'mute',
            targetUserId: probeUser,
        });
        check('mute recorded in redis', (await redis.sismember(keys.sessionMutes(sessionId), probeUser)) === 1);
        const fetchBefore = fetchCount;
        let status = 0;
        let code = '';
        try {
            await postChatMessage({
                sessionId,
                actor: { id: probeUser, displayName: 'Check Chatter', role: 'shopper' },
                clientMessageId: `post-mute-${tag}`,
                text: 'this must never be published',
            });
        }
        catch (err) {
            if (err instanceof AppError) {
                status = err.status;
                code = err.code;
            }
            else {
                throw err;
            }
        }
        check('rejected with 403', status === 403, status);
        check("rejected with code 'chat_blocked'", code === 'chat_blocked', code);
        await settle(150);
        check('no REST publish attempted', fetchCount === fetchBefore, {
            before: fetchBefore,
            after: fetchCount,
        });
        check('no degraded-transport publish attempted either', !degradedMessageIds().includes(`post-mute-${tag}`), degradedMessageIds());
        const blockedRows = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.clientMessageId, `post-mute-${tag}`)));
        check('nothing persisted for the blocked message', blockedRows.length === 0, blockedRows.length);
        console.log('\n5. ten concurrent end calls');
        statusEvents.length = 0;
        const ends = await Promise.allSettled(Array.from({ length: 10 }, () => endSession(sessionId)));
        const endOk = ends.filter((r) => r.status === 'fulfilled');
        const endTransitions = endOk.filter((r) => r.value.transitioned);
        check('all ten end calls succeeded', endOk.length === 10, {
            rejected: ends.filter((r) => r.status === 'rejected').map((r) => String(r.reason)),
        });
        check('exactly one live -> ended transition', endTransitions.length === 1, endTransitions.length);
        const [afterEnd] = await db
            .select({
            status: liveSessions.status,
            chatShardCount: liveSessions.chatShardCount,
            deliveryTier: liveSessions.deliveryTier,
        })
            .from(liveSessions)
            .where(eq(liveSessions.id, sessionId));
        check('db status is ended', afterEnd?.status === 'ended', afterEnd?.status);
        check('redis status key is ended', (await redis.get(keys.sessionStatus(sessionId))) === 'ended');
        check('the frozen shard count survived the whole lifecycle', afterEnd?.chatShardCount === expectedShards, afterEnd?.chatShardCount);
        check('the tier still did not revert', afterEnd?.deliveryTier === 'cdn', afterEnd?.deliveryTier);
        await settle(150);
        check('exactly one session.status_changed on end', statusEvents.length === 1, statusEvents.length);
        const summaryEntries = await redis.xrange(keys.summaryStream, '-', '+');
        check('exactly one session-summary job appended', summaryEntries.filter(([, fields]) => fields.includes(sessionId)).length === 1);
    }
    finally {
        await cleanup(sessionId, [hostUser.id, chatterUser.id], seller.id);
        await listener.quit();
    }
};
run()
    .then(async () => {
    globalThis.fetch = realFetch;
    console.log(`\n${checks - failures}/${checks} checks passed`);
    await redis.quit();
    await pool.end();
    process.exit(failures === 0 ? 0 : 1);
})
    .catch(async (err) => {
    globalThis.fetch = realFetch;
    console.error('\ncheck script crashed:', err);
    await cleanup(null, [], null).catch(() => undefined);
    await listener.quit().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(1);
});
