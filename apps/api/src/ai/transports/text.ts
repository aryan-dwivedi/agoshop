import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { detectLanguage, LANGUAGE_AUTO, resolveSpokenLanguage } from '@shop/shared';
import { db } from '../../db/client.js';
import { aiConversations, aiMessages } from '../../db/schema.js';
import { env } from '../../env.js';
import { badRequest } from '../../lib/errors.js';
import { persistBodies } from '../../lib/pii.js';
import { logger } from '../../lib/logger.js';
import { track } from '../../lib/analytics.js';
import { releaseSlot } from '../admission.js';
import { stopConversation } from '../conversations.js';
import type { ConversationRecord } from '../conversations.js';
import { getConversationLlmMode } from '../llmMode.js';
import { runConversationTurn } from '../executor.js';
import { buildLiveContextMessage, buildSystemPrompt } from '../systemPrompt.js';
import type { ChatMessage } from '../providers/index.js';
import type { TextTurnHistoryMessage, TextTurnResult, VoiceTransport } from './index.js';
const TEXT_TURN_TIMEOUT_MS = 25000;
const nextTurnId = async (conversation: ConversationRecord): Promise<number> => {
    const [row] = await db
        .select({ max: sql<number | null> `max(${aiMessages.turnId})` })
        .from(aiMessages)
        .where(eq(aiMessages.conversationId, conversation.id));
    return (row?.max ?? -1) + 1;
};
const MAX_TEXT_HISTORY_MESSAGES = 12;
const loadTextHistory = async (conversationId: string, clientHistory: TextTurnHistoryMessage[]): Promise<TextTurnHistoryMessage[]> => {
    if (!persistBodies)
        return clientHistory.slice(-MAX_TEXT_HISTORY_MESSAGES);
    const rows = await db
        .select({ role: aiMessages.role, content: aiMessages.content })
        .from(aiMessages)
        .where(and(eq(aiMessages.conversationId, conversationId), inArray(aiMessages.role, ['user', 'assistant']), isNotNull(aiMessages.content)))
        .orderBy(desc(aiMessages.id))
        .limit(MAX_TEXT_HISTORY_MESSAGES);
    return rows
        .reverse()
        .flatMap((row) => row.content !== null && (row.role === 'user' || row.role === 'assistant')
        ? [{ role: row.role, content: row.content }]
        : []);
};
type ResolvedProductReference = {
    productId: string;
    title: string;
    variantId: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const collectProductReferences = (value: unknown, references: Map<string, ResolvedProductReference>): void => {
    if (Array.isArray(value)) {
        for (const item of value)
            collectProductReferences(item, references);
        return;
    }
    if (value === null || typeof value !== 'object')
        return;
    const record = value as Record<string, unknown>;
    const productId = typeof record.product_id === 'string'
        ? record.product_id
        : typeof record.productId === 'string'
            ? record.productId
            : null;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const variantId = typeof record.variant_id === 'string' && UUID.test(record.variant_id)
        ? record.variant_id
        : null;
    if (productId && UUID.test(productId) && title.length > 0) {
        const existing = references.get(productId);
        references.set(productId, {
            productId,
            title,
            variantId: variantId ?? existing?.variantId ?? null,
        });
    }
    for (const child of Object.values(record))
        collectProductReferences(child, references);
};
const loadResolvedProductContext = async (conversationId: string): Promise<ChatMessage | null> => {
    if (!persistBodies)
        return null;
    const rows = await db
        .select({ result: aiMessages.toolResult })
        .from(aiMessages)
        .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, 'tool'), isNotNull(aiMessages.toolResult)))
        .orderBy(desc(aiMessages.id))
        .limit(12);
    const references = new Map<string, ResolvedProductReference>();
    for (const row of rows)
        collectProductReferences(row.result, references);
    const recent = [...references.values()].slice(0, 12);
    if (recent.length === 0)
        return null;
    return {
        role: 'system',
        content: [
            'Canonical catalog references resolved earlier in this conversation. Reuse these exact opaque IDs; never derive an ID from a product title. Search again if the requested item is absent:',
            ...recent.map((reference) => `- "${reference.title}": product_id=${reference.productId}` +
                (reference.variantId ? `, default_variant_id=${reference.variantId}` : '')),
        ].join('\n'),
    };
};
export const textTransport: VoiceTransport = {
    id: 'text',
    degraded: true,
    async start(conversation: ConversationRecord): Promise<{
        agentId: null;
    }> {
        await releaseSlot(conversation.id);
        await db
            .update(aiConversations)
            .set({ transport: 'text', status: 'running' })
            .where(eq(aiConversations.id, conversation.id));
        track({
            type: 'ai_conversation_started',
            userId: conversation.userId,
            sessionId: conversation.liveSessionId,
            payload: { conversationId: conversation.id, transport: 'text', degraded: true },
        });
        return { agentId: null };
    },
    stop(conversationId, opts): Promise<void> {
        return stopConversation(conversationId, opts);
    },
    heartbeat(): Promise<{
        refreshed: boolean;
    }> {
        return Promise.resolve({ refreshed: true });
    },
    interrupt(): Promise<void> {
        return Promise.resolve();
    },
    async sendUserTurn(conversation: ConversationRecord, text: string, clientHistory: TextTurnHistoryMessage[] = []): Promise<TextTurnResult> {
        const trimmed = text.trim();
        if (trimmed.length === 0)
            throw badRequest('empty_message', 'text is required');
        if (trimmed.length > 2000)
            throw badRequest('message_too_long', 'text must be ≤ 2000 chars');
        const turnId = await nextTurnId(conversation);
        const [history, resolvedProducts] = await Promise.all([
            loadTextHistory(conversation.id, clientHistory),
            loadResolvedProductContext(conversation.id),
        ]);
        const messages: ChatMessage[] = [
            { role: 'system', content: await buildSystemPrompt(conversation) },
            await buildLiveContextMessage(conversation),
            ...(resolvedProducts ? [resolvedProducts] : []),
            ...history,
            { role: 'user', content: trimmed },
        ];
        const llmMode = await getConversationLlmMode(conversation.id);
        const result = await runConversationTurn({
            conversation,
            messages,
            turnId,
            signal: AbortSignal.timeout(TEXT_TURN_TIMEOUT_MS),
            onText: () => { },
        });
        logger.info({
            conversationId: conversation.id,
            turnId,
            transport: 'text',
            llmMode,
            rounds: result.rounds,
            tools: result.executed.map((e) => e.name),
        }, 'text assistant turn completed');
        const language = conversation.language === LANGUAGE_AUTO
            ? (detectLanguage(trimmed, env.CONVOAI_SUPPORTED_LANGUAGES) ??
                resolveSpokenLanguage(LANGUAGE_AUTO, env.CONVOAI_SUPPORTED_LANGUAGES))
            : conversation.language;
        return {
            reply: result.text,
            language,
            toolCalls: result.executed.map((e) => ({ name: e.name, outcome: e.outcome })),
            products: result.products,
        };
    },
};
