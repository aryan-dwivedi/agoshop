import type { ComparisonDto, ProductDto, VariantDto } from '@shop/shared';
import type { SQL } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { cacheKeys, cached, invalidate } from '@shop/platform/lib/cache.js';

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
const JSON_TEXT = (column: SQL): SQL => sql`translate(${column}::text, '[]{}",:', '       ')`;
const FTS = sql`to_tsvector('english', coalesce(p.title, '') || ' ' || coalesce(p.brand, '') || ' ' || coalesce(p.description, '') || ' ' || ${JSON_TEXT(sql`p.highlights`)} || ' ' || ${JSON_TEXT(sql`p.specs`)})`;
type MatchMode = 'all' | 'any';
const tsQuery = (text: string, mode: MatchMode): SQL =>
    mode === 'all'
        ? sql`plainto_tsquery('english', ${text})`
        : sql`replace(plainto_tsquery('english', ${text})::text, ' & ', ' | ')::tsquery`;
const JOINS = sql`
  from products p
  join categories c on c.id = p.category_id
  join sellers s on s.id = p.seller_id`;
// Only the projection needs the variant documents. Counts, facets and the match-mode
// probe need nothing but `min_price`, and building a json_agg per row for a scan they
// throw away is the single most expensive thing this file used to do.
const PRICE_LATERAL = sql`
  left join lateral (
    select min(pv.price_minor_units) as min_price
    from product_variants pv
    where pv.product_id = p.id
  ) v on true`;
const FROM = sql`${JOINS}
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
const FROM_LEAN = sql`${JOINS}${PRICE_LATERAL}`;
const PROJECTION = sql`
  select p.id, p.slug, p.title, p.brand, p.description,
         c.slug as category_slug,
         s.id as seller_id, s.display_name as seller_name,
         p.highlights, p.specs, p.images, p.rating, p.rating_count,
         p.base_price_minor_units,
         coalesce(v.variants, '[]'::json) as variants`;
// Search matches products whose seller, category or variant text mentions the term, not
// just products whose own document does. Expressed inline that turned into an OR of
// unindexable `ilike '%x%'` predicates plus a correlated EXISTS, which forced Postgres to
// discard `products_search_idx` and recompute the tsvector for every row. Resolving those
// dimensions up front against their own (small, trigram-indexed) tables collapses them to
// id lists, so every branch of the OR is index-backed — and when nothing matches, the
// branches vanish and the predicate is a plain GIN lookup.
export type TextMatch = {
    categoryIds: string[];
    sellerIds: string[];
    productIds: string[];
};
const EMPTY_TEXT_MATCH: TextMatch = { categoryIds: [], sellerIds: [], productIds: [] };
const uuidArray = (ids: string[]): SQL => sql`cast(${`{${ids.join(',')}}`} as uuid[])`;
const resolveTextMatch = async (term: string | undefined): Promise<TextMatch> => {
    if (!term) return EMPTY_TEXT_MATCH;
    return cached(cacheKeys.productQuery(`text:${queryHash(term)}`), 300, async () => {
        const contains = `%${term}%`;
        const { rows } = await db.execute<{ kind: string; id: string }>(sql`
      select 'category' as kind, id::text as id from categories
       where name ilike ${contains} or slug ilike ${contains}
      union all
      select 'seller' as kind, id::text as id from sellers
       where display_name ilike ${contains} or slug ilike ${contains}
      union all
      select distinct 'product' as kind, product_id::text as id from product_variants
       where sku ilike ${contains} or label ilike ${contains} or attrs::text ilike ${contains}
    `);
        const match: TextMatch = { categoryIds: [], sellerIds: [], productIds: [] };
        for (const row of rows) {
            if (row.kind === 'category') match.categoryIds.push(row.id);
            else if (row.kind === 'seller') match.sellerIds.push(row.id);
            else match.productIds.push(row.id);
        }
        return match;
    });
};
const buildWhere = (q: ProductQuery, mode: MatchMode, match: TextMatch): SQL => {
    const clauses: SQL[] = [];
    if (q.categoryId) clauses.push(sql`p.category_id = cast(${q.categoryId} as uuid)`);
    if (q.categorySlug) clauses.push(sql`c.slug = ${q.categorySlug}`);
    if (q.sellerId) clauses.push(sql`p.seller_id = cast(${q.sellerId} as uuid)`);
    if (q.q) {
        const any: SQL[] = [sql`${FTS} @@ ${tsQuery(q.q, mode)}`];
        if (match.categoryIds.length > 0) {
            any.push(sql`p.category_id = any(${uuidArray(match.categoryIds)})`);
        }
        if (match.sellerIds.length > 0) {
            any.push(sql`p.seller_id = any(${uuidArray(match.sellerIds)})`);
        }
        if (match.productIds.length > 0) {
            any.push(sql`p.id = any(${uuidArray(match.productIds)})`);
        }
        clauses.push(sql`(${sql.join(any, sql` or `)})`);
    }
    if (typeof q.maxPriceMinorUnits === 'number') {
        clauses.push(
            sql`coalesce(v.min_price, p.base_price_minor_units) <= ${q.maxPriceMinorUnits}`,
        );
    }
    if (typeof q.minRating === 'number') clauses.push(sql`p.rating >= ${q.minRating}`);
    if (clauses.length === 0) return sql``;
    return sql` where ${sql.join(clauses, sql` and `)}`;
};
const buildOrder = (q: ProductQuery, mode: MatchMode): SQL => {
    switch (q.sort) {
        case 'price_asc':
            return sql` order by coalesce(v.min_price, p.base_price_minor_units) asc, p.title asc`;
        case 'price_desc':
            return sql` order by coalesce(v.min_price, p.base_price_minor_units) desc, p.title asc`;
        case 'rating':
            return sql` order by p.rating desc, p.rating_count desc, p.title asc`;
        default:
            return q.q
                ? sql` order by ts_rank(${FTS}, ${tsQuery(q.q, mode)}) desc, p.rating desc, p.title asc`
                : sql` order by p.rating desc, p.created_at desc, p.title asc`;
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
const queryHash = (value: unknown): string =>
    createHash('sha1').update(JSON.stringify(value)).digest('hex');
export const listCategories = async (): Promise<CategoryDto[]> =>
    cached(cacheKeys.categoryList, 300, async () => {
        const { rows } = await db.execute<{
            id: string;
            slug: string;
            name: string;
            image_url: string | null;
        }>(sql`select id, slug, name, image_url from categories order by name asc`);
        return rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            imageUrl: r.image_url,
        }));
    });
const resolveMatchMode = async (q: ProductQuery, match: TextMatch): Promise<MatchMode> => {
    if (!q.q) return 'all';
    const probe: ProductQuery = {
        ...q,
        page: undefined,
        pageSize: undefined,
        sort: undefined,
    };
    return cached<MatchMode>(cacheKeys.productQuery(`match:${queryHash(probe)}`), 60, async () => {
        const { rows } = await db.execute(
            sql`select 1${FROM_LEAN}${buildWhere(probe, 'all', match)} limit 1`,
        );
        return rows.length > 0 ? 'all' : 'any';
    });
};
const normalizePageQuery = (
    q: ProductQuery,
): {
    normalized: ProductQuery;
    page: number;
    pageSize: number;
} => {
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, Math.trunc(q.pageSize ?? DEFAULT_PAGE_SIZE)),
    );
    return { normalized: { ...q, page, pageSize }, page, pageSize };
};
const listProductsWithMode = async (
    q: ProductQuery,
    mode: MatchMode,
    match: TextMatch,
): Promise<{
    items: ProductDto[];
    total: number;
}> =>
    cached(cacheKeys.productQuery(queryHash({ ...q, mode })), 60, async () => {
        const page = q.page ?? 1;
        const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
        const [{ rows }, totals] = await Promise.all([
            db.execute<ProductRow>(
                sql`${PROJECTION}${FROM}${buildWhere(q, mode, match)}${buildOrder(q, mode)} limit ${pageSize} offset ${(page - 1) * pageSize}`,
            ),
            db.execute<{
                total: number;
            }>(sql`select count(*)::int as total${FROM_LEAN}${buildWhere(q, mode, match)}`),
        ]);
        return { items: rows.map(toDto), total: totals.rows[0]?.total ?? 0 };
    });
export const listProducts = async (
    q: ProductQuery,
): Promise<{
    items: ProductDto[];
    total: number;
}> => {
    const { normalized } = normalizePageQuery(q);
    const match = await resolveTextMatch(normalized.q);
    const mode = await resolveMatchMode(normalized, match);
    return listProductsWithMode(normalized, mode, match);
};
const EMPTY_FACETS: ProductFacets = {
    categories: [],
    sellers: [],
    priceMinorUnits: { min: 0, max: 0 },
    ratingBuckets: [],
};
// Each facet counts the result set with its own dimension released, so the four used to
// run as four independent scans of the same rows — and, alongside the list and count
// queries, put six concurrent statements against a pool of PG_POOL_MAX (5 in production),
// where the sixth waited out connectionTimeoutMillis and surfaced as a 500. One `base`
// CTE holding the shared (text-only) predicate is scanned once; each facet then applies
// the three dimensions it does not release as a cheap filter over that materialised set.
const facetFilters = (q: ProductQuery): Record<'category' | 'seller' | 'price' | 'rating', SQL> => {
    const category: SQL[] = [];
    if (q.categoryId) category.push(sql`category_id = cast(${q.categoryId} as uuid)`);
    if (q.categorySlug) category.push(sql`cat_slug = ${q.categorySlug}`);
    const all = (clauses: SQL[]): SQL =>
        clauses.length === 0 ? sql`true` : sql.join(clauses, sql` and `);
    return {
        category: all(category),
        seller: q.sellerId ? sql`seller_id = cast(${q.sellerId} as uuid)` : sql`true`,
        price:
            typeof q.maxPriceMinorUnits === 'number'
                ? sql`price <= ${q.maxPriceMinorUnits}`
                : sql`true`,
        rating: typeof q.minRating === 'number' ? sql`rating >= ${q.minRating}` : sql`true`,
    };
};
const productFacetsWithMode = async (
    q: ProductQuery,
    mode: MatchMode,
    match: TextMatch,
): Promise<ProductFacets> =>
    cached(cacheKeys.productQuery(`facets:${queryHash({ ...q, mode })}`), 60, async () => {
        const f = facetFilters(q);
        const textOnly: ProductQuery = {
            q: q.q,
            page: undefined,
            pageSize: undefined,
            sort: undefined,
        };
        const { rows } = await db.execute<{
            categories: ProductFacets['categories'];
            sellers: ProductFacets['sellers'];
            price: ProductFacets['priceMinorUnits'];
            ratings: ProductFacets['ratingBuckets'];
        }>(sql`
      with base as (
        select p.category_id, c.slug as cat_slug, c.name as cat_name,
               p.seller_id, s.display_name as sel_name, p.rating,
               coalesce(v.min_price, p.base_price_minor_units) as price
        ${FROM_LEAN}${buildWhere(textOnly, mode, match)}
      )
      select
        (select coalesce(json_agg(json_build_object('slug', slug, 'name', name, 'count', count)
                                  order by name asc), '[]'::json)
           from (select cat_slug as slug, cat_name as name, count(*)::int as count
                   from base where ${f.seller} and ${f.price} and ${f.rating}
                  group by cat_slug, cat_name) t) as categories,
        (select coalesce(json_agg(json_build_object('id', id, 'name', name, 'count', count)
                                  order by name asc), '[]'::json)
           from (select seller_id as id, sel_name as name, count(*)::int as count
                   from base where ${f.category} and ${f.price} and ${f.rating}
                  group by seller_id, sel_name) t) as sellers,
        (select json_build_object('min', coalesce(min(price), 0)::int,
                                  'max', coalesce(max(price), 0)::int)
           from base where ${f.category} and ${f.seller} and ${f.rating}) as price,
        (select coalesce(json_agg(json_build_object('minRating', min_rating, 'count', count)
                                  order by min_rating desc), '[]'::json)
           from (select b.min_rating, count(r.rating)::int as count
                   from (values (4.5::float8), (4.0::float8), (3.5::float8)) as b(min_rating)
                   left join (select rating from base
                               where ${f.category} and ${f.seller} and ${f.price}) r
                          on r.rating >= b.min_rating
                  group by b.min_rating) t) as ratings
    `);
        const row = rows[0];
        if (!row) return EMPTY_FACETS;
        return {
            categories: row.categories,
            sellers: row.sellers,
            priceMinorUnits: row.price,
            ratingBuckets: row.ratings,
        };
    });
export const productFacets = async (q: ProductQuery): Promise<ProductFacets> => {
    const match = await resolveTextMatch(q.q);
    return productFacetsWithMode(q, await resolveMatchMode(q, match), match);
};
export type ProductListPage = {
    items: ProductDto[];
    total: number;
    facets: ProductFacets;
    page: number;
    pageSize: number;
};
export const listProductsPage = async (
    q: ProductQuery,
    opts?: {
        includeFacets?: boolean;
        list?: () => Promise<{
            items: ProductDto[];
            total: number;
        }>;
    },
): Promise<ProductListPage> => {
    const { normalized, page, pageSize } = normalizePageQuery(q);
    const match = await resolveTextMatch(normalized.q);
    const mode = await resolveMatchMode(normalized, match);
    const [listPage, facets] = await Promise.all([
        opts?.list ? opts.list() : listProductsWithMode(normalized, mode, match),
        opts?.includeFacets === false
            ? Promise.resolve(EMPTY_FACETS)
            : productFacetsWithMode(normalized, mode, match),
    ]);
    return { ...listPage, facets, page, pageSize };
};
const loadOne = async (column: 'id' | 'slug', value: string): Promise<ProductDto | null> => {
    const predicate =
        column === 'id' ? sql` where p.id = cast(${value} as uuid)` : sql` where p.slug = ${value}`;
    const { rows } = await db.execute<ProductRow>(sql`${PROJECTION}${FROM}${predicate} limit 1`);
    const row = rows[0];
    return row ? toDto(row) : null;
};
export const getProductById = async (id: string): Promise<ProductDto | null> =>
    cached(cacheKeys.product(id), 300, () => loadOne('id', id));
export const getProductBySlug = async (slug: string): Promise<ProductDto | null> =>
    cached(cacheKeys.product(slug), 300, () => loadOne('slug', slug));
export const getProductsByIds = async (ids: string[]): Promise<ProductDto[]> => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const { rows } = await db.execute<ProductRow>(
        sql`${PROJECTION}${FROM} where p.id in (${sql.join(
            unique.map((id) => sql`cast(${id} as uuid)`),
            sql`, `,
        )})`,
    );
    const byId = new Map(rows.map((r) => [r.id, toDto(r)]));
    return unique.map((id) => byId.get(id)).filter((p): p is ProductDto => p !== undefined);
};
export const compareProducts = async (ids: string[]): Promise<ComparisonDto> => {
    const items = await getProductsByIds(ids);
    const attributes: string[] = [];
    for (const item of items) {
        for (const key of Object.keys(item.specs))
            if (!attributes.includes(key)) attributes.push(key);
    }
    return {
        attributes,
        rows: items.map((item) => {
            const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0];
            const values: Record<string, string> = {};
            for (const key of attributes) values[key] = item.specs[key] ?? '—';
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
export const recordProductView = async (
    productId: string,
    userId: string | null,
): Promise<void> => {
    await db.execute(sql`
    insert into product_views (user_id, product_id)
    values (cast(${userId} as uuid), cast(${productId} as uuid))
  `);
};
export const invalidateCatalogCache = async (): Promise<void> => {
    await Promise.all([invalidate('prod:v1:'), invalidate('prodq:v1:')]);
};
