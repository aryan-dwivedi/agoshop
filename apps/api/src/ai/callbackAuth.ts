import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { env } from '../env.js';
import { unauthorized } from '../lib/errors.js';

/**
 * Callback authentication for Agora's custom-LLM POSTs.
 *
 * This is a PER-CONVERSATION HMAC, not a global shared secret:
 *
 *   signature = base64url(HMAC-SHA256(CONVO_LLM_SHARED_SECRET, `${conversationId}.${expires}`))
 *
 * so a leaked signature is scoped to one conversation and expires with it. The signing
 * key never leaves the server. Verification recomputes the signature from the
 * conversation id **in the request path** and the `X-Convo-Expires` header, then
 * compares in constant time — an attacker cannot make the server verify against an id
 * they chose, because the id being signed is the one being served.
 *
 * `Authorization` is NEVER consulted. The same signature is placed in `llm.api_key`
 * only because Agora may require a non-empty key there, and Agora's own auth-header
 * format for that field is undocumented.
 */

/** Reject a stale replay and a clock-skewed-or-forged far-future expiry alike. */
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
  | { ok: true; conversationId: string; expires: number }
  | { ok: false; reason: CallbackAuthFailure };

/**
 * Pure verification, so the route and the checks exercise exactly the same logic.
 * `nowSeconds` is injected rather than read from the clock inside the comparison.
 */
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

  // Signed over the PATH conversation id: a signature minted for another conversation
  // cannot authorize this one.
  const expected = Buffer.from(signCallback(conversationId, expires), 'utf8');
  const presented = Buffer.from(signatureHeader.trim(), 'utf8');
  if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true, conversationId, expires };
};

/**
 * The conversation id as it appears in the path. `@types/express-serve-static-core@5`
 * types params as `string | string[]`, and this value is what the HMAC is computed
 * over, so it is validated rather than asserted.
 */
export const callbackConversationId = (value: unknown): string | null => {
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
};

/**
 * Express middleware form. Every failure is a flat `401` with no distinguishing body,
 * so a prober learns nothing about which of expiry or signature failed; the reason is
 * logged server-side instead.
 */
export const requireCallbackAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const conversationId = callbackConversationId(req.params.conversationId);
  const result = conversationId
    ? verifyCallback(
        conversationId,
        req.header('X-Convo-Expires') ?? undefined,
        req.header('X-Convo-Signature') ?? undefined,
      )
    : ({ ok: false, reason: 'malformed_conversation_id' } as const);

  if (!result.ok) {
    req.log.warn({ reason: result.reason }, 'ai callback authorization rejected');
    next(unauthorized('invalid_callback_signature'));
    return;
  }

  next();
};
