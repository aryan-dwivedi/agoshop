import type { LiveSessionDto } from '@shop/shared';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { hlsOrigin, hlsOriginReady } from '@shop/agora/mediapush.js';
import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { EVENTS } from '@shop/shared';

type DeliveryTierRow = {
    id: string;
    slug: string;
    hlsUrl: string | null;
    hlsOriginKind: LiveSessionDto['hlsOriginKind'];
    mediaPushStatus: string;
};
const publishCdnTransition = async (row: DeliveryTierRow): Promise<boolean> =>
    db.transaction(async (tx) => {
        const { rows } = await tx.execute<{ published_at: Date | null }>(sql`
      select delivery_tier_published_at as published_at
      from live_sessions
      where id = cast(${row.id} as uuid)
      for update
    `);
        if (rows[0]?.published_at) return false;
        const origin = hlsOrigin(row);
        await publishToSession(row.id, EVENTS.sessionDeliveryTierChanged, {
            sessionId: row.id,
            deliveryTier: 'cdn',
            hlsUrl: origin.hlsUrl,
            hlsOriginKind: origin.hlsOriginKind,
        });
        await tx
            .update(liveSessions)
            .set({ deliveryTierPublishedAt: new Date() })
            .where(eq(liveSessions.id, row.id));
        return true;
    });
export const evaluateDeliveryTier = async (
    row: DeliveryTierRow,
    viewers: number,
): Promise<'rtc' | 'cdn'> => {
    const [stored] = await db
        .select({
            deliveryTier: liveSessions.deliveryTier,
            publishedAt: liveSessions.deliveryTierPublishedAt,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, row.id));
    if (!stored) return 'rtc';
    if (stored.deliveryTier === 'cdn') {
        await redis.set(keys.sessionTier(row.id), 'cdn');
        await publishCdnTransition(row);
        return 'cdn';
    }
    if (viewers < env.RTC_TIER_MAX_VIEWERS) return 'rtc';
    if (!hlsOriginReady(row)) return 'rtc';
    const won = await db
        .update(liveSessions)
        .set({ deliveryTier: 'cdn', deliveryTierPublishedAt: null })
        .where(and(eq(liveSessions.id, row.id), eq(liveSessions.deliveryTier, 'rtc')))
        .returning({ id: liveSessions.id });
    await redis.set(keys.sessionTier(row.id), 'cdn');
    await publishCdnTransition(row);
    if (won.length > 0) {
        const origin = hlsOrigin(row);
        track({
            type: 'delivery_tier_changed',
            sessionId: row.id,
            payload: {
                from: 'rtc',
                to: 'cdn',
                hlsOriginKind: origin.hlsOriginKind,
                viewers,
            },
        });
        logger.info(
            { sessionId: row.id, viewers, hlsOriginKind: origin.hlsOriginKind },
            'delivery tier transitioned rtc -> cdn',
        );
    }
    return 'cdn';
};
export const reconcileDeliveryTierPublications = async (): Promise<number> => {
    const rows = await db
        .select({
            id: liveSessions.id,
            slug: liveSessions.slug,
            hlsUrl: liveSessions.hlsUrl,
            hlsOriginKind: liveSessions.hlsOriginKind,
            mediaPushStatus: liveSessions.mediaPushStatus,
        })
        .from(liveSessions)
        .where(
            and(eq(liveSessions.deliveryTier, 'cdn'), isNull(liveSessions.deliveryTierPublishedAt)),
        )
        .limit(100);
    let published = 0;
    for (const row of rows) {
        await evaluateDeliveryTier(row, env.RTC_TIER_MAX_VIEWERS);
        published += 1;
    }
    return published;
};
