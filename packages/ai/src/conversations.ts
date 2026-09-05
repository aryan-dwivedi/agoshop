import type { CreateConversationDto, Surface } from '@shop/shared';
import { randomUUID } from 'node:crypto';

import { and, desc, eq, gt, isNotNull } from 'drizzle-orm';

import { interruptConvoAiAgent, joinConvoAiAgent, leaveConvoAiAgent } from '@shop/agora/convoai.js';
import { mintRtcToken, nextAgoraUid } from '@shop/agora/tokens.js';
import { db } from '@shop/db/client.js';
import { aiConversations, aiMessages, liveSessions } from '@shop/db/schema.js';
import { env, features } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '@shop/platform/lib/errors.js';
import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { LANGUAGE_AUTO, aiChannelForConversation, resolveSpokenLanguage } from '@shop/shared';

import { acquireSlot, refreshSlot, releaseSlot } from './admission.js';
import { signCallback } from './callbackAuth.js';
import { buildSystemPrompt } from './systemPrompt.js';

export type ConversationRecord = {
    id: string;
    userId: string;
    liveSessionId: string | null;
    contextProductId: string | null;
    surface: Surface;
    transport: 'voice' | 'text';
    language: string;
    provider: string;
    rtcChannel: string;
    viewerUid: number;
    agentUid: number;
    agoraAgentId: string | null;
    callbackExpiresAt: Date;
    status: 'created' | 'running' | 'stopped' | 'failed';
};
const GREETINGS: Record<string, string> = {
    'en-US':
        'Hi! I can help you compare these products, check delivery, and add anything to your cart. What are you looking for?',
    'en-IN':
        'Hi! I can help you compare these products, check delivery, and add anything to your cart. What are you looking for?',
    'hi-IN':
        'नमस्ते! मैं इन प्रोडक्ट्स की तुलना कर सकता हूँ, डिलीवरी देख सकता हूँ और कार्ट में जोड़ सकता हूँ। आप क्या ढूंढ रहे हैं?',
    'es-ES':
        '¡Hola! Puedo comparar estos productos, comprobar la entrega y añadir lo que quieras al carrito. ¿Qué estás buscando?',
};
export const loadConversation = async (id: string): Promise<ConversationRecord | null> => {
    const [row] = await db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.id, id))
        .limit(1);
    return row ?? null;
};
export const loadConversationByAgoraAgentId = async (
    agentId: string,
): Promise<ConversationRecord | null> => {
    const [row] = await db
        .select()
        .from(aiConversations)
        .where(eq(aiConversations.agoraAgentId, agentId))
        .limit(1);
    return row ?? null;
};
export const loadSingletonRunningConversation = async (): Promise<ConversationRecord | null> => {
    const rows = await db
        .select()
        .from(aiConversations)
        .where(
            and(
                eq(aiConversations.status, 'running'),
                isNotNull(aiConversations.agoraAgentId),
                gt(aiConversations.callbackExpiresAt, new Date()),
            ),
        )
        .orderBy(desc(aiConversations.createdAt))
        .limit(2);
    if (rows.length === 1) return rows[0] ?? null;
    return null;
};
export const rememberMcpAgentConversation = async (
    agoraAgentId: string,
    conversationId: string,
    expiresAt: Date,
): Promise<void> => {
    const ttlSeconds = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    await redis.setex(keys.mcpAgentConversation(agoraAgentId), ttlSeconds, conversationId);
};
export const forgetMcpAgentConversation = async (agoraAgentId: string): Promise<void> => {
    await redis.del(keys.mcpAgentConversation(agoraAgentId));
};
const latestUserMessageText = async (conversationId: string): Promise<string | null> => {
    const [row] = await db
        .select({ content: aiMessages.content })
        .from(aiMessages)
        .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, 'user')))
        .orderBy(desc(aiMessages.id))
        .limit(1);
    return row?.content ?? null;
};
export const loadOwnedConversation = async (
    id: string,
    userId: string,
): Promise<ConversationRecord> => {
    const conversation = await loadConversation(id);
    if (!conversation) throw notFound('conversation_not_found');
    if (conversation.userId !== userId) throw forbidden('not_your_conversation');
    return conversation;
};
export type CreateConversationInput = {
    userId: string;
    surface: Surface;
    liveSessionId?: string | null;
    productId?: string | null;
    language?: string;
    transport?: 'voice' | 'text';
};
export const createConversation = async (
    input: CreateConversationInput,
): Promise<CreateConversationDto> => {
    const language = input.language ?? env.CONVOAI_SUPPORTED_LANGUAGES[0] ?? 'en-US';
    if (language !== LANGUAGE_AUTO && !env.CONVOAI_SUPPORTED_LANGUAGES.includes(language)) {
        throw badRequest(
            'unsupported_language',
            `language must be one of ${env.CONVOAI_SUPPORTED_LANGUAGES.join(', ')} or ${LANGUAGE_AUTO}`,
        );
    }
    if (input.surface === 'live' && !input.liveSessionId) {
        throw badRequest('live_session_required', 'the live surface needs a liveSessionId');
    }
    if (input.liveSessionId) {
        const [session] = await db
            .select({ id: liveSessions.id })
            .from(liveSessions)
            .where(eq(liveSessions.id, input.liveSessionId))
            .limit(1);
        if (!session) throw notFound('live_session_not_found');
    }
    const [viewerUid, agentUid] = await Promise.all([nextAgoraUid(), nextAgoraUid()]);
    const callbackExpiresAt = new Date(Date.now() + env.CONVO_CALLBACK_TTL_SECONDS * 1000);
    const conversationId = randomUUID();
    const rtcChannel = aiChannelForConversation(conversationId);
    await db.insert(aiConversations).values({
        id: conversationId,
        userId: input.userId,
        liveSessionId: input.liveSessionId ?? null,
        contextProductId: input.productId ?? null,
        surface: input.surface,
        transport: input.transport ?? 'voice',
        language,
        provider: env.LLM_PROVIDER,
        rtcChannel,
        viewerUid,
        agentUid,
        callbackExpiresAt,
    });
    track({
        type: 'ai_conversation_created',
        userId: input.userId,
        sessionId: input.liveSessionId ?? null,
        productId: input.productId ?? null,
        payload: {
            conversationId,
            surface: input.surface,
            language,
            transport: input.transport ?? 'voice',
        },
    });
    return {
        conversationId,
        rtcChannel,
        rtcToken: mintRtcToken(rtcChannel, viewerUid, 'publisher'),
        viewerUid,
        agentUid,
        language,
        surface: input.surface,
    };
};
const buildConvoAiJoinParams = async (
    conversation: ConversationRecord,
): Promise<Parameters<typeof joinConvoAiAgent>[0]> => {
    const expires = Math.floor(conversation.callbackExpiresAt.getTime() / 1000);
    const spokenLanguage = resolveSpokenLanguage(
        conversation.language,
        env.CONVOAI_SUPPORTED_LANGUAGES,
        {
            text:
                conversation.language === LANGUAGE_AUTO
                    ? await latestUserMessageText(conversation.id)
                    : null,
        },
    );
    return {
        conversationId: conversation.id,
        channel: conversation.rtcChannel,
        agentUid: conversation.agentUid,
        viewerUid: conversation.viewerUid,
        language: spokenLanguage,
        systemPrompt: await buildSystemPrompt(conversation),
        greeting: GREETINGS[spokenLanguage] ?? GREETINGS['en-US']!,
        signature: signCallback(conversation.id, expires),
        expires,
    };
};
export const startConversation = async (
    conversation: ConversationRecord,
): Promise<{
    agentId: string;
}> => {
    if (!features.convoai) {
        throw new AppError(503, 'convoai_disabled', 'voice agents are disabled by configuration');
    }
    if (conversation.status === 'running' && conversation.agoraAgentId) {
        return { agentId: conversation.agoraAgentId };
    }
    if (conversation.callbackExpiresAt.getTime() <= Date.now()) {
        throw conflict('conversation_expired', 'start a fresh conversation');
    }
    await acquireSlot(conversation.id);
    let joinedAgentId: string | null = null;
    try {
        const joined = await joinConvoAiAgent(await buildConvoAiJoinParams(conversation));
        joinedAgentId = joined.agentId;
        await db
            .update(aiConversations)
            .set({ agoraAgentId: joinedAgentId, status: 'running', transport: 'voice' })
            .where(eq(aiConversations.id, conversation.id));
        await rememberMcpAgentConversation(
            joinedAgentId,
            conversation.id,
            conversation.callbackExpiresAt,
        );
        track({
            type: 'ai_conversation_started',
            userId: conversation.userId,
            sessionId: conversation.liveSessionId,
            payload: {
                conversationId: conversation.id,
                agoraAgentId: joinedAgentId,
                transport: 'voice',
            },
        });
        logger.info(
            {
                conversationId: conversation.id,
                agoraAgentId: joinedAgentId,
                channel: conversation.rtcChannel,
            },
            'convoai agent joined',
        );
        return { agentId: joinedAgentId };
    } catch (err) {
        if (joinedAgentId) {
            try {
                await leaveConvoAiAgent(joinedAgentId);
                joinedAgentId = null;
            } catch (leaveErr) {
                logger.error(
                    { err: leaveErr, conversationId: conversation.id, agoraAgentId: joinedAgentId },
                    'convoai agent cleanup failed; persisted for the lease sweeper',
                );
            }
        }
        await releaseSlot(conversation.id);
        await db
            .update(aiConversations)
            .set({
                status: 'failed',
                endedAt: new Date(),
                agoraAgentId: joinedAgentId,
            })
            .where(eq(aiConversations.id, conversation.id));
        throw err;
    }
};
export const stopConversation = async (
    conversationId: string,
    opts: {
        status?: 'stopped' | 'failed';
        reason?: string;
    } = {},
): Promise<void> => {
    const conversation = await loadConversation(conversationId);
    if (!conversation) {
        await releaseSlot(conversationId);
        return;
    }
    let leaveSucceeded = true;
    if (conversation.agoraAgentId) {
        await forgetMcpAgentConversation(conversation.agoraAgentId);
        try {
            await leaveConvoAiAgent(conversation.agoraAgentId);
        } catch (err) {
            leaveSucceeded = false;
            logger.warn(
                { err, conversationId, agoraAgentId: conversation.agoraAgentId },
                'convoai leave failed; retaining the agent id for cleanup retry',
            );
        }
    }
    if (leaveSucceeded && conversation.agoraAgentId) {
        await db
            .update(aiConversations)
            .set({ agoraAgentId: null })
            .where(eq(aiConversations.id, conversationId));
    }
    await releaseSlot(conversationId);
    if (conversation.status === 'running' || conversation.status === 'created') {
        await db
            .update(aiConversations)
            .set({ status: opts.status ?? 'stopped', endedAt: new Date() })
            .where(eq(aiConversations.id, conversationId));
    }
    track({
        type: 'ai_conversation_stopped',
        userId: conversation.userId,
        sessionId: conversation.liveSessionId,
        payload: {
            conversationId,
            status: opts.status ?? 'stopped',
            reason: opts.reason ?? 'client_stop',
        },
    });
};
export const heartbeatConversation = async (
    conversation: ConversationRecord,
): Promise<{
    refreshed: boolean;
}> => ({ refreshed: await refreshSlot(conversation.id) });
export const interruptConversation = async (conversation: ConversationRecord): Promise<void> => {
    if (conversation.status !== 'running' || !conversation.agoraAgentId) {
        throw conflict('conversation_not_running');
    }
    await interruptConvoAiAgent(conversation.agoraAgentId);
};
