import type { PublishOutcome } from '@shop/agora/signaling.js';
import type { ChatEnvelope, Role } from '@shop/shared';
import { createHash } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import { publishAsChatService, publishToShards } from '@shop/agora/signaling.js';
import { db } from '@shop/db/client.js';
import { chatMessages, chatModeration, liveSessions, users } from '@shop/db/schema.js';
import { track } from '@shop/platform/lib/analytics.js';
import { AppError, notFound } from '@shop/platform/lib/errors.js';
import { chatMessagesTotal } from '@shop/platform/lib/metrics.js';
import { redact } from '@shop/platform/lib/pii.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { EVENTS, chatShardChannel } from '@shop/shared';

import { listSessionProducts } from './sessions.js';

export const shardIndexFor = (userId: string, chatShardCount: number): number => {
    const digest = createHash('sha256').update(userId).digest('hex');
    return Number(BigInt(`0x${digest}`) % BigInt(Math.max(1, chatShardCount)));
};
export const chatChannelsFor = (slug: string, chatShardCount: number): string[] =>
    Array.from({ length: Math.max(1, chatShardCount) }, (_, i) => chatShardChannel(slug, i));
const PROFANITY = ['fuck', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'dick', 'slut'];
export const profanityScore = (text: string): number => {
    const normalized = text
        .toLowerCase()
        .replace(/[0@]/g, 'o')
        .replace(/[1!|]/g, 'i')
        .replace(/3/g, 'e')
        .replace(/\$/g, 's')
        .replace(/[^a-z]+/g, ' ');
    let score = 0;
    for (const word of PROFANITY) {
        if (normalized.includes(word)) score += 1;
    }
    return score;
};
export const ensureChatModerationState = async (sessionId: string): Promise<void> => {
    const bansKey = keys.sessionBans(sessionId);
    const mutesKey = keys.sessionMutes(sessionId);
    const [bansExist, mutesExist] = await Promise.all([
        redis.exists(bansKey),
        redis.exists(mutesKey),
    ]);
    if (bansExist === 1 || mutesExist === 1) return;
    const rows = await db
        .select({ action: chatModeration.action, targetUserId: chatModeration.targetUserId })
        .from(chatModeration)
        .where(eq(chatModeration.sessionId, sessionId))
        .orderBy(asc(chatModeration.createdAt));
    const bans = new Set<string>();
    const mutes = new Set<string>();
    for (const row of rows) {
        if (!row.targetUserId) continue;
        if (row.action === 'ban') bans.add(row.targetUserId);
        if (row.action === 'mute') mutes.add(row.targetUserId);
        if (row.action === 'unmute') {
            mutes.delete(row.targetUserId);
            bans.delete(row.targetUserId);
        }
    }
    const pipeline = redis.pipeline();
    pipeline.sadd(bansKey, '-', ...bans);
    pipeline.sadd(mutesKey, '-', ...mutes);
    await pipeline.exec();
};
export const chatBlockReason = async (
    sessionId: string,
    userId: string,
): Promise<'banned' | 'muted' | null> => {
    await ensureChatModerationState(sessionId);
    const [banned, muted] = await Promise.all([
        redis.sismember(keys.sessionBans(sessionId), userId),
        redis.sismember(keys.sessionMutes(sessionId), userId),
    ]);
    if (banned === 1) return 'banned';
    if (muted === 1) return 'muted';
    return null;
};
type ChatActor = {
    id: string;
    displayName: string;
    role: Role;
};
export type PostChatResult = {
    message: ChatEnvelope;
    transport: 'rtm-rest' | 'sse-degraded';
    replayed: boolean;
    fanOutShards: number;
};
export const postChatMessage = async (a: {
    sessionId: string;
    actor: ChatActor;
    clientMessageId: string;
    text: string;
    productId?: string;
}): Promise<PostChatResult> => {
    const [session] = await db
        .select({
            id: liveSessions.id,
            slug: liveSessions.slug,
            status: liveSessions.status,
            chatShardCount: liveSessions.chatShardCount,
            hostUserId: liveSessions.hostUserId,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, a.sessionId));
    if (!session) throw notFound('session_not_found');
    if (session.status !== 'live') {
        chatMessagesTotal.inc({ action: 'rejected' });
        throw new AppError(409, 'session_not_live');
    }
    const blocked = await chatBlockReason(session.id, a.actor.id);
    if (blocked) {
        chatMessagesTotal.inc({ action: 'rejected' });
        throw new AppError(403, 'chat_blocked', `you are ${blocked} in this session`);
    }
    const text = redact(a.text.trim());
    if (text.length === 0) throw new AppError(400, 'empty_message');
    let acceptedText = text;
    const isHost = session.hostUserId === a.actor.id || a.actor.role === 'admin';
    let sharedProduct: ChatEnvelope['product'];
    if (a.productId !== undefined) {
        if (!isHost) throw new AppError(403, 'not_session_host');
        sharedProduct = (await listSessionProducts(session.id)).find(
            (product) => product.productId === a.productId,
        );
        if (sharedProduct === undefined) throw notFound('session_product_not_found');
    }
    const shardIndex = shardIndexFor(a.actor.id, session.chatShardCount);
    const flagged = profanityScore(text) > 0;
    const inserted = await db
        .insert(chatMessages)
        .values({
            sessionId: session.id,
            userId: a.actor.id,
            shardIndex,
            clientMessageId: a.clientMessageId,
            text,
            productId: sharedProduct?.productId,
            flagged,
        })
        .onConflictDoNothing({
            target: [chatMessages.sessionId, chatMessages.userId, chatMessages.clientMessageId],
        })
        .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });
    const row = inserted[0];
    const replayed = row === undefined;
    let createdAt = row?.createdAt ?? new Date();
    if (replayed) {
        const [existing] = await db
            .select({
                text: chatMessages.text,
                productId: chatMessages.productId,
                createdAt: chatMessages.createdAt,
            })
            .from(chatMessages)
            .where(
                and(
                    eq(chatMessages.sessionId, session.id),
                    eq(chatMessages.userId, a.actor.id),
                    eq(chatMessages.clientMessageId, a.clientMessageId),
                ),
            );
        if (existing) {
            createdAt = existing.createdAt;
            acceptedText = existing.text;
            if (existing.productId !== sharedProduct?.productId) {
                sharedProduct =
                    existing.productId === null
                        ? undefined
                        : (await listSessionProducts(session.id)).find(
                              (product) => product.productId === existing.productId,
                          );
            }
        }
    }
    const envelope: ChatEnvelope = {
        v: 1,
        type: 'chat',
        messageId: a.clientMessageId,
        sessionId: session.id,
        shardIndex,
        userId: a.actor.id,
        displayName: a.actor.displayName,
        role: a.actor.role,
        text: acceptedText,
        ...(sharedProduct === undefined ? {} : { product: sharedProduct }),
        ts: createdAt.getTime(),
    };
    if (replayed) {
        return { message: envelope, transport: 'rtm-rest', replayed: true, fanOutShards: 0 };
    }
    const channels = isHost
        ? chatChannelsFor(session.slug, session.chatShardCount)
        : [chatShardChannel(session.slug, shardIndex)];
    const outcome: PublishOutcome =
        channels.length === 1 && channels[0] !== undefined
            ? await publishAsChatService(channels[0], envelope)
            : await publishToShards(channels, envelope);
    let transport: PostChatResult['transport'] = 'rtm-rest';
    if (!outcome.ok) {
        transport = 'sse-degraded';
        await publishToSession(session.id, EVENTS.chatModerated, {
            sessionId: session.id,
            action: 'degraded_chat',
            reason: outcome.reason,
            envelope,
        });
    }
    if (!replayed) {
        chatMessagesTotal.inc({ action: flagged ? 'flagged' : 'accepted' });
        track({ type: 'chat_message', userId: a.actor.id, sessionId: session.id });
    }
    return { message: envelope, transport, replayed, fanOutShards: channels.length };
};
export const listChatMessages = async (
    sessionId: string,
    limit: number,
): Promise<ChatEnvelope[]> => {
    const rows = await db
        .select({
            clientMessageId: chatMessages.clientMessageId,
            shardIndex: chatMessages.shardIndex,
            userId: chatMessages.userId,
            text: chatMessages.text,
            createdAt: chatMessages.createdAt,
            productId: chatMessages.productId,
            displayName: users.displayName,
            role: users.role,
        })
        .from(chatMessages)
        .innerJoin(users, eq(users.id, chatMessages.userId))
        .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.status, 'visible')))
        .orderBy(asc(chatMessages.createdAt))
        .limit(Math.min(Math.max(limit, 1), 500));
    const productsById = new Map(
        (rows.some((row) => row.productId !== null)
            ? await listSessionProducts(sessionId)
            : []
        ).map((product) => [product.productId, product]),
    );
    return rows.map((row) => ({
        v: 1,
        type: 'chat',
        messageId: row.clientMessageId,
        sessionId,
        shardIndex: row.shardIndex,
        userId: row.userId,
        displayName: row.displayName,
        role: row.role,
        text: row.text,
        ...(row.productId === null || productsById.get(row.productId) === undefined
            ? {}
            : { product: productsById.get(row.productId)! }),
        ts: row.createdAt.getTime(),
    }));
};
