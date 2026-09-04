import { sql } from 'drizzle-orm';
import type { ProductDto } from '@shop/shared';
import { db } from '../db/client.js';
import { notFound } from '../lib/errors.js';
import { invalidate } from '../lib/cache.js';
import { getProductsByIds } from './catalog.js';
const invalidateUserRecommendations = (userId: string): Promise<number> => invalidate(`rec:v1:${userId}`);
export const addToWishlist = async (userId: string, productId: string): Promise<{
    added: boolean;
}> => {
    const { rows: exists } = await db.execute<{
        id: string;
    }>(sql `select id from products where id = cast(${productId} as uuid)`);
    if (exists.length === 0)
        throw notFound('product_not_found');
    const { rowCount } = await db.execute(sql `
    insert into wishlist_items (user_id, product_id)
    values (cast(${userId} as uuid), cast(${productId} as uuid))
    on conflict (user_id, product_id) do nothing
  `);
    await invalidateUserRecommendations(userId);
    return { added: (rowCount ?? 0) > 0 };
};
export const removeFromWishlist = async (userId: string, productId: string): Promise<{
    removed: boolean;
}> => {
    const { rowCount } = await db.execute(sql `
    delete from wishlist_items
    where user_id = cast(${userId} as uuid) and product_id = cast(${productId} as uuid)
  `);
    await invalidateUserRecommendations(userId);
    return { removed: (rowCount ?? 0) > 0 };
};
export const listWishlist = async (userId: string): Promise<ProductDto[]> => {
    const { rows } = await db.execute<{
        product_id: string;
    }>(sql `
    select product_id from wishlist_items
    where user_id = cast(${userId} as uuid)
    order by created_at desc
  `);
    return getProductsByIds(rows.map((r) => r.product_id));
};
export const isWishlisted = async (userId: string, productId: string): Promise<boolean> => {
    const { rows } = await db.execute<{
        ok: boolean;
    }>(sql `
    select exists(select 1 from wishlist_items
                  where user_id = cast(${userId} as uuid)
                    and product_id = cast(${productId} as uuid)) as ok
  `);
    return rows[0]?.ok ?? false;
};
