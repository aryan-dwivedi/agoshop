import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { resolveRtcTokenRole } from '@shop/agora/rtcRole.js';
import { mintRtcToken, mintRtmToken, nextAgoraUid } from '@shop/agora/tokens.js';
import { db } from '@shop/db/client.js';
import { aiConversations, liveSessions, supportTickets, users } from '@shop/db/schema.js';
import { badRequest, forbidden, unauthorized } from '@shop/platform/lib/errors.js';
import { rateLimit } from '@shop/platform/lib/ratelimit.js';
import { ensureIdentity } from '@shop/platform/middleware/session.js';
import { rtmAccountForUser } from '@shop/shared';

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
    if (!row) throw unauthorized();
    if (row.deletedAt) throw forbidden('account_deleted');
    if (row.bannedAt) throw forbidden('platform_banned');
};
router.post(
    '/api/rtc/token',
    ensureIdentity,
    rateLimit('tokens', TOKEN_BUDGET),
    async (req, res, next) => {
        try {
            const session = req.session;
            if (!session) throw unauthorized();
            await assertNotPlatformBanned(session.userId);
            const parsed = rtcBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            const { channel } = parsed.data;
            const requested = parsed.data.role ?? 'subscriber';
            const [liveSession] = await db
                .select({
                    hostUserId: liveSessions.hostUserId,
                    coHostUserId: liveSessions.coHostUserId,
                })
                .from(liveSessions)
                .where(eq(liveSessions.rtcChannel, channel))
                .limit(1);
            let hostUserId = liveSession?.hostUserId ?? null;
            let coHostUserId = liveSession?.coHostUserId ?? null;
            if (!liveSession) {
                const [conversation] = await db
                    .select({
                        id: aiConversations.id,
                        userId: aiConversations.userId,
                        status: aiConversations.status,
                    })
                    .from(aiConversations)
                    .where(eq(aiConversations.rtcChannel, channel))
                    .limit(1);
                if (!conversation || conversation.status === 'failed') {
                    throw forbidden('rtc_channel_unavailable');
                }
                const [ticket] = await db
                    .select({ assignedAgentId: supportTickets.assignedAgentId })
                    .from(supportTickets)
                    .where(
                        and(
                            eq(supportTickets.conversationId, conversation.id),
                            inArray(supportTickets.status, ['assigned', 'active']),
                        ),
                    )
                    .limit(1);
                const assignedAgentId = ticket?.assignedAgentId ?? null;
                const authorized =
                    session.role === 'admin' ||
                    conversation.userId === session.userId ||
                    assignedAgentId === session.userId;
                if (!authorized) throw forbidden('rtc_channel_forbidden');
                hostUserId = conversation.userId;
                coHostUserId = assignedAgentId;
            }
            const role = resolveRtcTokenRole(requested, {
                userId: session.userId,
                userRole: session.role,
                hostUserId,
                coHostUserId,
            });
            const uid = parsed.data.uid ?? (await nextAgoraUid());
            res.json({
                channel,
                uid,
                role,
                rtcToken: mintRtcToken(channel, uid, role),
            });
        } catch (err) {
            next(err);
        }
    },
);
router.post(
    '/api/rtm/token',
    ensureIdentity,
    rateLimit('tokens', TOKEN_BUDGET),
    async (req, res, next) => {
        try {
            const session = req.session;
            if (!session) throw unauthorized();
            await assertNotPlatformBanned(session.userId);
            res.json({
                account: rtmAccountForUser(session.userId),
                rtmToken: mintRtmToken(session.userId),
            });
        } catch (err) {
            next(err);
        }
    },
);
