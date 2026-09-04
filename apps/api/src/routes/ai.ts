import { Router } from 'express';
import { z } from 'zod';

import { createConversation, fallbackConversationToCustomLlm, loadOwnedConversation } from '../ai/conversations.js';
import { getTransport, transportForConversation } from '../ai/transports/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';

/**
 * The conversation API.
 *
 * Everything except the Agora callback is a normal endpoint scoped to the shopper who
 * owns the conversation, and `ensureIdentity` provisions a guest identity when there is
 * no cookie — an unauthenticated shopper can talk to the assistant, while ownership is
 * still enforced per userId. The callback is authorized by its per-conversation HMAC
 * instead, because Agora has no session cookie.
 *
 * This endpoint set assumes nothing about a browser: it allocates a channel, uids and
 * a publisher token, starts and stops an agent, and accepts a text turn. A PSTN
 * gateway would call exactly these.
 */

export const router: Router = Router();

const createSchema = z.object({
  surface: z.enum(['live', 'replay', 'browse']),
  liveSessionId: z.string().uuid().nullish(),
  productId: z.string().uuid().nullish(),
  language: z.string().min(2).max(16).optional(),
  transport: z.enum(['voice', 'text']).optional(),
});

const startSchema = z.object({ transport: z.enum(['voice', 'text']).optional() });

const messageSchema = z.object({
  text: z.string().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(2000),
      }),
    )
    .max(12)
    .optional(),
});

const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw badRequest(
      'invalid_body',
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
    );
  }
  return result.data;
};

/**
 * `@types/express-serve-static-core@5` types params as `string | string[]`, so every
 * id is validated rather than asserted — the shape and the uuid-ness in one step.
 */
const conversationIdFrom = (value: unknown): string => {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw badRequest('invalid_conversation_id');
  return parsed.data;
};

router.post(
  '/api/ai/conversations',
  ensureIdentity,
  rateLimit('aiConversations', BUDGETS.aiConversations),
  async (req, res, next) => {
    try {
      const input = parse(createSchema, req.body);
      const dto = await createConversation({
        userId: req.session!.userId,
        surface: input.surface,
        liveSessionId: input.liveSessionId ?? null,
        productId: input.productId ?? null,
        ...(input.language === undefined ? {} : { language: input.language }),
        ...(input.transport === undefined ? {} : { transport: input.transport }),
      });
      res.status(201).json(dto);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/api/ai/conversations/:id/start',
  ensureIdentity,
  rateLimit('aiConversations', BUDGETS.aiConversations),
  async (req, res, next) => {
    try {
      const input = parse(startSchema, req.body);
      const conversation = await loadOwnedConversation(
        conversationIdFrom(req.params.id),
        req.session!.userId,
      );
      const transport = getTransport(input.transport === 'text' ? 'text' : 'agora-convoai');
      const { agentId } = await transport.start(conversation);
      res.json({
        conversationId: conversation.id,
        agentId,
        transport: transport.id,
        // The client labels a degraded transport in the UI; it is never voice.
        degraded: transport.degraded,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post('/api/ai/conversations/:id/stop', ensureIdentity, async (req, res, next) => {
  try {
    const conversation = await loadOwnedConversation(
      conversationIdFrom(req.params.id),
      req.session!.userId,
    );
    await transportForConversation(conversation).stop(conversation.id, { reason: 'client_stop' });
    res.json({ stopped: true });
  } catch (err) {
    next(err);
  }
});

router.post('/api/ai/conversations/:id/heartbeat', ensureIdentity, async (req, res, next) => {
  try {
    const conversation = await loadOwnedConversation(
      conversationIdFrom(req.params.id),
      req.session!.userId,
    );
    const { refreshed } = await transportForConversation(conversation).heartbeat(conversation);
    res.json({ refreshed });
  } catch (err) {
    next(err);
  }
});

router.post('/api/ai/conversations/:id/interrupt', ensureIdentity, async (req, res, next) => {
  try {
    const conversation = await loadOwnedConversation(
      conversationIdFrom(req.params.id),
      req.session!.userId,
    );
    await transportForConversation(conversation).interrupt(conversation);
    res.json({ interrupted: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Voice runtime fallback: managed LLM + MCP failed mid-session (failure_message).
 * Rejoins the agent with the custom completions callback and pins the conversation to
 * custom so text turns on the same row also skip MCP loopback.
 */
router.post('/api/ai/conversations/:id/llm-fallback', ensureIdentity, async (req, res, next) => {
  try {
    const conversation = await loadOwnedConversation(
      conversationIdFrom(req.params.id),
      req.session!.userId,
    );
    const result = await fallbackConversationToCustomLlm(conversation);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * The labelled degraded TEXT transport. Same conversation row, same tools, same
 * executor, same deduplication — one non-streaming JSON response instead of audio.
 * Reached when admission control refused a voice slot.
 */
router.post(
  '/api/ai/convo/:conversationId/message',
  ensureIdentity,
  rateLimit('aiConversations', BUDGETS.aiConversations),
  async (req, res, next) => {
    try {
      const { text, history } = parse(messageSchema, req.body);
      const conversation = await loadOwnedConversation(
        conversationIdFrom(req.params.conversationId),
        req.session!.userId,
      );
      if (conversation.status === 'stopped' || conversation.status === 'failed') {
        throw conflict('conversation_not_running', 'start a fresh conversation');
      }

      const transport = getTransport('text');
      if (!transport.sendUserTurn) throw conflict('transport_has_no_text_channel');
      // Switching to text hands back any voice lease this conversation was holding.
      if (conversation.transport !== 'text') await transport.start(conversation);

      const result = await transport.sendUserTurn(
        { ...conversation, transport: 'text' },
        text,
        history,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
