import type { JoinSessionDto, Role } from '@shop/shared';

import { eq } from 'drizzle-orm';

import { hlsOrigin } from '@shop/agora/mediapush.js';
import { mintRtcToken, nextAgoraUid } from '@shop/agora/tokens.js';
import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { notFound } from '@shop/platform/lib/errors.js';
import { chatShardChannel } from '@shop/shared';

import { shardIndexFor } from '../chat.js';
import { evaluateDeliveryTier } from './deliveryTier.js';
import { liveSourceFor } from './hydration.js';
import { touchPresence, viewerCount } from './presence.js';

export const joinSession = async (
    sessionId: string,
    user: {
        userId: string;
        role: Role;
    },
): Promise<JoinSessionDto> => {
    const [row] = await db.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
    if (!row) throw notFound('session_not_found');
    const uid = await nextAgoraUid();
    const isPublisher =
        row.hostUserId === user.userId || row.coHostUserId === user.userId || user.role === 'admin';
    const rtcToken = mintRtcToken(row.rtcChannel, uid, isPublisher ? 'publisher' : 'subscriber');
    const viewers =
        row.status === 'live' && !isPublisher ? await touchPresence(sessionId, user.userId) : 0;
    const tier =
        row.status === 'live' ? await evaluateDeliveryTier(row, viewers) : row.deliveryTier;
    const shardIndex = shardIndexFor(user.userId, row.chatShardCount);
    const origin = hlsOrigin(row);
    const liveSource = liveSourceFor(row);
    track({ type: 'session_join', userId: user.userId, sessionId });
    return {
        deliveryTier: tier,
        rtcChannel: row.rtcChannel,
        rtcToken,
        uid,
        chatChannel: chatShardChannel(row.slug, shardIndex),
        shardIndex,
        chatShardCount: row.chatShardCount,
        hlsUrl: origin.hlsUrl,
        hlsOriginKind: origin.hlsOriginKind,
        captionsEnabled: row.rttStatus === 'connecting' || row.rttStatus === 'running',
        recordingConsentRequired: env.PRIVACY_MODE === 'strict',
        ...(liveSource === null ? {} : { liveSourceUrl: liveSource }),
        serverNowMs: Date.now(),
    };
};
export const heartbeatSession = async (sessionId: string, userId: string) => {
    const [row] = await db
        .select({
            id: liveSessions.id,
            slug: liveSessions.slug,
            status: liveSessions.status,
            deliveryTier: liveSessions.deliveryTier,
            hlsUrl: liveSessions.hlsUrl,
            hlsOriginKind: liveSessions.hlsOriginKind,
            mediaPushStatus: liveSessions.mediaPushStatus,
            hostUserId: liveSessions.hostUserId,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!row) throw notFound('session_not_found');
    if (row.status !== 'live') return { viewerCount: 0, deliveryTier: row.deliveryTier };
    const count =
        row.hostUserId === userId
            ? await viewerCount(sessionId)
            : await touchPresence(sessionId, userId);
    const tier = await evaluateDeliveryTier(row, count);
    return { viewerCount: count, deliveryTier: tier };
};
