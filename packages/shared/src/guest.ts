/**
 * Guest identity.
 *
 * A guest is a real `users` row — not a special case threaded through the domain.
 * Every downstream system (carts, orders, idempotency keys, SSE channels, RTM
 * accounts, AI conversations, promotion eligibility) is keyed by a user uuid, so
 * minting a row is what makes an unauthenticated shopper work everywhere at once
 * instead of growing a parallel anonymous code path.
 *
 * Guest-ness is therefore a durable property of the row, encoded in the reserved
 * email domain below. That is deliberately the ONLY source of truth: a Redis flush,
 * a replica restart or a 7-day cookie all still agree on who is a guest.
 */

/** Reserved, non-routable (RFC 6761 `.invalid`) so a guest address can never collide. */
export const GUEST_EMAIL_DOMAIN = 'guest.invalid';

export const guestEmailFor = (id: string): string => `guest-${id}@${GUEST_EMAIL_DOMAIN}`;

export const isGuestEmail = (email: string): boolean =>
  email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);

export const GUEST_DISPLAY_NAME = 'Guest';
