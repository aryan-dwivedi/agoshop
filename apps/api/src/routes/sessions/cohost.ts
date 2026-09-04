import type { Router } from 'express';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { liveSessions, users } from '@shop/db/schema.js';
import { getSessionById } from '@shop/domain-live/sessions.js';
import { badRequest, notFound } from '@shop/platform/lib/errors.js';
import { requireSessionHost } from '@shop/platform/middleware/session.js';
import { isGuestEmail } from '@shop/shared';

import { coHostBody, idParam } from './schemas.js';

export const registerCohostRoutes = (router: Router): void => {
    router.put('/api/sessions/:id/cohost', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const parsed = coHostBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            const sessionId = id.data;
            const [candidate] = await db
                .select({ id: users.id, email: users.email })
                .from(users)
                .where(
                    and(
                        sql`lower(${users.email}) = lower(${parsed.data.email})`,
                        isNull(users.deletedAt),
                    ),
                );
            if (!candidate) throw notFound('user_not_found');
            if (isGuestEmail(candidate.email)) {
                throw badRequest(
                    'cohost_must_be_registered',
                    'a co-host needs a registered account',
                );
            }
            const [row] = await db
                .select({ hostUserId: liveSessions.hostUserId })
                .from(liveSessions)
                .where(eq(liveSessions.id, sessionId));
            if (!row) throw notFound('session_not_found');
            if (row.hostUserId === candidate.id) {
                throw badRequest('cohost_is_host', 'the host is already publishing');
            }
            await db
                .update(liveSessions)
                .set({ coHostUserId: candidate.id })
                .where(eq(liveSessions.id, sessionId));
            const session = await getSessionById(sessionId);
            if (!session) throw notFound('session_not_found');
            res.json({ session });
        } catch (err) {
            next(err);
        }
    });
    router.delete('/api/sessions/:id/cohost', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const sessionId = id.data;
            const cleared = await db
                .update(liveSessions)
                .set({ coHostUserId: null })
                .where(eq(liveSessions.id, sessionId))
                .returning({ id: liveSessions.id });
            if (cleared.length === 0) throw notFound('session_not_found');
            const session = await getSessionById(sessionId);
            if (!session) throw notFound('session_not_found');
            res.json({ session });
        } catch (err) {
            next(err);
        }
    });
};
