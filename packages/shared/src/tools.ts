import { z } from 'zod';

const productIdSchema = z.string().uuid();
const variantIdSchema = z.string().uuid();
export const toolSchemas = {
    search_products: z.object({
        query: z.string().min(1).max(200),
        category: z.string().max(64).optional(),
        max_price_inr: z.number().positive().optional(),
        min_rating: z.number().min(0).max(5).optional(),
        limit: z.number().int().min(1).max(10).optional(),
    }),
    get_product_details: z.object({ product_id: productIdSchema }),
    compare_products: z.object({
        product_ids: z.array(productIdSchema).min(2).max(4),
    }),
    check_delivery: z.object({
        pincode: z.string().regex(/^\d{6}$/),
    }),
    get_payment_options: z.object({
        product_id: productIdSchema.optional(),
        pincode: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
    }),
    get_live_offer: z.object({}),
    get_personalized_offers: z.object({ product_id: productIdSchema.optional() }),
    recommend_products: z.object({
        based_on: z.enum(['recently_viewed', 'wishlist', 'similar']).optional(),
        product_id: productIdSchema.optional(),
        limit: z.number().int().min(1).max(10).optional(),
    }),
    get_cart: z.object({}),
    add_to_cart: z.object({
        product_id: productIdSchema,
        variant_id: variantIdSchema.optional(),
        quantity: z.number().int().min(1).max(10).optional(),
    }),
    add_to_wishlist: z.object({ product_id: productIdSchema }),
    get_conversation_context: z.object({}),
    list_my_orders: z.object({
        limit: z.number().int().min(1).max(10).optional(),
    }),
    get_order_status: z.object({ order_id: productIdSchema.optional() }),
    escalate_to_human: z.object({
        reason: z.string().min(1).max(500),
        order_id: productIdSchema.optional(),
        preference: z.enum(['voice', 'callback']).optional(),
        phone_e164: z.string().max(20).optional(),
    }),
} as const;
export type ToolName = keyof typeof toolSchemas;
export const MUTATING_TOOLS: Record<ToolName, boolean> = {
    search_products: false,
    get_product_details: false,
    compare_products: false,
    check_delivery: false,
    get_payment_options: false,
    get_live_offer: false,
    get_personalized_offers: false,
    recommend_products: false,
    get_cart: false,
    add_to_cart: true,
    add_to_wishlist: true,
    get_conversation_context: false,
    list_my_orders: false,
    get_order_status: false,
    escalate_to_human: true,
};
export type OpenAiToolSchema = {
    type: 'function';
    function: {
        name: ToolName;
        description: string;
        parameters: Record<string, unknown>;
    };
};
const str = { type: 'string' } as const;
const productId = {
    type: 'string',
    format: 'uuid',
    description:
        'Opaque product_id copied exactly from a catalog tool result. Never invent or derive it from a title.',
} as const;
const variantId = {
    type: 'string',
    format: 'uuid',
    description:
        'Opaque variant_id copied exactly from a catalog tool result. Omit it to select the default variant.',
} as const;
const num = { type: 'number' } as const;
const int = { type: 'integer' } as const;
export const SHOPPING_TOOLS: OpenAiToolSchema[] = [
    {
        type: 'function',
        function: {
            name: 'search_products',
            description:
                'Search the store catalog, optionally filtered by category, maximum price in rupees, or minimum rating. Matching covers title, brand, description, highlights and specifications, so `query` works best as a short keyword phrase — a product noun, brand or feature word ("earbuds", "battery life") rather than the shopper\'s whole sentence. Use this before answering any "what do you have" question.',
            parameters: {
                type: 'object',
                properties: {
                    query: str,
                    category: str,
                    max_price_inr: num,
                    min_rating: num,
                    limit: int,
                },
                required: ['query'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_product_details',
            description:
                'Full specifications, highlights, variants, stock and price for one product. Use only a product_id returned by a catalog tool; search first if no canonical product_id is available.',
            parameters: {
                type: 'object',
                properties: { product_id: productId },
                required: ['product_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'compare_products',
            description:
                'Compare two to four catalog products attribute by attribute, including price, rating and specifications.',
            parameters: {
                type: 'object',
                properties: {
                    product_ids: {
                        type: 'array',
                        items: productId,
                        minItems: 2,
                        maxItems: 4,
                    },
                },
                required: ['product_ids'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'check_delivery',
            description:
                'Check pincode serviceability only when the shopper explicitly asks about delivery or during checkout. Never request a PIN or call this as a prerequisite for add_to_cart.',
            parameters: {
                type: 'object',
                properties: { pincode: str },
                required: ['pincode'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_payment_options',
            description:
                'Get payment methods only for an explicit payment or checkout question. Never request a PIN or call this as a prerequisite for add_to_cart.',
            parameters: {
                type: 'object',
                properties: { product_id: productId, pincode: str },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_live_offer',
            description:
                'The live-session offer that applies right now for this conversation: whether it is active, its kind and value, the effective saving, and which products qualify. Always call this before stating a discount.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_personalized_offers',
            description:
                'Offers this shopper is personally eligible for, and the reason any offer is suppressed (for example a non-stackable rule).',
            parameters: { type: 'object', properties: { product_id: productId } },
        },
    },
    {
        type: 'function',
        function: {
            name: 'recommend_products',
            description:
                'Recommend catalog products, optionally similar to a given product or based on the shopper’s wishlist or recently viewed items.',
            parameters: {
                type: 'object',
                properties: {
                    based_on: {
                        type: 'string',
                        enum: ['recently_viewed', 'wishlist', 'similar'],
                    },
                    product_id: productId,
                    limit: int,
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_cart',
            description:
                'The shopper’s current cart with per-line pricing, applied and suppressed offers, and totals.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_to_cart',
            description:
                'Add the identified product variant to the shopper’s cart immediately. Never request a PIN, check delivery, or check payment first; those belong to checkout. A buy/add request followed by a product or variant choice is already confirmed. Use only product_id and variant_id values returned by a catalog tool. Omit variant_id for the default variant. Returns recomputed totals including any live-session discount.',
            parameters: {
                type: 'object',
                properties: {
                    product_id: productId,
                    variant_id: variantId,
                    quantity: int,
                },
                required: ['product_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'add_to_wishlist',
            description:
                'Save a product to the shopper’s wishlist using a product_id returned by a catalog tool.',
            parameters: {
                type: 'object',
                properties: { product_id: productId },
                required: ['product_id'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_conversation_context',
            description:
                'Live commerce context for this conversation: session status, product in context, live offers, promotion rules and room state. Call at the start of a session or when the shopper asks about discounts or what is on screen.',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'list_my_orders',
            description:
                'Recent paid orders for this shopper with fulfilment status and tracking when available. Use for "my orders" or before looking up a specific order.',
            parameters: {
                type: 'object',
                properties: { limit: int },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'get_order_status',
            description:
                'Fulfilment status, carrier, tracking number and estimated delivery. Omit order_id to return the most recent paid order — use this for "where is my order?"',
            parameters: {
                type: 'object',
                properties: { order_id: productId },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'escalate_to_human',
            description:
                'Connect the shopper to a human support agent when you cannot resolve their issue (delivery disputes, refunds, missing packages). Stops the AI voice agent and queues a support ticket.',
            parameters: {
                type: 'object',
                properties: {
                    reason: str,
                    order_id: productId,
                    preference: { type: 'string', enum: ['voice', 'callback'] },
                    phone_e164: str,
                },
                required: ['reason'],
            },
        },
    },
];
export type ToolResult =
    | Record<string, unknown>
    | {
          error: {
              code: string;
              message: string;
          };
      };
