import { and, eq, inArray, sql } from 'drizzle-orm';

import type { LiveSessionDto, SessionStatus } from '@shop/shared';

import { db } from '../../db/client.js';
import { liveSessionProducts, liveSessions, sellers } from '../../db/schema.js';
import { keys, redis } from '../../lib/redis.js';
import { hydrate, listSessionProducts } from './hydration.js';
import { selectSessions } from './internal.js';
import { STATUS_RANK, UUID_PATTERN, type SessionFilter } from './types.js';

export const listSessions = async (filter: SessionFilter = {}): Promise<LiveSessionDto[]> => {
  const clauses = [];
  if (filter.statuses && filter.statuses.length > 0) {
    clauses.push(inArray(liveSessions.status, filter.statuses));
  }
  if (filter.sellerSlug !== undefined) clauses.push(eq(sellers.slug, filter.sellerSlug));
  const rows = await selectSessions(clauses.length > 0 ? and(...clauses) : undefined);
  return hydrate(rows);
};

export const listSessionsForSellerSlug = async (slug: string): Promise<LiveSessionDto[]> => {
  const sessions = await listSessions({ sellerSlug: slug });
  const at = (s: LiveSessionDto): number => {
    const stamp = s.status === 'ended' ? s.endedAt : (s.startedAt ?? s.scheduledFor);
    return stamp ? Date.parse(stamp) : Number.MAX_SAFE_INTEGER;
  };
  return sessions.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.status === 'ended' ? at(b) - at(a) : at(a) - at(b)) ||
      a.title.localeCompare(b.title),
  );
};

export const getSessionById = async (id: string): Promise<LiveSessionDto | null> => {
  const rows = await selectSessions(eq(liveSessions.id, id));
  const hydrated = await hydrate(rows);
  return hydrated[0] ?? null;
};

export const getSessionBySlug = async (slug: string): Promise<LiveSessionDto | null> => {
  const rows = await selectSessions(eq(liveSessions.slug, slug));
  const hydrated = await hydrate(rows);
  return hydrated[0] ?? null;
};

export const getSessionByIdOrSlug = async (key: string): Promise<LiveSessionDto | null> =>
  UUID_PATTERN.test(key) ? getSessionById(key) : getSessionBySlug(key);

export const isSessionLive = async (sessionId: string): Promise<boolean> => {
  const cached = await redis.get(keys.sessionStatus(sessionId));
  if (cached !== null) return cached === 'live';
  const [row] = await db
    .select({ status: liveSessions.status })
    .from(liveSessions)
    .where(eq(liveSessions.id, sessionId));
  if (!row) return false;
  await redis.set(keys.sessionStatus(sessionId), row.status);
  return row.status === 'live';
};

export const listLiveSessionIds = async (): Promise<string[]> => {
  const rows = await db
    .select({ id: liveSessions.id })
    .from(liveSessions)
    .where(eq(liveSessions.status, 'live'));
  return rows.map((r) => r.id);
};

export const featuredProductId = async (sessionId: string): Promise<string | null> => {
  const [row] = await db
    .select({ productId: liveSessionProducts.productId })
    .from(liveSessionProducts)
    .where(
      and(eq(liveSessionProducts.sessionId, sessionId), eq(liveSessionProducts.isFeatured, true)),
    )
    .orderBy(sql`${liveSessionProducts.pinnedAt} desc nulls last`)
    .limit(1);
  return row?.productId ?? null;
};

export { listSessionProducts };
