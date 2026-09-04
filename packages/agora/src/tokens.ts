import agoraToken from 'agora-token';
import { sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { env } from '@shop/platform/env.js';
import { rtmAccountForUser } from '@shop/shared';

const { RtcRole, RtcTokenBuilder, RtmTokenBuilder } = agoraToken;
const TTL = env.AGORA_TOKEN_TTL_SECONDS;
export type RtcRoleName = 'publisher' | 'subscriber';
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
export const mintRtmToken = (userId: string): string =>
    RtmTokenBuilder.buildToken(
        env.AGORA_APP_ID,
        env.AGORA_APP_CERTIFICATE,
        rtmAccountForUser(userId),
        TTL,
    );
export const nextAgoraUid = async (): Promise<number> => {
    const result = await db.execute<{
        uid: string;
    }>(sql`select nextval('agora_uid_seq')::text as uid`);
    const row = result.rows[0];
    if (!row) throw new Error('agora_uid_seq returned no row');
    return Number(row.uid);
};
export const agoraBasicAuth = (): string | null => {
    if (!env.AGORA_CUSTOMER_ID || !env.AGORA_CUSTOMER_SECRET) return null;
    const raw = `${env.AGORA_CUSTOMER_ID}:${env.AGORA_CUSTOMER_SECRET}`;
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
};
export const AGORA_REST_BASE = env.AGORA_API_BASE.replace(/\/+$/, '');
