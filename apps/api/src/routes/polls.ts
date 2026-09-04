import type { NextFunction, Request, Response } from 'express';

import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '@shop/db/client.js';
import { liveSessions, polls } from '@shop/db/schema.js';
import { closePoll, pollResults, votePoll } from '@shop/domain-live/polls.js';
import { badRequest, forbidden, notFound, unauthorized } from '@shop/platform/lib/errors.js';
import { BUDGETS, rateLimit } from '@shop/platform/lib/ratelimit.js';
import { ensureIdentity } from '@shop/platform/middleware/session.js';

export const router: Router = Router();
type IdReq = Request<{
    id: string;
}>;
const requirePollHost = async (req: IdReq, _res: Response, next: NextFunction): Promise<void> => {
    try {
        const session = req.session;
        if (!session) throw unauthorized();
        const [row] = await db
            .select({ hostUserId: liveSessions.hostUserId })
            .from(polls)
            .innerJoin(liveSessions, eq(liveSessions.id, polls.sessionId))
            .where(eq(polls.id, req.params.id));
        if (!row) throw notFound('poll_not_found');
        if (session.role !== 'admin' && row.hostUserId !== session.userId) {
            throw forbidden('not_session_host');
        }
        next();
    } catch (err) {
        next(err);
    }
};
router.get('/api/polls/:id', async (req: IdReq, res, next) => {
    try {
        res.json({ results: await pollResults(req.params.id) });
    } catch (err) {
        next(err);
    }
});
router.post(
    '/api/polls/:id/vote',
    ensureIdentity,
    rateLimit('pollVote', BUDGETS.pollVote),
    async (req: IdReq, res, next) => {
        try {
            const session = req.session;
            if (!session) throw unauthorized();
            const parsed = z.object({ optionId: z.string().uuid() }).safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            res.json({
                results: await votePoll({
                    pollId: req.params.id,
                    optionId: parsed.data.optionId,
                    userId: session.userId,
                }),
            });
        } catch (err) {
            next(err);
        }
    },
);
router.post('/api/polls/:id/close', requirePollHost, async (req: IdReq, res, next) => {
    try {
        res.json({ results: await closePoll(req.params.id) });
    } catch (err) {
        next(err);
    }
});
