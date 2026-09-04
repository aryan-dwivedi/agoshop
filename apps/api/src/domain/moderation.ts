import { and, desc, eq, inArray } from 'drizzle-orm';
import { EVENTS } from '@shop/shared';
import type { ChatEnvelope, Role } from '@shop/shared';
import { publishToShards } from '../agora/signaling.js';
import { db } from '../db/client.js';
import { chatMessages, chatModeration, liveSessions, users } from '../db/schema.js';
import { track } from '../lib/analytics.js';
import { badRequest, notFound } from '../lib/errors.js';
import { moderationActionsTotal } from '../lib/metrics.js';
import { keys, redis } from '../lib/redis.js';
import { publishToSession } from '../lib/sse.js';
import { chatChannelsFor, ensureChatModerationState } from './chat.js';
export type ModerationAction = 'mute' | 'unmute' | 'ban' | 'delete_message';
export type ModerationEntry = {
    id: string;
    action: ModerationAction;
    targetUserId: string | null;
    targetUserName: string | null;
    targetMessageId: string | null;
    targetMessageText: string | null;
    actorUserId: string | null;
    actorUserName: string | null;
    createdAt: string;
};
export const applyModeration = async (a: {
    sessionId: string;
    actor: {
        userId: string;
        role: Role;
    };
    action: ModerationAction;
    targetUserId?: string | null;
    targetMessageId?: string | null;
}): Promise<{
    entryId: string;
    fanOutShards: number;
}> => {
    const [session] = await db
        .select({
        id: liveSessions.id,
        slug: liveSessions.slug,
        chatShardCount: liveSessions.chatShardCount,
    })
        .from(liveSessions)
        .where(eq(liveSessions.id, a.sessionId));
    if (!session)
        throw notFound('session_not_found');
    let targetUserId = a.targetUserId ?? null;
    if (a.action === 'delete_message') {
        if (!a.targetMessageId)
            throw badRequest('target_message_required');
        const deleted = await db
            .update(chatMessages)
            .set({ status: 'deleted' })
            .where(and(eq(chatMessages.id, a.targetMessageId), eq(chatMessages.sessionId, session.id)))
            .returning({ userId: chatMessages.userId });
        const row = deleted[0];
        if (!row)
            throw notFound('message_not_found');
        targetUserId = targetUserId ?? row.userId;
    }
    else {
        if (!targetUserId)
            throw badRequest('target_user_required');
        await ensureChatModerationState(session.id);
        const bans = keys.sessionBans(session.id);
        const mutes = keys.sessionMutes(session.id);
        if (a.action === 'ban')
            await redis.sadd(bans, targetUserId);
        if (a.action === 'mute')
            await redis.sadd(mutes, targetUserId);
        if (a.action === 'unmute') {
            await redis.pipeline().srem(mutes, targetUserId).srem(bans, targetUserId).exec();
        }
    }
    const [entry] = await db
        .insert(chatModeration)
        .values({
        sessionId: session.id,
        targetUserId,
        action: a.action,
        targetMessageId: a.targetMessageId ?? null,
        actorUserId: a.actor.userId,
    })
        .returning({ id: chatModeration.id, createdAt: chatModeration.createdAt });
    if (!entry)
        throw badRequest('moderation_not_recorded');
    moderationActionsTotal.inc({ action: a.action });
    track({
        type: 'moderation_action',
        userId: a.actor.userId,
        sessionId: session.id,
        payload: { action: a.action, targetUserId },
    });
    await publishToSession(session.id, EVENTS.chatModerated, {
        sessionId: session.id,
        action: a.action,
        targetUserId,
        targetMessageId: a.targetMessageId ?? null,
        actorUserId: a.actor.userId,
        ts: entry.createdAt.getTime(),
    });
    const channels = chatChannelsFor(session.slug, session.chatShardCount);
    const envelope: ChatEnvelope = {
        v: 1,
        type: 'moderation',
        messageId: entry.id,
        sessionId: session.id,
        shardIndex: -1,
        userId: a.actor.userId,
        displayName: 'moderator',
        role: a.actor.role,
        moderation: {
            action: a.action,
            ...(targetUserId ? { targetUserId } : {}),
            ...(a.targetMessageId ? { targetMessageId: a.targetMessageId } : {}),
        },
        ts: entry.createdAt.getTime(),
    };
    await publishToShards(channels, envelope);
    return { entryId: entry.id, fanOutShards: channels.length };
};
export const listModeration = async (sessionId: string): Promise<ModerationEntry[]> => {
    const rows = await db
        .select({
        id: chatModeration.id,
        action: chatModeration.action,
        targetUserId: chatModeration.targetUserId,
        targetMessageId: chatModeration.targetMessageId,
        actorUserId: chatModeration.actorUserId,
        createdAt: chatModeration.createdAt,
        targetMessageText: chatMessages.text,
    })
        .from(chatModeration)
        .leftJoin(chatMessages, eq(chatMessages.id, chatModeration.targetMessageId))
        .where(eq(chatModeration.sessionId, sessionId))
        .orderBy(desc(chatModeration.createdAt));
    const userIds = new Set<string>();
    for (const row of rows) {
        if (row.targetUserId)
            userIds.add(row.targetUserId);
        if (row.actorUserId)
            userIds.add(row.actorUserId);
    }
    const names = new Map<string, string>();
    if (userIds.size > 0) {
        const userRows = await db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, [...userIds]));
        for (const user of userRows)
            names.set(user.id, user.displayName);
    }
    return rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetUserId: row.targetUserId,
        targetUserName: row.targetUserId ? (names.get(row.targetUserId) ?? null) : null,
        targetMessageId: row.targetMessageId,
        targetMessageText: row.targetMessageText,
        actorUserId: row.actorUserId,
        actorUserName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
    }));
};
