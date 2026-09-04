import { randomBytes, randomUUID } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';

import { GUEST_DISPLAY_NAME, guestEmailFor, type Role } from '@shop/shared';

import { db } from '../db/client.js';
import { liveSessions, users } from '../db/schema.js';
import { env } from '../env.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { keys, redis } from '../lib/redis.js';

/**
 * Opaque 32-byte session ids in a signed httpOnly cookie, records in Redis with a
 * 7-day sliding TTL. Replicas stay stateless: any process can serve any cookie.
 */
const COOKIE = 'sid';
const TTL_SECONDS = 7 * 24 * 60 * 60;
const cookieScope = {
  path: '/',
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
} as const satisfies CookieOptions;

type SessionRecord = { userId: string; role: Role };

export const createSession = async (res: Response, record: SessionRecord): Promise<string> => {
  const id = randomBytes(32).toString('base64url');
  await redis.set(keys.session(id), JSON.stringify(record), 'EX', TTL_SECONDS);
  res.cookie(COOKIE, id, {
    ...cookieScope,
    httpOnly: true,
    signed: true,
    maxAge: TTL_SECONDS * 1000,
  });
  return id;
};

export const destroySession = async (req: Request, res: Response): Promise<void> => {
  if (req.session) await redis.del(keys.session(req.session.id));
  res.clearCookie(COOKIE, cookieScope);
};

export const loadSession = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.signedCookies?.[COOKIE];
    if (typeof id === 'string' && id.length > 0) {
      const raw = await redis.get(keys.session(id));
      if (raw) {
        const record = JSON.parse(raw) as SessionRecord;
        req.session = { id, ...record };
        // Sliding expiry.
        await redis.expire(keys.session(id), TTL_SECONDS);
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.session) {
    next(unauthorized());
    return;
  }
  next();
};

/**
 * Guarantees an identity instead of demanding an account: an unauthenticated caller
 * is given a guest `users` row and the same cookie session a registered shopper gets.
 *
 * This is the whole of guest support. Carts, orders, idempotency keys, SSE channels,
 * RTM accounts, AI conversations and promotion eligibility are all keyed by a user
 * uuid, so handing them a real uuid keeps one code path where a nullable identity
 * would have forked every one of them. Guest-ness stays legible downstream through
 * the reserved email domain (`isGuestEmail`).
 *
 * Mounted on the endpoints a shopper reaches by shopping — watching, adding to the
 * cart, checking out, talking to the assistant. Routes that are meaningless without
 * a real account (profile reads, data erasure) keep `requireAuth`, and role-gated
 * seller/admin routes are unaffected because a guest is a `shopper`.
 */
export const ensureIdentity = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (req.session) {
      next();
      return;
    }
    // The uuid is generated here rather than taken from the row default so the
    // reserved address is derivable from the id it belongs to.
    const id = randomUUID();
    const [row] = await db
      .insert(users)
      .values({
        id,
        email: guestEmailFor(id),
        // Empty, never a hash of anything: bcrypt.compare can never match it, so a
        // guest address is not a login. `me.ts` erasure already relies on this.
        passwordHash: '',
        displayName: GUEST_DISPLAY_NAME,
        role: 'shopper',
      })
      .returning({ id: users.id, role: users.role });
    if (!row) throw unauthorized();
    const sessionId = await createSession(res, { userId: row.id, role: row.role });
    req.session = { id: sessionId, userId: row.id, role: row.role };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.session) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.session.role)) {
      next(forbidden('insufficient_role'));
      return;
    }
    next();
  };

/**
 * Host-only session actions (start, end, pin, polls, moderation). Admins pass too;
 * sellers pass only for their own session.
 */
export const requireSessionHost = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (!req.session) throw unauthorized();
    // Express 5 types params as `string | string[]`, and a repeated query-style
    // param would otherwise reach the query as an array.
    const sessionId = typeof req.params.id === 'string' ? req.params.id : '';
    if (sessionId.length === 0) throw notFound('session_not_found');
    const [row] = await db
      .select({ hostUserId: liveSessions.hostUserId })
      .from(liveSessions)
      .where(eq(liveSessions.id, sessionId));
    if (!row) throw notFound('session_not_found');
    if (req.session.role === 'admin') {
      next();
      return;
    }
    if (row.hostUserId !== req.session.userId) throw forbidden('not_session_host');
    next();
  } catch (err) {
    next(err);
  }
};
