import { sql } from 'drizzle-orm';

import type { ProductDto } from '@shop/shared';

import { db } from '../db/client.js';
import { cacheKeys, cached } from '../lib/cache.js';
import { getProductsByIds } from './catalog.js';

/**
 * Three real strategies, each a single query returning ids that `getProductsByIds`
 * then hydrates through the product cache. Cached per user for 60 s; a wishlist write
 * invalidates that user's keys.
 */

export type RecommendationBasis = 'recently_viewed' | 'wishlist' | 'similar';

const DEFAULT_LIMIT = 8;

/** Same category, nearest price band, then rating desc. */
export const similarProducts = async (productId: string, limit: number): Promise<string[]> => {
  const { rows } = await db.execute<{ id: string }>(sql`
    with target as (
      select p.id, p.category_id, p.base_price_minor_units
      from products p where p.id = cast(${productId} as uuid)
    )
    select p.id
    from products p, target t
    where p.category_id = t.category_id and p.id <> t.id
    order by abs(p.base_price_minor_units - t.base_price_minor_units) asc,
             p.rating desc,
             p.rating_count desc
    limit ${limit}
  `);
  return rows.map((r) => r.id);
};

export const recentlyViewed = async (userId: string, limit: number): Promise<string[]> => {
  const { rows } = await db.execute<{ product_id: string }>(sql`
    select product_id, max(viewed_at) as last_seen
    from product_views
    where user_id = cast(${userId} as uuid)
    group by product_id
    order by last_seen desc
    limit ${limit}
  `);
  return rows.map((r) => r.product_id);
};

/** Products from the categories this shopper wishlisted, excluding the wishlist itself. */
export const becauseYouWishlisted = async (userId: string, limit: number): Promise<string[]> => {
  const { rows } = await db.execute<{ id: string }>(sql`
    with wished as (
      select p.id, p.category_id
      from wishlist_items w
      join products p on p.id = w.product_id
      where w.user_id = cast(${userId} as uuid)
    )
    select p.id
    from products p
    where p.category_id in (select category_id from wished)
      and p.id not in (select id from wished)
    order by p.rating desc, p.rating_count desc
    limit ${limit}
  `);
  return rows.map((r) => r.id);
};

const topRated = async (limit: number): Promise<string[]> => {
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from products order by rating desc, rating_count desc, created_at desc limit ${limit}
  `);
  return rows.map((r) => r.id);
};

export const recommend = async (a: {
  userId: string | null;
  basedOn?: RecommendationBasis;
  productId?: string;
  limit?: number;
}): Promise<ProductDto[]> => {
  const limit = Math.min(24, Math.max(1, Math.trunc(a.limit ?? DEFAULT_LIMIT)));
  const basis: RecommendationBasis =
    a.basedOn ?? (a.productId ? 'similar' : a.userId ? 'recently_viewed' : 'similar');
  const cacheKey = cacheKeys.recommendations(
    a.userId ?? 'anon',
    `${basis}:${a.productId ?? '-'}:${limit}`,
  );

  return cached(cacheKey, 60, async () => {
    const ids: string[] = [];
    const push = (candidates: string[]): void => {
      for (const id of candidates) {
        if (id !== a.productId && !ids.includes(id)) ids.push(id);
      }
    };

    if (basis === 'similar' && a.productId) push(await similarProducts(a.productId, limit));
    if (basis === 'recently_viewed' && a.userId) push(await recentlyViewed(a.userId, limit));
    if (basis === 'wishlist' && a.userId) push(await becauseYouWishlisted(a.userId, limit));

    // Fill the strip rather than render a gap: wishlist affinity, then top rated.
    if (ids.length < limit && a.userId) push(await becauseYouWishlisted(a.userId, limit));
    if (ids.length < limit) push(await topRated(limit));

    return getProductsByIds(ids.slice(0, limit));
  });
};
