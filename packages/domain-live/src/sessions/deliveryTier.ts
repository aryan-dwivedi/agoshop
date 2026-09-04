import type { LiveSessionDto } from '@shop/shared';

import { eq } from 'drizzle-orm';

import { hlsOrigin, hlsOriginReady } from '@shop/agora/mediapush.js';
import { db } from '@shop/db/client.js';
import { liveSessions } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { EVENTS } from '@shop/shared';

const TIER_CAS = `
local current = redis.call('GET', KEYS[1])
if current == 'cdn' then return 0 end
redis.call('SET', KEYS[1], 'cdn')
return 1
`;
export const evaluateDeliveryTier = async (
    row: {
        id: string;
        slug: string;
        hlsUrl: string | null;
        hlsOriginKind: LiveSessionDto['hlsOriginKind'];
        mediaPushStatus: string;
    },
    viewers: number,
): Promise<'rtc' | 'cdn'> => {
    const key = keys.sessionTier(row.id);
    const stored = await redis.get(key);
    if (stored === 'cdn') return 'cdn';
    if (viewers < env.RTC_TIER_MAX_VIEWERS) return 'rtc';
    if (!hlsOriginReady(row)) return 'rtc';
    const won = (await redis.eval(TIER_CAS, 1, key)) as number;
    if (won !== 1) return 'cdn';
    await db.update(liveSessions).set({ deliveryTier: 'cdn' }).where(eq(liveSessions.id, row.id));
    const origin = hlsOrigin(row);
    await publishToSession(row.id, EVENTS.sessionDeliveryTierChanged, {
        sessionId: row.id,
        deliveryTier: 'cdn',
        hlsUrl: origin.hlsUrl,
        hlsOriginKind: origin.hlsOriginKind,
    });
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
    return 'cdn';
};
