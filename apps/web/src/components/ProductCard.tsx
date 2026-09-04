import type { ProductDto, VariantDto } from '@shop/shared';
import type { ReactNode } from 'react';

import { Link } from 'react-router-dom';

import { buildPriceLadder } from '@shop/shared';

import { PriceTag } from './PriceTag';
import { Rating } from './Rating';

export const defaultVariant = (product: ProductDto): VariantDto | undefined =>
    product.variants.find((v) => v.isDefault) ?? product.variants[0];
export const CardImage = ({
    product,
    className = '',
}: {
    product: ProductDto;
    className?: string;
}): JSX.Element => {
    const src = product.images[0];
    return src === undefined ? (
        <div
            className={`flex items-center justify-center bg-surface text-t3 ${className}`}
            aria-hidden="true"
        >
            <span className="text-23 font-semibold tracking-tight">
                {product.brand.slice(0, 2)}
            </span>
        </div>
    ) : (
        <img
            src={src}
            alt={product.title}
            loading="lazy"
            className={`bg-[#fff] object-contain transition duration-panel ease-out group-hover:scale-[1.04] ${className}`}
        />
    );
};
export const ProductCard = ({
    product,
    badge,
    compare,
    footer,
}: {
    product: ProductDto;
    badge?: ReactNode;
    compare?: {
        selected: boolean;
        onToggle: (productId: string) => void;
        disabled: boolean;
    };
    footer?: ReactNode;
}): JSX.Element => {
    const variant = defaultVariant(product);
    const ladder = buildPriceLadder({
        mrpMinorUnits: variant?.mrpMinorUnits ?? product.mrpMinorUnits,
        shopMinorUnits: variant?.priceMinorUnits ?? product.basePriceMinorUnits,
    });
    const soldOut = (variant?.stock ?? 0) === 0;
    return (
        <article className="group flex h-full flex-col overflow-hidden rounded-panel bg-white transition duration-ctl hover:-translate-y-0.5 hover:shadow-e1">
            <Link
                to={`/p/${product.slug}`}
                className="relative m-2 block overflow-hidden rounded-panel bg-surface"
            >
                <CardImage
                    product={product}
                    className={`aspect-square w-full p-2 ${soldOut ? 'opacity-40' : ''}`}
                />
                {badge !== undefined && <div className="absolute left-2 top-2">{badge}</div>}
                {soldOut && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="pill border border-line bg-elev text-t1">
                            Out of stock
                        </span>
                    </div>
                )}
            </Link>

            <div className="flex flex-1 flex-col gap-1.5 p-3">
                <div className="eyebrow">{product.brand}</div>
                <Link
                    to={`/p/${product.slug}`}
                    className="line-clamp-2 text-14 font-medium text-t1 hover:underline"
                >
                    {product.title}
                </Link>
                <Rating
                    value={product.rating}
                    count={product.ratingCount}
                    size={12}
                />
                <div className="mt-auto pt-1">
                    <PriceTag
                        ladder={ladder}
                        size="sm"
                    />
                </div>

                {compare !== undefined && (
                    <button
                        type="button"
                        onClick={() => compare.onToggle(product.id)}
                        disabled={compare.disabled && !compare.selected}
                        className={`${compare.selected ? 'chip-active' : 'chip'} mt-1 w-full justify-center disabled:opacity-40`}
                        aria-pressed={compare.selected}
                    >
                        {compare.selected ? 'In comparison' : 'Compare'}
                    </button>
                )}
                {footer}
            </div>
        </article>
    );
};
