import { asc, eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { liveSessions, sellers, users } from '../../db/schema.js';
import type { SessionRow } from './types.js';
export const selectSessions = async (where: SQL | undefined): Promise<SessionRow[]> => {
    const base = db
        .select({
        session: liveSessions,
        sellerName: sellers.displayName,
        coHostName: users.displayName,
    })
        .from(liveSessions)
        .innerJoin(sellers, eq(sellers.id, liveSessions.sellerId))
        .leftJoin(users, eq(users.id, liveSessions.coHostUserId))
        .orderBy(asc(liveSessions.scheduledFor), asc(liveSessions.createdAt));
    const rows = where ? await base.where(where) : await base;
    return rows.map((r) => ({
        ...r.session,
        sellerName: r.sellerName,
        coHostName: r.coHostName,
    }));
};
