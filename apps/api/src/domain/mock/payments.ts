import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { logger } from '../../lib/logger.js';

/**
 * MOCK PAYMENT SERVICE — DELIBERATELY IN-PROCESS.
 *
 * `preauthorize` performs NO external call and charges nothing. It waits 200 ms to
 * make the latency of a real gateway visible in the request path, then returns a
 * synthetic `paymentRef`. The single deterministic failure is a card number ending
 * in `0000`, which is how the demo and the acceptance checks exercise the decline
 * path. `voidPreauthorization` likewise only logs — there is nothing to reverse.
 *
 * Why this shape (architecture decision 16): the pre-authorization runs BEFORE the
 * stock transaction is opened, so no database transaction or row lock is ever held
 * across the 200 ms delay. A real provider would be authorize -> reserve ->
 * capture/void with an expiry reconciler; a database rollback cannot undo an
 * external charge and this code never pretends otherwise.
 */

export const PREAUTH_DELAY_MS = 200;

export type PaymentCard = {
  number: string;
  expiry?: string;
  cvv?: string;
  name?: string;
};

export type PreauthorizeInput = {
  method: string;
  amountMinorUnits: number;
  card?: PaymentCard | null;
};

export type PreauthorizeResult =
  | { ok: true; paymentRef: string }
  | { ok: false; reason: 'card_declined' | 'invalid_amount' | 'card_required' };

const CARD_METHODS: Record<string, true> = { card: true, emi: true };

export const preauthorize = async (input: PreauthorizeInput): Promise<PreauthorizeResult> => {
  await sleep(PREAUTH_DELAY_MS);

  if (!Number.isInteger(input.amountMinorUnits) || input.amountMinorUnits <= 0) {
    return { ok: false, reason: 'invalid_amount' };
  }

  const digits = input.card?.number?.replace(/\D/g, '') ?? '';
  if (CARD_METHODS[input.method]) {
    if (digits.length < 12) return { ok: false, reason: 'card_required' };
  }
  // The one deterministic decline in the whole system.
  if (digits.endsWith('0000')) return { ok: false, reason: 'card_declined' };

  const paymentRef = `mockpay_${randomUUID()}`;
  logger.info(
    { paymentRef, method: input.method, amountMinorUnits: input.amountMinorUnits },
    'mock pre-authorization granted (no external call)',
  );
  return { ok: true, paymentRef };
};

/** Compensating action for every abort after a successful pre-authorization. */
export const voidPreauthorization = async (paymentRef: string): Promise<void> => {
  logger.info({ paymentRef }, 'mock pre-authorization voided (no external call)');
  await Promise.resolve();
};

/** Alias for the async pipeline; same mock semantics as preauthorize. */
export const authorize = preauthorize;

export type CaptureResult =
  { ok: true; captureRef: string } | { ok: false; reason: 'capture_failed' | 'not_authorized' };

export const capture = async (paymentRef: string): Promise<CaptureResult> => {
  await sleep(50);
  if (!paymentRef.startsWith('mockpay_')) {
    return { ok: false, reason: 'not_authorized' };
  }
  const captureRef = `${paymentRef}_cap`;
  logger.info({ paymentRef, captureRef }, 'mock payment captured (no external call)');
  return { ok: true, captureRef };
};
