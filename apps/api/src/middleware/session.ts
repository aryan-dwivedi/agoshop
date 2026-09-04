import { randomBytes, randomUUID } from 'node:crypto';
import type { CookieOptions, NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { GUEST_DISPLAY_NAME, guestEmailFor, type Role } from '@shop/shared';
import { db } from '../db/client.js';
import { liveSessions, users } from '../db/schema.js';
import { env } from '../env.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import { keys, redis } from '../lib/redis.js';
const COOKIE = 'sid';
const TTL_SECONDS = 7 * 24 * 60 * 60;
const cookieScope = {
    path: '/',
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
} as const satisfies CookieOptions;
type SessionRecord = {
    userId: string;
    role: Role;
};
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
    if (req.session)
        await redis.del(keys.session(req.session.id));
    res.clearCookie(COOKIE, cookieScope);
};
export const loadSession = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
        const id = req.signedCookies?.[COOKIE];
        if (typeof id === 'string' && id.length > 0) {
            const raw = await redis.get(keys.session(id));
            if (raw) {
                const record = JSON.parse(raw) as SessionRecord;
                req.session = { id, ...record };
                await redis.expire(keys.session(id), TTL_SECONDS);
            }
        }
        next();
    }
    catch (err) {
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
export const ensureIdentity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        if (req.session) {
            next();
            return;
        }
        const id = randomUUID();
        const [row] = await db
            .insert(users)
            .values({
            id,
            email: guestEmailFor(id),
            passwordHash: '',
            displayName: GUEST_DISPLAY_NAME,
            role: 'shopper',
        })
            .returning({ id: users.id, role: users.role });
        if (!row)
            throw unauthorized();
        const sessionId = await createSession(res, { userId: row.id, role: row.role });
        req.session = { id: sessionId, userId: row.id, role: row.role };
        next();
    }
    catch (err) {
        next(err);
    }
};
export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction): void => {
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
export const requireSessionHost = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
        if (!req.session)
            throw unauthorized();
        const sessionId = typeof req.params.id === 'string' ? req.params.id : '';
        if (sessionId.length === 0)
            throw notFound('session_not_found');
        const [row] = await db
            .select({ hostUserId: liveSessions.hostUserId })
            .from(liveSessions)
            .where(eq(liveSessions.id, sessionId));
        if (!row)
            throw notFound('session_not_found');
        if (req.session.role === 'admin') {
            next();
            return;
        }
        if (row.hostUserId !== req.session.userId)
            throw forbidden('not_session_host');
        next();
    }
    catch (err) {
        next(err);
    }
};
