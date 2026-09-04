import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { rtmAccountForUser } from '@shop/shared';
import { resolveRtcTokenRole } from '../agora/rtcRole.js';
import { mintRtcToken, mintRtmToken, nextAgoraUid } from '../agora/tokens.js';
import { db } from '../db/client.js';
import { liveSessions, users } from '../db/schema.js';
import { badRequest, forbidden, unauthorized } from '../lib/errors.js';
import { rateLimit } from '../lib/ratelimit.js';
import { ensureIdentity } from '../middleware/session.js';
export const router: Router = Router();
const TOKEN_BUDGET = { perMinute: 60 };
const rtcBody = z.object({
    channel: z.string().min(1).max(64),
    role: z.enum(['host', 'publisher', 'audience', 'subscriber']).optional(),
    uid: z.number().int().positive().optional(),
});
const assertNotPlatformBanned = async (userId: string): Promise<void> => {
    const [row] = await db
        .select({ bannedAt: users.bannedAt, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, userId));
    if (!row)
        throw unauthorized();
    if (row.deletedAt)
        throw forbidden('account_deleted');
    if (row.bannedAt)
        throw forbidden('platform_banned');
};
router.post('/api/rtc/token', ensureIdentity, rateLimit('tokens', TOKEN_BUDGET), async (req, res, next) => {
    try {
        const session = req.session;
        if (!session)
            throw unauthorized();
        await assertNotPlatformBanned(session.userId);
        const parsed = rtcBody.safeParse(req.body);
        if (!parsed.success)
            throw badRequest('invalid_body', parsed.error.issues[0]?.message);
        const { channel } = parsed.data;
        const requested = parsed.data.role ?? 'subscriber';
        const wantsPublisher = requested === 'host' || requested === 'publisher';
        let hostUserId: string | null = null;
        let coHostUserId: string | null = null;
        if (wantsPublisher && session.role !== 'admin') {
            const [owner] = await db
                .select({
                hostUserId: liveSessions.hostUserId,
                coHostUserId: liveSessions.coHostUserId,
            })
                .from(liveSessions)
                .where(eq(liveSessions.rtcChannel, channel));
            hostUserId = owner?.hostUserId ?? null;
            coHostUserId = owner?.coHostUserId ?? null;
        }
        const role = resolveRtcTokenRole(requested, {
            userId: session.userId,
            userRole: session.role,
            hostUserId,
            coHostUserId,
        });
        const uid = parsed.data.uid ?? (await nextAgoraUid());
        res.json({ channel, uid, role, rtcToken: mintRtcToken(channel, uid, role) });
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/rtm/token', ensureIdentity, rateLimit('tokens', TOKEN_BUDGET), async (req, res, next) => {
    try {
        const session = req.session;
        if (!session)
            throw unauthorized();
        await assertNotPlatformBanned(session.userId);
        res.json({
            account: rtmAccountForUser(session.userId),
            rtmToken: mintRtmToken(session.userId),
        });
    }
    catch (err) {
        next(err);
    }
});
