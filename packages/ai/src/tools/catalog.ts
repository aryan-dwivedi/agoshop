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
import { MAX_AI_PRODUCT_CARDS, minorUnitsToDecimalString } from '@shop/shared';

import { speakableProduct, toolError } from '../speakable.js';

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
            const [comparison, products] = await Promise.all([
                compareProducts(call.args.product_ids),
                getProductsByIds(call.args.product_ids),
            ]);
            surfaced.add(products);
            return {
                attributes: comparison.attributes,
                rows: comparison.rows.map((row) => ({
                    ...row,
                    priceInr: minorUnitsToDecimalString(row.priceMinorUnits),
                })),
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
