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
const KEEPALIVE_MS = 5000;
const TURN_TIMEOUT_MS = env.CONVOAI_TURN_TIMEOUT_MS;
const FALLBACK_SENTENCE = "Sorry, I couldn't reach that just now. Could you ask me again in a moment?";
const contentSchema = z.union([
    z.string(),
    z.null(),
    z.array(z.object({ type: z.string().optional(), text: z.string().optional() })),
]);
const bodySchema = z.object({
    messages: z
        .array(z.object({
        role: z.string(),
        content: contentSchema.optional(),
        name: z.string().optional(),
        tool_call_id: z.string().optional(),
        tool_calls: z.array(z.unknown()).optional(),
    }))
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
    if (content == null)
        return null;
    if (typeof content === 'string')
        return content;
    return content.map((part) => part.text ?? '').join('');
};
class SseWriter {
    private readonly id = `chatcmpl-${randomUUID()}`;
    private readonly created = Math.floor(Date.now() / 1000);
    private closed = false;
    constructor(private readonly res: Response, private readonly model: string) { }
    private frame(delta: Record<string, unknown>, finishReason: string | null): void {
        if (this.closed || this.res.writableEnded)
            return;
        this.res.write(`data: ${JSON.stringify({
            id: this.id,
            object: 'chat.completion.chunk',
            created: this.created,
            model: this.model,
            choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`);
    }
    role(): void {
        this.frame({ role: 'assistant' }, null);
    }
    text(delta: string): void {
        if (delta.length === 0)
            return;
        this.frame({ content: delta }, null);
    }
    keepalive(): void {
        if (this.closed || this.res.writableEnded)
            return;
        this.res.write(': keepalive\n\n');
    }
    finish(): Promise<void> {
        if (this.closed || this.res.writableEnded)
            return Promise.resolve();
        this.frame({}, 'stop');
        this.res.write('data: [DONE]\n\n');
        this.closed = true;
        this.res.end();
        return Promise.resolve();
    }
}
const authorize = async (req: Request): Promise<ConversationRecord | 'unauthorized' | null> => {
    const conversationId = callbackConversationId(req.params.conversationId);
    if (!conversationId) {
        logger.warn({ reason: 'malformed_conversation_id' }, 'ai callback rejected');
        return 'unauthorized';
    }
    const verification = verifyCallback(conversationId, req.header('X-Convo-Expires') ?? undefined, req.header('X-Convo-Signature') ?? undefined);
    if (!verification.ok) {
        logger.warn({ conversationId, reason: verification.reason }, 'ai callback rejected');
        return 'unauthorized';
    }
    const conversation = await loadConversation(conversationId);
    if (!conversation)
        return null;
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
    res.on('close', () => {
        clearInterval(keepalive);
        clearTimeout(turnTimeout);
        if (!res.writableEnded)
            turnController.abort();
    });
    writer.role();
    try {
        const lastRequestMessage = parsed.data.messages.at(-1);
        const directSpeech = lastRequestMessage?.role === 'assistant'
            ? flattenContent(lastRequestMessage.content)?.trim()
            : null;
        if (directSpeech) {
            writer.text(directSpeech);
            await writer.finish();
            return;
        }
        const messages: ChatMessage[] = [
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
        log.info({ rounds: result.rounds, tools: result.executed.length, capped: result.capped }, 'ai callback turn completed');
        await writer.finish();
    }
    catch (err) {
        clearInterval(keepalive);
        if (turnController.signal.aborted && !timedOut) {
            log.info('ai callback aborted by client disconnect');
            if (!res.writableEnded)
                res.end();
            return;
        }
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
        writer.text(FALLBACK_SENTENCE);
        try {
            await writer.finish();
        }
        catch (speechError) {
            log.error({ err: speechError }, 'ai audio stream failed');
            if (!res.writableEnded)
                res.end();
        }
    }
    finally {
        clearInterval(keepalive);
        clearTimeout(turnTimeout);
    }
};
