import type { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { getSessionById } from '@shop/domain-live/sessions.js';
import { badRequest, conflict, forbidden, notFound } from '@shop/platform/lib/errors.js';
import { ensureIdentity, requireSessionHost } from '@shop/platform/middleware/session.js';

import { coHostInviteBody, idParam } from './schemas.js';

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const digestInviteToken = (token: string): string =>
    createHash('sha256').update(token).digest('hex');

export const registerCohostRoutes = (router: Router): void => {
    router.post('/api/sessions/:id/cohost-invite', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const sessionId = id.data;
            const [row] = await db
                .select({ coHostUserId: liveSessions.coHostUserId })
                .from(liveSessions)
                .where(eq(liveSessions.id, sessionId));
            if (!row) throw notFound('session_not_found');
            if (row.coHostUserId !== null) {
                throw conflict(
                    'cohost_already_assigned',
                    'remove the current co-host before creating another invite link',
                );
            }
            const token = randomBytes(32).toString('base64url');
            const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
            const updated = await db
                .update(liveSessions)
                .set({
                    coHostInviteTokenHash: digestInviteToken(token),
                    coHostInviteExpiresAt: expiresAt,
                })
                .where(and(eq(liveSessions.id, sessionId), isNull(liveSessions.coHostUserId)))
                .returning({ id: liveSessions.id });
            if (updated.length === 0) {
                throw conflict(
                    'cohost_already_assigned',
                    'remove the current co-host before creating another invite link',
                );
            }
            res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
        } catch (err) {
            next(err);
        }
    });
    router.post(
        '/api/sessions/:id/cohost-invite/redeem',
        ensureIdentity,
        async (req, res, next) => {
            try {
                const id = idParam.safeParse(req.params.id);
                if (!id.success) throw badRequest('invalid_session_id');
                const parsed = coHostInviteBody.safeParse(req.body);
                if (!parsed.success) {
                    throw badRequest('invalid_body', parsed.error.issues[0]?.message);
                }
                const actor = req.session;
                if (!actor) throw forbidden('cohost_invite_invalid');
                const sessionId = id.data;
                const [row] = await db
                    .select({ hostUserId: liveSessions.hostUserId })
                    .from(liveSessions)
                    .where(eq(liveSessions.id, sessionId));
                if (!row) throw notFound('session_not_found');
                if (row.hostUserId === actor.userId) {
                    throw badRequest('cohost_is_host', 'the host is already publishing');
                }
                const claimed = await db
                    .update(liveSessions)
                    .set({
                        coHostUserId: actor.userId,
                        coHostInviteTokenHash: null,
                        coHostInviteExpiresAt: null,
                    })
                    .where(
                        and(
                            eq(liveSessions.id, sessionId),
                            eq(
                                liveSessions.coHostInviteTokenHash,
                                digestInviteToken(parsed.data.token),
                            ),
                            gt(liveSessions.coHostInviteExpiresAt, new Date()),
                            isNull(liveSessions.coHostUserId),
                        ),
                    )
                    .returning({ id: liveSessions.id });
                if (claimed.length === 0) throw forbidden('cohost_invite_invalid');
                const session = await getSessionById(sessionId);
                if (!session) throw notFound('session_not_found');
                res.json({ session });
            } catch (err) {
                next(err);
            }
        },
    );
    router.delete('/api/sessions/:id/cohost', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const sessionId = id.data;
            const cleared = await db
                .update(liveSessions)
                .set({
                    coHostUserId: null,
                    coHostInviteTokenHash: null,
                    coHostInviteExpiresAt: null,
                })
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
