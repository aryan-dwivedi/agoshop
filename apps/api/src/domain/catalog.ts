import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import type { ComparisonDto, ProductDto, VariantDto } from '@shop/shared';
import { db } from '../db/client.js';
import { cacheKeys, cached, invalidate } from '../lib/cache.js';
export type ProductSort = 'relevance' | 'price_asc' | 'price_desc' | 'rating';
export type ProductQuery = {
    categoryId?: string;
    categorySlug?: string;
    q?: string;
    maxPriceMinorUnits?: number;
    minRating?: number;
    sellerId?: string;
    sort?: ProductSort;
    page?: number;
    pageSize?: number;
};
export type CategoryDto = {
    id: string;
    slug: string;
    name: string;
    imageUrl: string | null;
};
export type ProductFacets = {
    categories: {
        slug: string;
        name: string;
        count: number;
    }[];
    sellers: {
        id: string;
        name: string;
        count: number;
    }[];
    priceMinorUnits: {
        min: number;
        max: number;
    };
    ratingBuckets: {
        minRating: number;
        count: number;
    }[];
};
type ProductRow = {
    id: string;
    slug: string;
    title: string;
    brand: string;
    description: string;
    category_slug: string;
    seller_id: string;
    seller_name: string;
    highlights: string[] | null;
    specs: Record<string, string> | null;
    images: string[] | null;
    rating: number;
    rating_count: number;
    base_price_minor_units: number;
    variants: VariantDto[] | null;
};
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;
const JSON_TEXT = (column: SQL): SQL => sql `translate(${column}::text, '[]{}",:', '       ')`;
const FTS = sql `to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.description, '') || ' ' || ${JSON_TEXT(sql `p.highlights`)} || ' ' || ${JSON_TEXT(sql `p.specs`)})`;
type MatchMode = 'all' | 'any';
const tsQuery = (text: string, mode: MatchMode): SQL => mode === 'all'
    ? sql `plainto_tsquery('english', ${text})`
    : sql `replace(plainto_tsquery('english', ${text})::text, ' & ', ' | ')::tsquery`;
const FROM = sql `
  from products p
  join categories c on c.id = p.category_id
  join sellers s on s.id = p.seller_id
  left join lateral (
    select json_agg(json_build_object(
             'id', pv.id,
             'sku', pv.sku,
             'label', pv.label,
             'attrs', pv.attrs,
             'priceMinorUnits', pv.price_minor_units,
             'mrpMinorUnits', pv.mrp_minor_units,
             'stock', pv.stock,
             'isDefault', pv.is_default)
             order by pv.is_default desc, pv.price_minor_units asc) as variants,
           min(pv.price_minor_units) as min_price
    from product_variants pv
    where pv.product_id = p.id
  ) v on true`;
const PROJECTION = sql `
  select p.id, p.slug, p.title, p.brand, p.description,
         c.slug as category_slug,
         s.id as seller_id, s.display_name as seller_name,
         p.highlights, p.specs, p.images, p.rating, p.rating_count,
         p.base_price_minor_units,
         coalesce(v.variants, '[]'::json) as variants`;
const buildWhere = (q: ProductQuery, mode: MatchMode): SQL => {
    const clauses: SQL[] = [];
    if (q.categoryId)
        clauses.push(sql `p.category_id = cast(${q.categoryId} as uuid)`);
    if (q.categorySlug)
        clauses.push(sql `c.slug = ${q.categorySlug}`);
    if (q.sellerId)
        clauses.push(sql `p.seller_id = cast(${q.sellerId} as uuid)`);
    if (q.q) {
        const contains = `%${q.q}%`;
        clauses.push(sql `(
      ${FTS} @@ ${tsQuery(q.q, mode)}
      or c.name ilike ${contains}
      or c.slug ilike ${contains}
      or s.display_name ilike ${contains}
      or s.slug ilike ${contains}
      or exists (
        select 1
        from product_variants search_variant
        where search_variant.product_id = p.id
          and (
            search_variant.sku ilike ${contains}
            or search_variant.label ilike ${contains}
            or search_variant.attrs::text ilike ${contains}
          )
      )
    )`);
    }
    if (typeof q.maxPriceMinorUnits === 'number') {
        clauses.push(sql `coalesce(v.min_price, p.base_price_minor_units) <= ${q.maxPriceMinorUnits}`);
    }
    if (typeof q.minRating === 'number')
        clauses.push(sql `p.rating >= ${q.minRating}`);
    if (clauses.length === 0)
        return sql ``;
    return sql ` where ${sql.join(clauses, sql ` and `)}`;
};
const buildOrder = (q: ProductQuery, mode: MatchMode): SQL => {
    switch (q.sort) {
        case 'price_asc':
            return sql ` order by coalesce(v.min_price, p.base_price_minor_units) asc, p.title asc`;
        case 'price_desc':
            return sql ` order by coalesce(v.min_price, p.base_price_minor_units) desc, p.title asc`;
        case 'rating':
            return sql ` order by p.rating desc, p.rating_count desc, p.title asc`;
        default:
            return q.q
                ? sql ` order by ts_rank(${FTS}, ${tsQuery(q.q, mode)}) desc, p.rating desc, p.title asc`
                : sql ` order by p.rating desc, p.created_at desc, p.title asc`;
    }
};
const toDto = (r: ProductRow): ProductDto => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    brand: r.brand,
    description: r.description,
    categorySlug: r.category_slug,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    highlights: r.highlights ?? [],
    specs: r.specs ?? {},
    images: r.images ?? [],
    rating: r.rating,
    ratingCount: r.rating_count,
    basePriceMinorUnits: r.base_price_minor_units,
    mrpMinorUnits: r.variants?.[0]?.mrpMinorUnits ?? null,
    variants: r.variants ?? [],
});
const queryHash = (value: unknown): string => createHash('sha1').update(JSON.stringify(value)).digest('hex');
export const listCategories = async (): Promise<CategoryDto[]> => cached(cacheKeys.categoryList, 300, async () => {
    const { rows } = await db.execute<{
        id: string;
        slug: string;
        name: string;
        image_url: string | null;
    }>(sql `select id, slug, name, image_url from categories order by name asc`);
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, imageUrl: r.image_url }));
});
const resolveMatchMode = async (q: ProductQuery): Promise<MatchMode> => {
    if (!q.q)
        return 'all';
    const probe: ProductQuery = { ...q, page: undefined, pageSize: undefined, sort: undefined };
    return cached<MatchMode>(cacheKeys.productQuery(`match:${queryHash(probe)}`), 60, async () => {
        const { rows } = await db.execute(sql `select 1${FROM}${buildWhere(probe, 'all')} limit 1`);
        return rows.length > 0 ? 'all' : 'any';
    });
};
export const listProducts = async (q: ProductQuery): Promise<{
    items: ProductDto[];
    total: number;
}> => {
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(q.pageSize ?? DEFAULT_PAGE_SIZE)));
    const normalized: ProductQuery = { ...q, page, pageSize };
    const mode = await resolveMatchMode(normalized);
    return cached(cacheKeys.productQuery(queryHash({ ...normalized, mode })), 60, async () => {
        const where = buildWhere(normalized, mode);
        const [{ rows }, totals] = await Promise.all([
            db.execute<ProductRow>(sql `${PROJECTION}${FROM}${where}${buildOrder(normalized, mode)} limit ${pageSize} offset ${(page - 1) * pageSize}`),
            db.execute<{
                total: number;
            }>(sql `select count(*)::int as total${FROM}${where}`),
        ]);
        return { items: rows.map(toDto), total: totals.rows[0]?.total ?? 0 };
    });
};
export const productFacets = async (q: ProductQuery): Promise<ProductFacets> => {
    const forCategories: ProductQuery = { ...q, categoryId: undefined, categorySlug: undefined };
    const forSellers: ProductQuery = { ...q, sellerId: undefined };
    const mode = await resolveMatchMode(q);
    return cached(cacheKeys.productQuery(`facets:${queryHash({ ...q, mode })}`), 60, async () => {
        const [cats, sellers, price, ratings] = await Promise.all([
            db.execute<{
                slug: string;
                name: string;
                count: number;
            }>(sql `select c.slug, c.name, count(*)::int as count${FROM}${buildWhere(forCategories, mode)} group by c.slug, c.name order by c.name asc`),
            db.execute<{
                id: string;
                name: string;
                count: number;
            }>(sql `select s.id, s.display_name as name, count(*)::int as count${FROM}${buildWhere(forSellers, mode)} group by s.id, s.display_name order by s.display_name asc`),
            db.execute<{
                min: number | null;
                max: number | null;
            }>(sql `select min(coalesce(v.min_price, p.base_price_minor_units))::int as min,
                   max(coalesce(v.min_price, p.base_price_minor_units))::int as max${FROM}${buildWhere({ ...q, maxPriceMinorUnits: undefined }, mode)}`),
            db.execute<{
                min_rating: number;
                count: number;
            }>(sql `select b.min_rating, count(p.id)::int as count
            from (values (4.5), (4.0), (3.5)) as b(min_rating)
            left join (select p.id, p.rating${FROM}${buildWhere({ ...q, minRating: undefined }, mode)}) p
                   on p.rating >= b.min_rating
            group by b.min_rating
            order by b.min_rating desc`),
        ]);
        return {
            categories: cats.rows,
            sellers: sellers.rows,
            priceMinorUnits: { min: price.rows[0]?.min ?? 0, max: price.rows[0]?.max ?? 0 },
            ratingBuckets: ratings.rows.map((r) => ({ minRating: r.min_rating, count: r.count })),
        };
    });
};
const loadOne = async (column: 'id' | 'slug', value: string): Promise<ProductDto | null> => {
    const predicate = column === 'id' ? sql ` where p.id = cast(${value} as uuid)` : sql ` where p.slug = ${value}`;
    const { rows } = await db.execute<ProductRow>(sql `${PROJECTION}${FROM}${predicate} limit 1`);
    const row = rows[0];
    return row ? toDto(row) : null;
};
export const getProductById = async (id: string): Promise<ProductDto | null> => cached(cacheKeys.product(id), 300, () => loadOne('id', id));
export const getProductBySlug = async (slug: string): Promise<ProductDto | null> => cached(cacheKeys.product(slug), 300, () => loadOne('slug', slug));
export const getProductsByIds = async (ids: string[]): Promise<ProductDto[]> => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0)
        return [];
    const { rows } = await db.execute<ProductRow>(sql `${PROJECTION}${FROM} where p.id in (${sql.join(unique.map((id) => sql `cast(${id} as uuid)`), sql `, `)})`);
    const byId = new Map(rows.map((r) => [r.id, toDto(r)]));
    return unique.map((id) => byId.get(id)).filter((p): p is ProductDto => p !== undefined);
};
export const compareProducts = async (ids: string[]): Promise<ComparisonDto> => {
    const items = await getProductsByIds(ids);
    const attributes: string[] = [];
    for (const item of items) {
        for (const key of Object.keys(item.specs))
            if (!attributes.includes(key))
                attributes.push(key);
    }
    return {
        attributes,
        rows: items.map((item) => {
            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
            const values: Record<string, string> = {};
            for (const key of attributes)
                values[key] = item.specs[key] ?? '—';
            return {
                productId: item.id,
                title: item.title,
                priceMinorUnits: defaultVariant?.priceMinorUnits ?? item.basePriceMinorUnits,
                rating: item.rating,
                values,
            };
        }),
    };
};
export const recordProductView = async (productId: string, userId: string | null): Promise<void> => {
    await db.execute(sql `
    insert into product_views (user_id, product_id)
    values (cast(${userId} as uuid), cast(${productId} as uuid))
  `);
};
export const invalidateCatalogCache = async (): Promise<void> => {
    await Promise.all([invalidate('prod:v1:'), invalidate('prodq:v1:')]);
};
