import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { isGuestEmail, type PublicUser, type Role } from '@shop/shared';
import { db } from '../db/client.js';
import { adoptGuestCart } from '../domain/cart.js';
import { badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { BUDGETS, rateLimit } from '../lib/ratelimit.js';
import { createSession, destroySession, ensureIdentity, requireAuth, } from '../middleware/session.js';
export const router = Router();
const BCRYPT_COST = 10;
const registerBody = z.object({
    email: z.string().email().max(200),
    password: z.string().min(8).max(200),
    displayName: z.string().min(1).max(80),
    defaultPincode: z
        .string()
        .regex(/^\d{6}$/)
        .optional(),
    preferredLanguage: z.string().min(2).max(10).optional(),
});
const loginBody = z.object({
    email: z.string().email().max(200),
    password: z.string().min(1).max(200),
});
type UserRow = {
    id: string;
    email: string;
    password_hash: string;
    display_name: string;
    role: Role;
    default_pincode: string | null;
    preferred_language: string;
    banned_at: string | null;
    deleted_at: string | null;
};
const toPublicUser = (r: UserRow): PublicUser => ({
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    role: r.role,
    defaultPincode: r.default_pincode,
    preferredLanguage: r.preferred_language,
    isGuest: isGuestEmail(r.email),
});
const findByEmail = async (email: string): Promise<UserRow | undefined> => {
    const { rows } = await db.execute<UserRow>(sql `
    select id, email, password_hash, display_name, role::text as role, default_pincode,
           preferred_language, banned_at, deleted_at
    from users
    where lower(email) = lower(${email})
  `);
    return rows[0];
};
const findById = async (id: string): Promise<UserRow | undefined> => {
    const { rows } = await db.execute<UserRow>(sql `
    select id, email, password_hash, display_name, role::text as role, default_pincode,
           preferred_language, banned_at, deleted_at
    from users
    where id = cast(${id} as uuid)
  `);
    return rows[0];
};
const currentGuestId = async (req: {
    session?: {
        userId: string;
    };
}): Promise<string | null> => {
    const userId = req.session?.userId;
    if (userId === undefined)
        return null;
    const row = await findById(userId);
    return row && isGuestEmail(row.email) ? row.id : null;
};
router.post('/api/auth/register', async (req, res, next) => {
    try {
        const parsed = registerBody.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid registration payload', {
                issues: parsed.error.issues,
            });
        }
        const { email, password, displayName, defaultPincode, preferredLanguage } = parsed.data;
        if (await findByEmail(email))
            throw conflict('email_taken', 'that email is already registered');
        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
        const { rows } = await db.execute<UserRow>(sql `
      insert into users (email, password_hash, display_name, default_pincode, preferred_language)
      values (${email.toLowerCase()}, ${passwordHash}, ${displayName},
              ${defaultPincode ?? null}, ${preferredLanguage ?? 'en-US'})
      returning id, email, password_hash, display_name, role::text as role, default_pincode,
                preferred_language, banned_at, deleted_at
    `);
        const row = rows[0];
        if (!row)
            throw conflict('email_taken');
        const guestId = await currentGuestId(req);
        await createSession(res, { userId: row.id, role: row.role });
        if (guestId)
            await adoptGuestCart(guestId, row.id);
        res.status(201).json({ user: toPublicUser(row) });
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/auth/login', rateLimit('login', BUDGETS.login), async (req, res, next) => {
    try {
        const parsed = loginBody.safeParse(req.body);
        if (!parsed.success)
            throw unauthorized('invalid_credentials');
        const row = await findByEmail(parsed.data.email);
        const hash = row?.password_hash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
        const ok = await bcrypt.compare(parsed.data.password, hash);
        if (!row || !ok)
            throw unauthorized('invalid_credentials');
        if (row.deleted_at)
            throw unauthorized('invalid_credentials');
        if (row.banned_at)
            throw forbidden('account_banned');
        const guestId = await currentGuestId(req);
        await createSession(res, { userId: row.id, role: row.role });
        if (guestId)
            await adoptGuestCart(guestId, row.id);
        res.json({ user: toPublicUser(row) });
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/auth/logout', async (req, res, next) => {
    try {
        await destroySession(req, res);
        res.status(204).end();
    }
    catch (err) {
        next(err);
    }
});
router.post('/api/auth/guest', rateLimit('login', BUDGETS.login), ensureIdentity, async (req, res, next) => {
    try {
        const row = await findById(req.session!.userId);
        if (!row)
            throw unauthorized();
        res.json({ user: toPublicUser(row) });
    }
    catch (err) {
        next(err);
    }
});
router.get('/api/auth/me', requireAuth, async (req, res, next) => {
    try {
        const row = await findById(req.session!.userId);
        if (!row || row.deleted_at) {
            await destroySession(req, res);
            throw unauthorized();
        }
        res.json({ user: toPublicUser(row) });
    }
    catch (err) {
        next(err);
    }
});
