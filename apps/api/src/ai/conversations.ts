import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';

import { aiChannelForConversation, LANGUAGE_AUTO, resolveSpokenLanguage } from '@shop/shared';
import type { CreateConversationDto, Surface } from '@shop/shared';

import { interruptConvoAiAgent, joinConvoAiAgent, leaveConvoAiAgent } from '../agora/convoai.js';
import { mintRtcToken, nextAgoraUid } from '../agora/tokens.js';
import { db } from '../db/client.js';
import { aiConversations, aiMessages, liveSessions } from '../db/schema.js';
import { env, features } from '../env.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { track } from '../lib/analytics.js';
import { acquireSlot, refreshSlot, releaseSlot } from './admission.js';
import { signCallback } from './callbackAuth.js';
import { setConversationLlmMode } from './llmMode.js';
import { buildSystemPrompt } from './systemPrompt.js';

/**
 * Conversation lifecycle.
 *
 * This module assumes NOTHING about a browser. It allocates the private channel, the
 * two uids and the viewer's publisher token, and `/start` joins ConvoAI against that
 * channel — which is precisely why a PSTN gateway could drive the same endpoints with
 * a SIP↔RTC bridge publishing caller audio as `viewerUid`, and why the k6 `ai-proxy`
 * scenario exercises the callback with no browser present.
 *
 * There is deliberately no RTM token here (decision 2): the browser already owns
 * exactly one Signaling client as `user-<id>`, and minting a second RTM identity for
 * the AI channel would double the account concurrency footprint for nothing.
 */

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

/** Keyed by CONCRETE codes: an `auto` conversation resolves one before greeting. */
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
  const [row] = await db.select().from(aiConversations).where(eq(aiConversations.id, id)).limit(1);
  return row ?? null;
};

/**
 * The shopper's own words are the only evidence available for an `auto` conversation,
 * so the newest one seeds language resolution for the greeting and for ASR.
 */
const latestUserMessageText = async (conversationId: string): Promise<string | null> => {
  const [row] = await db
    .select({ content: aiMessages.content })
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), eq(aiMessages.role, 'user')))
    .orderBy(desc(aiMessages.id))
    .limit(1);
  return row?.content ?? null;
};

/** Loads and enforces ownership; the callback path uses `loadConversation` instead. */
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
  // `auto` is stored verbatim; every consumer that needs a concrete code resolves one
  // at the point of use, so the shopper's choice is never overwritten behind their back.
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

  // Two uids from the shared Postgres sequence: the viewer publishes mic audio, the
  // agent publishes speech, and both are numeric because `enable_string_uid:false`.
  const [viewerUid, agentUid] = await Promise.all([nextAgoraUid(), nextAgoraUid()]);

  const callbackExpiresAt = new Date(Date.now() + env.CONVO_CALLBACK_TTL_SECONDS * 1000);
  // The channel name is derived from the conversation id, so the id is minted here
  // rather than by the default and the row lands in one statement.
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
    // The viewer is a PUBLISHER in its own private AI channel — it is only an
    // audience member of the live channel.
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
    callbackUrl: `${env.PUBLIC_API_URL.replace(/\/$/, '')}/api/ai/convo/${conversation.id}/chat/completions`,
    signature: signCallback(conversation.id, expires),
    expires,
  };
};

export const startConversation = async (
  conversation: ConversationRecord,
): Promise<{ agentId: string }> => {
  if (!features.convoai) {
    throw new AppError(503, 'convoai_disabled', 'voice agents are disabled by configuration');
  }
  if (conversation.status === 'running' && conversation.agoraAgentId) {
    // Idempotent: a retried /start must not consume a second agent.
    return { agentId: conversation.agoraAgentId };
  }
  if (conversation.callbackExpiresAt.getTime() <= Date.now()) {
    throw conflict('conversation_expired', 'start a fresh conversation');
  }

  await acquireSlot(conversation.id);

  try {
    const { agentId, llmMode } = await joinConvoAiAgent(await buildConvoAiJoinParams(conversation));

    await db
      .update(aiConversations)
      .set({ agoraAgentId: agentId, status: 'running', transport: 'voice' })
      .where(eq(aiConversations.id, conversation.id));

    track({
      type: 'ai_conversation_started',
      userId: conversation.userId,
      sessionId: conversation.liveSessionId,
      payload: {
        conversationId: conversation.id,
        agoraAgentId: agentId,
        transport: 'voice',
        llmMode,
      },
    });

    logger.info(
      {
        conversationId: conversation.id,
        agoraAgentId: agentId,
        channel: conversation.rtcChannel,
        llmMode,
      },
      'convoai agent joined',
    );
    return { agentId };
  } catch (err) {
    // A failed join must not hold the slot it never used.
    await releaseSlot(conversation.id);
    await db
      .update(aiConversations)
      .set({ status: 'failed', endedAt: new Date() })
      .where(eq(aiConversations.id, conversation.id));
    throw err;
  }
};

/**
 * Runtime fallback when managed LLM + MCP fails after a successful MCP join. Leaves the
 * current agent and rejoins with the custom completions callback; pins the conversation
 * to custom so text turns use the in-process tool path too.
 */
export const fallbackConversationToCustomLlm = async (
  conversation: ConversationRecord,
): Promise<{ agentId: string; llmMode: 'custom' }> => {
  if (!features.convoai) {
    throw new AppError(503, 'convoai_disabled', 'voice agents are disabled by configuration');
  }
  if (conversation.callbackExpiresAt.getTime() <= Date.now()) {
    throw conflict('conversation_expired', 'start a fresh conversation');
  }
  if (conversation.status !== 'running') {
    throw conflict('conversation_not_running');
  }

  await setConversationLlmMode(conversation.id, 'custom');

  if (conversation.agoraAgentId) {
    await leaveConvoAiAgent(conversation.agoraAgentId).catch((err: unknown) =>
      logger.warn(
        { err, conversationId: conversation.id, agoraAgentId: conversation.agoraAgentId },
        'convoai leave before llm fallback failed; rejoining anyway',
      ),
    );
  }

  const { agentId } = await joinConvoAiAgent(await buildConvoAiJoinParams(conversation), {
    forceMode: 'custom',
  });

  await db
    .update(aiConversations)
    .set({ agoraAgentId: agentId, status: 'running' })
    .where(eq(aiConversations.id, conversation.id));

  track({
    type: 'ai_llm_fallback',
    userId: conversation.userId,
    sessionId: conversation.liveSessionId,
    payload: { conversationId: conversation.id, agoraAgentId: agentId, llmMode: 'custom' },
  });

  logger.info(
    { conversationId: conversation.id, agoraAgentId: agentId },
    'convoai agent rejoined with custom llm after runtime fallback',
  );

  return { agentId, llmMode: 'custom' };
};

/**
 * Idempotent teardown, called by the client's `/stop`, the background lease sweeper and
 * the ConvoAI webhook (102 agent-left, 110 agent-error) alike. Agora's `leave` is
 * best-effort because NCS delivery is not guaranteed and the agent may already be gone.
 */
export const stopConversation = async (
  conversationId: string,
  opts: { status?: 'stopped' | 'failed'; reason?: string } = {},
): Promise<void> => {
  const conversation = await loadConversation(conversationId);
  if (!conversation) {
    // Still release: a lease can outlive an erased conversation row.
    await releaseSlot(conversationId);
    return;
  }

  if (conversation.agoraAgentId) {
    await leaveConvoAiAgent(conversation.agoraAgentId).catch((err: unknown) =>
      logger.warn(
        { err, conversationId, agoraAgentId: conversation.agoraAgentId },
        'convoai leave failed; releasing the slot anyway',
      ),
    );
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

/** `refreshed:false` means the lease lapsed and the client must start a new agent. */
export const heartbeatConversation = async (
  conversation: ConversationRecord,
): Promise<{ refreshed: boolean }> => ({ refreshed: await refreshSlot(conversation.id) });

export const interruptConversation = async (conversation: ConversationRecord): Promise<void> => {
  if (conversation.status !== 'running' || !conversation.agoraAgentId) {
    throw conflict('conversation_not_running');
  }
  await interruptConvoAiAgent(conversation.agoraAgentId);
};
