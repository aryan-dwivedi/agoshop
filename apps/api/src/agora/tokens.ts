import agoraToken from 'agora-token';
import { sql } from 'drizzle-orm';

import { rtmAccountForUser } from '@shop/shared';

import { db } from '../db/client.js';
import { env } from '../env.js';

// `agora-token@2.0.6` is CommonJS and Node's ESM loader cannot statically detect its
// named exports, so `import { RtcRole } from 'agora-token'` throws at load time.
// Destructuring the interop default is the working form.
const { RtcRole, RtcTokenBuilder, RtmTokenBuilder } = agoraToken;

/**
 * Token minting. The App Certificate never leaves this process.
 *
 * `agora-token@2.0.6` expiries are SECONDS FROM NOW, not unix timestamps — passing a
 * unix timestamp mints a token valid for ~57 years, which is the single most common
 * mistake against this API. Both the token expiry and the privilege expiry get the
 * same TTL, because a privilege outliving its token is meaningless.
 */

const TTL = env.AGORA_TOKEN_TTL_SECONDS;

export type RtcRoleName = 'publisher' | 'subscriber';

/**
 * Viewer / host / recorder RTC token, bound to one numeric uid.
 * Audience members get SUBSCRIBER so a viewer token cannot publish media.
 */
export const mintRtcToken = (channel: string, uid: number, role: RtcRoleName): string =>
  RtcTokenBuilder.buildTokenWithUid(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channel,
    uid,
    role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    TTL,
    TTL,
  );

/**
 * ConvoAI **agent** token only. `advanced_features.enable_rtm:true` makes the agent
 * publish transcripts to a Signaling channel named exactly the RTC channel, so its
 * token needs combined RTC+RTM privileges, and the RTM account it is minted for MUST
 * equal `agent_rtc_uid` — Agora rejects the mismatch. Never mint this for a viewer:
 * viewers get a standalone RTM token for the stable `user-<id>` account instead, which
 * is what makes chat publisher identity unforgeable (decision 11).
 */
export const mintAgentRtcRtmToken = (channel: string, agentUid: number): string =>
  RtcTokenBuilder.buildTokenWithRtm(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    channel,
    String(agentUid),
    RtcRole.PUBLISHER,
    TTL,
    TTL,
  );

/**
 * Standalone Signaling token for the browser's single RTM client (decision 2).
 * The account is stable across logins and channels, so chat reads, presence and AI
 * transcripts all ride one identity.
 */
export const mintRtmToken = (userId: string): string =>
  RtmTokenBuilder.buildToken(
    env.AGORA_APP_ID,
    env.AGORA_APP_CERTIFICATE,
    rtmAccountForUser(userId),
    TTL,
  );

/**
 * One Postgres sequence hands out every numeric uid — viewer, agent, recorder and
 * caption bot — so they can never collide inside a channel.
 */
export const nextAgoraUid = async (): Promise<number> => {
  const result = await db.execute<{ uid: string }>(
    sql`select nextval('agora_uid_seq')::text as uid`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('agora_uid_seq returned no row');
  return Number(row.uid);
};

/**
 * Customer-credential Basic auth shared by every Agora REST surface (Signaling
 * messaging, ConvoAI, Cloud Recording, RTT, Media Push). Returns `null` when the
 * credentials are absent so each client can degrade explicitly instead of sending
 * `Basic Og==` and reading a 401 as a product failure.
 */
export const agoraBasicAuth = (): string | null => {
  if (!env.AGORA_CUSTOMER_ID || !env.AGORA_CUSTOMER_SECRET) return null;
  const raw = `${env.AGORA_CUSTOMER_ID}:${env.AGORA_CUSTOMER_SECRET}`;
  return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
};

/** Dual-domain base; `api.sd-rtn.com` is the documented failover host. */
export const AGORA_REST_BASE = env.AGORA_API_BASE.replace(/\/+$/, '');
