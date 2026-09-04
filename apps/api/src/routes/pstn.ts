import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { ensureIdentity } from '../middleware/session.js';
export const router = Router();
const callbackSchema = z.object({
    conversationId: z.string().uuid().optional(),
    ticketId: z.string().uuid().optional(),
    phoneE164: z.string().min(8).max(20),
});
router.post('/api/pstn/callback', ensureIdentity, async (req, res, next) => {
    try {
        const parsed = callbackSchema.safeParse(req.body);
        if (!parsed.success)
            throw badRequest('invalid_body', parsed.error.message);
        logger.info({
            phone: parsed.data.phoneE164.slice(0, 4) + '****',
            ticketId: parsed.data.ticketId,
            conversationId: parsed.data.conversationId,
        }, 'pstn callback queued (stub — configure SIP gateway)');
        res.json({
            status: 'queued',
            message: 'Callback request received. Configure PSTN_GATEWAY_URL and a SIP trunk to complete bridging.',
            gatewayConfigured: Boolean(env.PSTN_GATEWAY_URL),
        });
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/pstn/incoming', async (req, res, next) => {
    try {
        logger.info({ body: req.body }, 'pstn incoming webhook (stub)');
        res.json({
            status: 'accepted',
            message: 'Incoming PSTN webhook stub. Implement SIP↔RTC bridge in gateway service.',
        });
    }
    catch (err) {
        next(err);
    }
});
