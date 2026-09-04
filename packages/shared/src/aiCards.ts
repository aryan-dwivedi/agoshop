import type { ProductDto } from './types.js';

/**
 * What the assistant SHOWS, beside what it says.
 *
 * A spoken or written answer names one product; the shopper still has to go and find
 * it. These cards are the same products the model's read-only catalog tools returned
 * during the turn, projected down to what a tile needs — so the panel can render a
 * tappable result instead of a paragraph, and the shopper can add to cart without
 * leaving the conversation.
 *
 * It is deliberately NOT a `ProductDto`: descriptions, specs and the full variant list
 * are model-facing detail, and this payload also travels over SSE on the voice path.
 */
export type AiProductCard = {
  productId: string;
  slug: string;
  title: string;
  brand: string;
  imageUrl: string | null;
  /** The default variant, which is the variant the PDP preselects and quotes. */
  variantId: string | null;
  priceMinorUnits: number;
  /** Tier 1 for that variant; `null` when the product is not marked down. */
  mrpMinorUnits: number | null;
  rating: number;
  ratingCount: number;
  inStock: boolean;
};

export const toAiProductCard = (product: ProductDto): AiProductCard => {
  // The variant a card quotes: the seller's default, else the cheapest listed first —
  // the same one the PDP preselects, so the price never moves on navigation.
  const variant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
  return {
    productId: product.id,
    slug: product.slug,
    title: product.title,
    brand: product.brand,
    imageUrl: product.images[0] ?? null,
    variantId: variant?.id ?? null,
    priceMinorUnits: variant?.priceMinorUnits ?? product.basePriceMinorUnits,
    mrpMinorUnits: variant?.mrpMinorUnits ?? product.mrpMinorUnits,
    rating: product.rating,
    ratingCount: product.ratingCount,
    inStock: (variant?.stock ?? 0) > 0,
  };
};

/** How many cards one turn may show; more than this is a listing page, not an answer. */
export const MAX_AI_PRODUCT_CARDS = 6;
