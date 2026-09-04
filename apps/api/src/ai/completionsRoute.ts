import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { EVENTS } from '@shop/shared';

import { env } from '../env.js';
import { track } from '../lib/analytics.js';
import { logger } from '../lib/logger.js';
import { publishToUser } from '../lib/sse.js';
import { loadConversation, type ConversationRecord } from './conversations.js';
import { runConversationTurn } from './executor.js';
import type { ChatMessage } from './providers/index.js';
import { buildLiveContextMessage } from './systemPrompt.js';
import { callbackConversationId, verifyCallback } from './callbackAuth.js';

/**
 * The custom-LLM proxy: `POST /api/ai/convo/:conversationId/chat/completions`.
 *
 * Agora's Conversational AI Engine is configured with `llm.vendor:"custom"` and
 * `llm.style:"openai"`, which means it POSTs an OpenAI-compatible chat-completions
 * request with `stream:true` to this route and REJECTS a non-streaming response. So
 * this handler owns four contracts at once:
 *
 *  - **Auth** — the per-conversation HMAC in `X-Convo-Expires`/`X-Convo-Signature`,
 *    verified against the conversation id in the path. `Authorization` is never read.
 *  - **Framing** — `text/event-stream`, headers flushed immediately, keepalive
 *    comments every 5 s, `data: {chat.completion.chunk}` frames, `data: [DONE]`.
 *  - **Tool ordering** — delegated to `runConversationTurn`: assistant message with
 *    ordered `tool_calls` first, then the tool results in the same order.
 *  - **Failure** — Agora expects SSE, so an error is a logged, analytics-recorded
 *    structured event followed by ONE graceful spoken sentence, never an HTTP status.
 *
 * Nothing here is cached: the live-context system message is recomputed per request so
 * a discount that expired thirty seconds ago cannot be quoted.
 */

const KEEPALIVE_MS = 5_000;
const TURN_TIMEOUT_MS = env.CONVOAI_TURN_TIMEOUT_MS;

const FALLBACK_SENTENCE =
  "Sorry, I couldn't reach that just now. Could you ask me again in a moment?";

/**
 * Agora's body. Only `messages` is load-bearing for us; `turn_id` keys tool-call
 * idempotency, and everything else is accepted and ignored so an engine-side addition
 * cannot break the callback.
 */
const contentSchema = z.union([
  z.string(),
  z.null(),
  z.array(z.object({ type: z.string().optional(), text: z.string().optional() })),
]);

const bodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: contentSchema.optional(),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.unknown()).optional(),
      }),
    )
    .min(1),
  model: z.string().optional(),
  turn_id: z.number().int().nonnegative().optional(),
  timestamp: z.number().optional(),
  modalities: z.array(z.enum(['text', 'audio'])).optional(),
  audio: z
    .object({
      voice: z.string().optional(),
      format: z.string().optional(),
    })
    .optional(),
});

const ROLES: Record<string, ChatMessage['role']> = {
  system: 'system',
  user: 'user',
  assistant: 'assistant',
  tool: 'tool',
};

const flattenContent = (content: z.infer<typeof contentSchema> | undefined): string | null => {
  if (content == null) return null;
  if (typeof content === 'string') return content;
  return content.map((part) => part.text ?? '').join('');
};

// Forward model deltas immediately. Agora's Conversational AI Engine consumes the
// OpenAI-compatible SSE incrementally and owns phrase boundaries for TTS; buffering
// here forces short answers to finish generating before the first audio can start.

class SseWriter {
  private readonly id = `chatcmpl-${randomUUID()}`;

  private readonly created = Math.floor(Date.now() / 1000);

  private closed = false;

  constructor(
    private readonly res: Response,
    private readonly model: string,
  ) {}

  private frame(delta: Record<string, unknown>, finishReason: string | null): void {
    if (this.closed || this.res.writableEnded) return;
    this.res.write(
      `data: ${JSON.stringify({
        id: this.id,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  }

  role(): void {
    this.frame({ role: 'assistant' }, null);
  }

  text(delta: string): void {
    if (delta.length === 0) return;
    this.frame({ content: delta }, null);
  }

  keepalive(): void {
    if (this.closed || this.res.writableEnded) return;
    // An SSE comment: ignored by every consumer, but it keeps proxies from idling out.
    this.res.write(': keepalive\n\n');
  }

  finish(): Promise<void> {
    if (this.closed || this.res.writableEnded) return Promise.resolve();
    this.frame({}, 'stop');
    this.res.write('data: [DONE]\n\n');
    this.closed = true;
    this.res.end();
    return Promise.resolve();
  }
}

/** 401 without a body distinction; the reason is logged, never told to the caller. */
const authorize = async (req: Request): Promise<ConversationRecord | 'unauthorized' | null> => {
  const conversationId = callbackConversationId(req.params.conversationId);
  if (!conversationId) {
    // Nothing can be signed for a malformed id, so this is an auth failure, not a 404.
    logger.warn({ reason: 'malformed_conversation_id' }, 'ai callback rejected');
    return 'unauthorized';
  }
  const verification = verifyCallback(
    conversationId,
    req.header('X-Convo-Expires') ?? undefined,
    req.header('X-Convo-Signature') ?? undefined,
  );
  if (!verification.ok) {
    logger.warn({ conversationId, reason: verification.reason }, 'ai callback rejected');
    return 'unauthorized';
  }

  const conversation = await loadConversation(conversationId);
  if (!conversation) return null;

  // A signature may never outlive the conversation it was minted for, even if the
  // signing key leaked: the row's own expiry is the ceiling.
  const ceiling = Math.floor(conversation.callbackExpiresAt.getTime() / 1000) + 60;
  if (verification.expires > ceiling) {
    logger.warn({ conversationId, reason: 'expires_beyond_conversation' }, 'ai callback rejected');
    return 'unauthorized';
  }

  return conversation;
};

export const completionsHandler = async (req: Request, res: Response): Promise<void> => {
  const conversation = await authorize(req);
  if (conversation === 'unauthorized') {
    res.status(401).json({
      error: {
        code: 'invalid_callback_signature',
        message: 'callback signature rejected',
        requestId: req.requestId,
      },
    });
    return;
  }
  if (conversation === null) {
    res.status(404).json({
      error: {
        code: 'conversation_not_found',
        message: 'unknown conversation',
        requestId: req.requestId,
      },
    });
    return;
  }

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'invalid_callback_body',
        message: parsed.error.issues.map((i) => i.message).join('; '),
        requestId: req.requestId,
      },
    });
    return;
  }

  const turnId = parsed.data.turn_id ?? 0;
  const model = parsed.data.model ?? env.LLM_MODEL;
  const log = req.log.child({
    conversationId: conversation.id,
    agoraAgentId: conversation.agoraAgentId,
    channel: conversation.rtcChannel,
    provider: conversation.provider,
    turnId,
  });

  // `compression` is excluded from /api/ai/ in the app factory; `no-transform` tells
  // any intervening proxy the same thing.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const turnController = new AbortController();
  const writer = new SseWriter(res, model);
  const keepalive = setInterval(() => writer.keepalive(), KEEPALIVE_MS);
  let timedOut = false;
  const turnTimeout = setTimeout(() => {
    timedOut = true;
    turnController.abort(new Error('voice_turn_timeout'));
  }, TURN_TIMEOUT_MS);

  // A disconnected Agora client must not leave provider work or timers running.
  res.on('close', () => {
    clearInterval(keepalive);
    clearTimeout(turnTimeout);
    if (!res.writableEnded) turnController.abort();
  });
  writer.role();

  try {
    const lastRequestMessage = parsed.data.messages.at(-1);
    const directSpeech =
      lastRequestMessage?.role === 'assistant'
        ? flattenContent(lastRequestMessage.content)?.trim()
        : null;
    if (directSpeech) {
      // Agora may echo greeting or speak requests as assistant messages; stream text
      // back and let managed TTS render the audio.
      writer.text(directSpeech);
      await writer.finish();
      return;
    }

    const messages: ChatMessage[] = [
      // Recomputed EVERY request: session status, whether the live promotion applies
      // right now, the pinned product, the shopper's offers and their PIN code.
      await buildLiveContextMessage(conversation),
      ...parsed.data.messages.map((message) => ({
        role: ROLES[message.role] ?? 'user',
        content: flattenContent(message.content),
        ...(message.name === undefined ? {} : { name: message.name }),
        ...(message.tool_call_id === undefined ? {} : { tool_call_id: message.tool_call_id }),
      })),
    ];

    const result = await runConversationTurn({
      conversation,
      messages,
      turnId,
      signal: turnController.signal,
      onText: (delta) => writer.text(delta),
    });

    // The shopper is listening, not reading, so the products the tools surfaced are
    // pushed to their open event stream and the panel renders them as cards while the
    // agent is still speaking.
    if (result.products.length > 0) {
      await publishToUser(conversation.userId, EVENTS.aiProductsShown, {
        conversationId: conversation.id,
        turnId,
        products: result.products,
      }).catch((err: unknown) => log.warn({ err }, 'ai product cards publish failed'));
    }

    track({
      type: 'ai_turn',
      userId: conversation.userId,
      sessionId: conversation.liveSessionId,
      productId: conversation.contextProductId,
      payload: {
        conversationId: conversation.id,
        turnId,
        rounds: result.rounds,
        capped: result.capped,
        tools: result.executed.map((e) => `${e.name}:${e.outcome}`),
        provider: conversation.provider,
      },
    });
    log.info(
      { rounds: result.rounds, tools: result.executed.length, capped: result.capped },
      'ai callback turn completed',
    );

    await writer.finish();
  } catch (err) {
    clearInterval(keepalive);

    if (turnController.signal.aborted && !timedOut) {
      // The client hung up mid-turn: the provider stream is already aborted and the
      // keepalive and deadline are cleared. There is nobody left to speak to.
      log.info('ai callback aborted by client disconnect');
      if (!res.writableEnded) res.end();
      return;
    }

    // Structured record FIRST — the graceful sentence must never be the only trace.
    const code = err instanceof Error ? err.name : 'unknown_error';
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err, code }, 'ai callback failed');
    track({
      type: 'ai_error',
      userId: conversation.userId,
      sessionId: conversation.liveSessionId,
      payload: {
        conversationId: conversation.id,
        turnId,
        stage: 'provider',
        code,
        message,
        provider: conversation.provider,
      },
    });

    // Agora expects SSE, so a provider failure is spoken, not returned as an HTTP error.
    writer.text(FALLBACK_SENTENCE);
    try {
      await writer.finish();
    } catch (speechError) {
      log.error({ err: speechError }, 'ai audio stream failed');
      if (!res.writableEnded) res.end();
    }
  } finally {
    clearInterval(keepalive);
    clearTimeout(turnTimeout);
  }
};
