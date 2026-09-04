import { EVENTS, minorUnitsToDecimalString } from '@shop/shared';
import type { CartDto, ProductDto } from '@shop/shared';
import { publishToUser } from '../lib/sse.js';
import type { ConversationRecord } from './conversations.js';
export const toolError = (code: string, message: string): Record<string, unknown> => ({
    error: { code, message },
});
export const speakableProduct = (product: ProductDto): Record<string, unknown> => {
    const variant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
    const priceMinorUnits = variant?.priceMinorUnits ?? product.basePriceMinorUnits;
    return {
        product_id: product.id,
        title: product.title,
        brand: product.brand,
        category: product.categorySlug,
        rating: product.rating,
        rating_count: product.ratingCount,
        priceMinorUnits,
        priceInr: minorUnitsToDecimalString(priceMinorUnits),
        in_stock: (variant?.stock ?? 0) > 0,
        variant_id: variant?.id ?? null,
        highlights: product.highlights.slice(0, 4),
        specs: product.specs,
    };
};
export const speakableCart = (cart: CartDto): Record<string, unknown> => ({
    items: cart.items.map((line) => ({
        product_id: line.productId,
        title: line.productTitle,
        variant: line.variantLabel,
        quantity: line.quantity,
        live_eligible: line.liveEligible,
        priceInr: minorUnitsToDecimalString(line.pricing.unitPriceMinorUnits),
        grossInr: minorUnitsToDecimalString(line.pricing.grossMinorUnits),
        discountInr: minorUnitsToDecimalString(line.pricing.discountMinorUnits),
        netInr: minorUnitsToDecimalString(line.pricing.netMinorUnits),
        applied: line.applied.map((a) => ({
            code: a.code,
            label: a.label,
            savesInr: minorUnitsToDecimalString(a.minorUnits),
        })),
        suppressed: line.suppressed,
    })),
    totals: {
        subtotalMinorUnits: cart.totals.subtotalMinorUnits,
        subtotalInr: minorUnitsToDecimalString(cart.totals.subtotalMinorUnits),
        discountMinorUnits: cart.totals.discountMinorUnits,
        discountInr: minorUnitsToDecimalString(cart.totals.discountMinorUnits),
        totalMinorUnits: cart.totals.totalMinorUnits,
        totalInr: minorUnitsToDecimalString(cart.totals.totalMinorUnits),
    },
    notices: cart.notices,
});
export type AiToolExecutedEvent = {
    tool: 'add_to_cart' | 'add_to_wishlist';
    productId: string;
    productTitle: string;
    quantity: number;
    netMinorUnits: number;
    discountMinorUnits: number;
    appliedCodes: string[];
};
export const publishToolExecuted = (conversation: ConversationRecord, event: AiToolExecutedEvent): Promise<void> => publishToUser(conversation.userId, EVENTS.aiToolExecuted, {
    conversationId: conversation.id,
    ...event,
});
