import type { ConversationRecord } from '../conversations.js';
import type { SurfacedProducts } from '../surfacedProducts.js';
import type { ToolInvocation } from './types.js';

import {
    compareProducts,
    getProductById,
    getProductsByIds,
    listProducts,
} from '@shop/domain-commerce/catalog.js';
import { recommend } from '@shop/domain-commerce/recommendations.js';
import { MAX_AI_PRODUCT_CARDS, minorUnitsToDecimalString, type ProductDto } from '@shop/shared';

import { speakableProduct, toolError } from '../speakable.js';

const scoreProductMatch = (query: string, item: ProductDto): number => {
    const normalized = query.trim().toLowerCase();
    const title = item.title.toLowerCase();
    if (title === normalized) return 1000;
    if (title.includes(normalized) || normalized.includes(title)) return 500;
    const queryTokens = normalized.split(/\s+/u).filter((token) => token.length > 0);
    if (queryTokens.length === 0) return 0;
    let matched = 0;
    for (const token of queryTokens) {
        if (title.includes(token)) matched += 1;
    }
    return matched;
};
const pickBestProductMatch = (query: string, items: ProductDto[]): ProductDto | null => {
    if (items.length === 0) return null;
    let best: ProductDto | null = null;
    let bestScore = -1;
    for (const item of items) {
        const score = scoreProductMatch(query, item);
        if (score > bestScore) {
            bestScore = score;
            best = item;
        }
    }
    return bestScore > 0 ? best : null;
};
const resolveCompareProductIds = async (
    productIds: string[] | undefined,
    queries: string[] | undefined,
): Promise<{ ids: string[] } | { error: Record<string, unknown> }> => {
    if (productIds && productIds.length >= 2) {
        return { ids: [...new Set(productIds)].slice(0, 4) };
    }
    if (!queries || queries.length < 2) {
        return {
            error: toolError(
                'invalid_compare',
                'provide product_ids or queries with 2–4 items',
            ),
        };
    }
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const query of queries) {
        const found = await listProducts({
            q: query,
            sort: 'relevance',
            page: 1,
            pageSize: 5,
        });
        const match = pickBestProductMatch(query, found.items);
        if (!match) {
            unresolved.push(query);
            continue;
        }
        if (!resolved.includes(match.id)) resolved.push(match.id);
    }
    if (unresolved.length > 0) {
        return {
            error: toolError(
                'products_not_found',
                `could not find: ${unresolved.join(', ')}`,
            ),
        };
    }
    if (resolved.length < 2) {
        return {
            error: toolError(
                'not_enough_products',
                'need at least two distinct products to compare',
            ),
        };
    }
    return { ids: resolved.slice(0, 4) };
};

type CatalogToolInvocation = Extract<
    ToolInvocation,
    {
        name: 'search_products' | 'get_product_details' | 'compare_products' | 'recommend_products';
    }
>;
const audienceFromQuery = (query: string): 'men' | 'women' | 'unisex' | undefined => {
    if (/\bunisex\b/iu.test(query)) return 'unisex';
    if (/\b(?:women|womens|woman|ladies|female)(?:'s)?\b/iu.test(query)) return 'women';
    if (/\b(?:men|mens|man|male)(?:'s)?\b/iu.test(query)) return 'men';
    return undefined;
};
export const runCatalogTool = async (
    conversation: ConversationRecord,
    call: CatalogToolInvocation,
    surfaced: SurfacedProducts,
): Promise<Record<string, unknown>> => {
    const userId = conversation.userId;
    switch (call.name) {
        case 'search_products': {
            const { query, audience, category, max_price_inr, min_rating, limit } = call.args;
            const found = await listProducts({
                audience: audience === 'any' ? audienceFromQuery(query) : audience,
                q: query,
                ...(category === undefined ? {} : { categorySlug: category }),
                ...(max_price_inr === undefined
                    ? {}
                    : { maxPriceMinorUnits: Math.round(max_price_inr * 100) }),
                ...(min_rating === undefined ? {} : { minRating: min_rating }),
                sort: 'relevance',
                page: 1,
                pageSize: Math.min(limit ?? MAX_AI_PRODUCT_CARDS, MAX_AI_PRODUCT_CARDS),
            });
            if (found.items.length === 0) surfaced.markSearchEmpty();
            else surfaced.add(found.items);
            return {
                total_matches: found.total,
                displayed_count: found.items.length,
                no_matches: found.items.length === 0,
                results: found.items.map(speakableProduct),
                display_note:
                    found.items.length === 0
                        ? 'Nothing matched. Tell the shopper plainly that nothing is available. Do not suggest unrelated products.'
                        : 'These exact results are visible to the shopper. Describe only these products and do not imply that another audience is included.',
            };
        }
        case 'get_product_details': {
            const product = await getProductById(call.args.product_id);
            if (!product) return toolError('product_not_found', 'no such product');
            surfaced.add([product]);
            return {
                ...speakableProduct(product),
                description: product.description,
                variants: product.variants.map((v) => ({
                    variant_id: v.id,
                    label: v.label,
                    priceInr: minorUnitsToDecimalString(v.priceMinorUnits),
                    priceMinorUnits: v.priceMinorUnits,
                    in_stock: v.stock > 0,
                    attrs: v.attrs,
                })),
            };
        }
        case 'compare_products': {
            const resolved = await resolveCompareProductIds(
                call.args.product_ids,
                call.args.queries,
            );
            if ('error' in resolved) return resolved.error;
            const [comparison, products] = await Promise.all([
                compareProducts(resolved.ids),
                getProductsByIds(resolved.ids),
            ]);
            surfaced.add(products);
            return {
                attributes: comparison.attributes,
                rows: comparison.rows.map((row) => ({
                    ...row,
                    priceInr: minorUnitsToDecimalString(row.priceMinorUnits),
                })),
                display_note:
                    'These products are shown in a comparison table. Summarise the key differences in price, rating and one or two specs — do not read every attribute aloud.',
            };
        }
        case 'recommend_products': {
            const productId = call.args.product_id ?? conversation.contextProductId;
            const products = await recommend({
                userId,
                ...(call.args.based_on === undefined ? {} : { basedOn: call.args.based_on }),
                ...(productId ? { productId } : {}),
                limit: call.args.limit ?? 4,
            });
            surfaced.add(products);
            return { results: products.map(speakableProduct) };
        }
    }
};
