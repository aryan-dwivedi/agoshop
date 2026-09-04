import { EVENTS, minorUnitsToDecimalString } from '@shop/shared';
import { getProductById } from '../../domain/catalog.js';
import { addItem, getCart } from '../../domain/cart.js';
import { availablePaymentMethods } from '../../domain/checkoutPolicy.js';
import { personalizedOffers, resolveLiveOffer } from '../../domain/promotions.js';
import { checkDelivery } from '../../domain/serviceability.js';
import { addToWishlist } from '../../domain/wishlist.js';
import { publishToUser } from '../../lib/sse.js';
import type { ConversationRecord } from '../conversations.js';
import { publishToolExecuted, speakableCart, toolError } from '../speakable.js';
import type { SurfacedProducts } from '../surfacedProducts.js';
import type { ToolInvocation } from './types.js';
type CommerceToolInvocation = Extract<ToolInvocation, {
    name: 'check_delivery' | 'get_payment_options' | 'get_live_offer' | 'get_personalized_offers' | 'get_cart' | 'add_to_cart' | 'add_to_wishlist';
}>;
export const runCommerceTool = async (conversation: ConversationRecord, call: CommerceToolInvocation, _surfaced: SurfacedProducts): Promise<Record<string, unknown>> => {
    const userId = conversation.userId;
    switch (call.name) {
        case 'check_delivery': {
            const result = await checkDelivery(call.args.pincode);
            return { pincode: call.args.pincode, ...result };
        }
        case 'get_payment_options': {
            let totalMinorUnits: number;
            if (call.args.product_id) {
                const product = await getProductById(call.args.product_id);
                if (!product)
                    return toolError('product_not_found', 'no such product');
                const variant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
                totalMinorUnits = variant?.priceMinorUnits ?? product.basePriceMinorUnits;
            }
            else {
                totalMinorUnits = (await getCart(userId)).totals.totalMinorUnits;
            }
            const options = await availablePaymentMethods({
                totalMinorUnits,
                pincode: call.args.pincode ?? null,
            });
            return {
                ...options,
                orderTotalMinorUnits: totalMinorUnits,
                orderTotalInr: minorUnitsToDecimalString(totalMinorUnits),
                minOrderInr: minorUnitsToDecimalString(options.minOrderMinorUnits),
            };
        }
        case 'get_live_offer': {
            const offer = await resolveLiveOffer({
                userId,
                liveSessionId: conversation.liveSessionId,
                productId: conversation.contextProductId,
                surface: conversation.surface,
            });
            return {
                ...offer,
                effectiveDiscountInr: minorUnitsToDecimalString(offer.effectiveDiscountMinorUnits),
            };
        }
        case 'get_personalized_offers': {
            const offers = await personalizedOffers({
                userId,
                productId: call.args.product_id ?? conversation.contextProductId,
            });
            return {
                applied: offers.applied.map((o) => ({
                    code: o.code,
                    label: o.label,
                    savesMinorUnits: o.minorUnits,
                    savesInr: minorUnitsToDecimalString(o.minorUnits),
                })),
                suppressed: offers.suppressed,
            };
        }
        case 'get_cart':
            return speakableCart(await getCart(userId));
        case 'add_to_cart': {
            const quantity = call.args.quantity ?? 1;
            const cart = await addItem(userId, {
                productId: call.args.product_id,
                ...(call.args.variant_id === undefined ? {} : { variantId: call.args.variant_id }),
                quantity,
                liveSessionId: conversation.liveSessionId,
                surface: conversation.surface,
            });
            const line = cart.items.find((item) => item.productId === call.args.product_id);
            await publishToolExecuted(conversation, {
                tool: 'add_to_cart',
                productId: call.args.product_id,
                productTitle: line?.productTitle ?? '',
                quantity,
                netMinorUnits: line?.pricing.netMinorUnits ?? 0,
                discountMinorUnits: line?.pricing.discountMinorUnits ?? 0,
                appliedCodes: line?.applied.map((p) => p.code) ?? [],
            });
            await publishToUser(conversation.userId, EVENTS.cartUpdated, { source: 'ai' });
            return {
                added: true,
                product_id: call.args.product_id,
                quantity,
                line: line
                    ? {
                        live_eligible: line.liveEligible,
                        netInr: minorUnitsToDecimalString(line.pricing.netMinorUnits),
                        discountInr: minorUnitsToDecimalString(line.pricing.discountMinorUnits),
                        applied: line.applied.map((p) => ({
                            code: p.code,
                            label: p.label,
                            savesInr: minorUnitsToDecimalString(p.minorUnits),
                        })),
                    }
                    : null,
                cart: speakableCart(cart),
            };
        }
        case 'add_to_wishlist': {
            const [result, product] = await Promise.all([
                addToWishlist(userId, call.args.product_id),
                getProductById(call.args.product_id),
            ]);
            await publishToolExecuted(conversation, {
                tool: 'add_to_wishlist',
                productId: call.args.product_id,
                productTitle: product?.title ?? '',
                quantity: 1,
                netMinorUnits: 0,
                discountMinorUnits: 0,
                appliedCodes: [],
            });
            return { ...result, product_id: call.args.product_id };
        }
    }
};
