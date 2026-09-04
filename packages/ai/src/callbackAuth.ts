import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { env } from '@shop/platform/env.js';

const MAX_FUTURE_SKEW_SECONDS = 24 * 60 * 60;
export const signCallback = (conversationId: string, expiresUnixSeconds: number): string =>
    createHmac('sha256', env.CONVO_LLM_SHARED_SECRET)
        .update(`${conversationId}.${expiresUnixSeconds}`)
        .digest('base64url');
export type CallbackAuthFailure =
    | 'malformed_conversation_id'
    | 'missing_headers'
    | 'malformed_expires'
    | 'expired'
    | 'expires_too_far_future'
    | 'bad_signature';
export type CallbackAuthResult =
    | {
          ok: true;
          conversationId: string;
          expires: number;
      }
    | {
          ok: false;
          reason: CallbackAuthFailure;
      };
export const verifyCallback = (
    conversationId: string,
    expiresHeader: string | undefined,
    signatureHeader: string | undefined,
    nowSeconds: number = Math.floor(Date.now() / 1000),
): CallbackAuthResult => {
    if (!expiresHeader || !signatureHeader) return { ok: false, reason: 'missing_headers' };
    if (!/^\d{1,15}$/.test(expiresHeader.trim())) {
        return { ok: false, reason: 'malformed_expires' };
    }
    const expires = Number.parseInt(expiresHeader.trim(), 10);
    if (expires <= nowSeconds) return { ok: false, reason: 'expired' };
    if (expires - nowSeconds > MAX_FUTURE_SKEW_SECONDS) {
        return { ok: false, reason: 'expires_too_far_future' };
    }
    const expected = Buffer.from(signCallback(conversationId, expires), 'utf8');
    const presented = Buffer.from(signatureHeader.trim(), 'utf8');
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
        return { ok: false, reason: 'bad_signature' };
    }
    return { ok: true, conversationId, expires };
};
export const callbackConversationId = (value: unknown): string | null => {
    const parsed = z.string().uuid().safeParse(value);
    return parsed.success ? parsed.data : null;
};
