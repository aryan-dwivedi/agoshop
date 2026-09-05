import { Router } from 'express';
import { z } from 'zod';

import { mintRtcToken } from '@shop/agora/tokens.js';
import { createConversation, loadOwnedConversation } from '@shop/ai/conversations.js';
import { getTicketForShopper } from '@shop/ai/support.js';
import { getTransport, transportForConversation } from '@shop/ai/transports/index.js';
import { badRequest, conflict } from '@shop/platform/lib/errors.js';
import { BUDGETS, rateLimit } from '@shop/platform/lib/ratelimit.js';
import { ensureIdentity } from '@shop/platform/middleware/session.js';

export const router: Router = Router();
const createSchema = z.object({
    surface: z.enum(['live', 'replay', 'browse']),
    liveSessionId: z.string().uuid().nullish(),
    productId: z.string().uuid().nullish(),
    language: z.string().min(2).max(16).optional(),
    transport: z.enum(['voice', 'text']).optional(),
});
const startSchema = z.object({
    transport: z.enum(['voice', 'text']).optional(),
});
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
            result.error.issues
                .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
                .join('; '),
        );
    }
    return result.data;
};
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
        await transportForConversation(conversation).stop(conversation.id, {
            reason: 'client_stop',
        });
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
router.get('/api/ai/conversations/:id/handoff', ensureIdentity, async (req, res, next) => {
    try {
        const conversation = await loadOwnedConversation(
            conversationIdFrom(req.params.id),
            req.session!.userId,
        );
        const ticket = await getTicketForShopper(req.session!.userId, conversation.id);
        if (
            !ticket ||
            (ticket.status !== 'queued' &&
                ticket.status !== 'assigned' &&
                ticket.status !== 'active')
        ) {
            throw conflict('no_active_handoff', 'no support handoff is active for this conversation');
        }
        res.json({
            conversationId: conversation.id,
            rtcChannel: conversation.rtcChannel,
            rtcToken: mintRtcToken(conversation.rtcChannel, conversation.viewerUid, 'publisher'),
            viewerUid: conversation.viewerUid,
        });
    } catch (err) {
        next(err);
    }
});
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
