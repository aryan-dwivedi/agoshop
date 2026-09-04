import { Router } from 'express';
import { z } from 'zod';
import { acceptSupportTicket, activateSupportTicket, closeSupportTicket, escalateToHuman, getTicketForShopper, listSupportQueue, } from '../domain/support.js';
import { loadOwnedConversation } from '../ai/conversations.js';
import { badRequest } from '../lib/errors.js';
import { ensureIdentity, requireAuth, requireRole } from '../middleware/session.js';
export const router = Router();
const escalateSchema = z.object({
    conversationId: z.string().uuid(),
    reason: z.string().min(1).max(500),
    orderId: z.string().uuid().optional(),
    preference: z.enum(['voice', 'callback']).optional(),
    phoneE164: z.string().max(20).optional(),
});
router.post('/api/support/escalate', ensureIdentity, requireAuth, async (req, res, next) => {
    try {
        const parsed = escalateSchema.safeParse(req.body);
        if (!parsed.success)
            throw badRequest('invalid_body', parsed.error.message);
        await loadOwnedConversation(parsed.data.conversationId, req.session!.userId);
        const result = await escalateToHuman({
            conversationId: parsed.data.conversationId,
            userId: req.session!.userId,
            reason: parsed.data.reason,
            orderId: parsed.data.orderId,
            preference: parsed.data.preference,
            phoneE164: parsed.data.phoneE164,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/api/support/queue', requireAuth, requireRole('support', 'admin'), async (_req, res, next) => {
    try {
        res.json({ tickets: await listSupportQueue() });
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/support/tickets/:id/accept', requireAuth, requireRole('support', 'admin'), async (req, res, next) => {
    try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!id)
            throw badRequest('invalid_ticket_id');
        const result = await acceptSupportTicket(id, req.session!.userId);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/support/tickets/:id/connected', requireAuth, requireRole('support', 'admin'), async (req, res, next) => {
    try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!id)
            throw badRequest('invalid_ticket_id');
        await activateSupportTicket(id, req.session!.userId);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/support/tickets/:id/close', requireAuth, requireRole('support', 'admin'), async (req, res, next) => {
    try {
        const id = typeof req.params.id === 'string' ? req.params.id : '';
        if (!id)
            throw badRequest('invalid_ticket_id');
        await closeSupportTicket(id, req.session!.userId);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
router.get('/api/support/tickets/active', ensureIdentity, requireAuth, async (req, res, next) => {
    try {
        const conversationId = typeof req.query.conversationId === 'string' ? req.query.conversationId : '';
        if (!conversationId)
            throw badRequest('conversation_id_required');
        const ticket = await getTicketForShopper(req.session!.userId, conversationId);
        res.json({ ticket });
    }
    catch (err) {
        next(err);
    }
});
export const requireSupportDashboard = requireRole('support', 'admin');
