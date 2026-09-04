import { eq } from 'drizzle-orm';

import { EVENTS } from '@shop/shared';
import type { LiveSessionDto } from '@shop/shared';

import { hlsOrigin, hlsOriginReady } from '../../agora/mediapush.js';
import { db } from '../../db/client.js';
import { liveSessions } from '../../db/schema.js';
import { env } from '../../env.js';
import { track } from '../../lib/analytics.js';
import { logger } from '../../lib/logger.js';
import { keys, redis } from '../../lib/redis.js';
import { publishToSession } from '../../lib/sse.js';

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
    payload: { from: 'rtc', to: 'cdn', hlsOriginKind: origin.hlsOriginKind, viewers },
  });
  logger.info(
    { sessionId: row.id, viewers, hlsOriginKind: origin.hlsOriginKind },
    'delivery tier transitioned rtc -> cdn',
  );
  return 'cdn';
};
