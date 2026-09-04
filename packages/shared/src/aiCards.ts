import type { ProductDto } from './types.js';

export type AiProductCard = {
    productId: string;
    slug: string;
    title: string;
    brand: string;
    imageUrl: string | null;
    variantId: string | null;
    priceMinorUnits: number;
    mrpMinorUnits: number | null;
    rating: number;
    ratingCount: number;
    inStock: boolean;
};
export const toAiProductCard = (product: ProductDto): AiProductCard => {
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
export const MAX_AI_PRODUCT_CARDS = 6;
