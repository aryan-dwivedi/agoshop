import type { SessionProductDto } from '@shop/shared';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { useCart } from '../../hooks/useCart';
import { ApiError, api, idempotencyKey } from '../../lib/api';
import { PriceTag } from '../PriceTag';

const ADD_ERROR: Record<string, string> = {
    invalid_live_session_product: 'That product is not part of this show.',
    out_of_stock: 'Out of stock.',
    rate_limited: 'Too many requests — try again in a moment.',
};
export const SessionProductRail = ({
    sessionId,
    products,
    pinnedProductId,
    live,
    canPin = false,
    signedIn,
    variant = 'rail',
    seamless = false,
}: {
    sessionId: string;
    products: SessionProductDto[];
    pinnedProductId: string | null;
    live: boolean;
    canPin?: boolean;
    signedIn: boolean;
    variant?: 'rail' | 'column' | 'responsive';
    seamless?: boolean;
}): JSX.Element => {
    const queryClient = useQueryClient();
    const [busyId, setBusyId] = useState<string | null>(null);
    const [errorById, setErrorById] = useState<Record<string, string>>({});
    const [addedId, setAddedId] = useState<string | null>(null);
    const cart = useCart(signedIn);
    const ordered = [...products].sort((a, b) => {
        const aPinned = a.productId === pinnedProductId ? 0 : 1;
        const bPinned = b.productId === pinnedProductId ? 0 : 1;
        return aPinned - bPinned || a.sortOrder - b.sortOrder;
    });
    const addToCart = useCallback(
        (product: SessionProductDto) => {
            setBusyId(product.productId);
            setErrorById((current) => ({ ...current, [product.productId]: '' }));
            void api
                .post(
                    '/api/cart/items',
                    {
                        productId: product.productId,
                        quantity: 1,
                        ...(live ? { liveSessionId: sessionId } : {}),
                    },
                    { 'Idempotency-Key': idempotencyKey() },
                )
                .then(async () => {
                    setAddedId(product.productId);
                    await queryClient.invalidateQueries({ queryKey: ['cart'] });
                })
                .catch((err: unknown) => {
                    const code = err instanceof ApiError ? err.code : 'request_failed';
                    setErrorById((current) => ({
                        ...current,
                        [product.productId]: ADD_ERROR[code] ?? 'Could not add to cart.',
                    }));
                })
                .finally(() => setBusyId(null));
        },
        [live, sessionId, queryClient],
    );
    const setPinned = useCallback(
        (productId: string, pinned: boolean) => {
            setBusyId(productId);
            void api
                .post(`/api/sessions/${sessionId}/pin`, {
                    productId: pinned ? null : productId,
                })
                .catch(() =>
                    setErrorById((current) => ({
                        ...current,
                        [productId]: pinned ? 'Could not unpin.' : 'Could not pin.',
                    })),
                )
                .finally(() => setBusyId(null));
        },
        [sessionId],
    );
    return (
        <section className={seamless ? '' : 'card overflow-hidden'}>
            <div
                className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 ${seamless ? 'pb-2' : 'border-b border-line px-4 py-3'}`}
            >
                <h2 className="text-14 font-semibold text-t1">
                    {live ? 'Shop this show' : 'In this show'}
                </h2>
                <p className="tnum text-13 text-t3">
                    {ordered.length} product{ordered.length === 1 ? '' : 's'}
                </p>
            </div>

            <ul
                className={`${
                    variant === 'rail'
                        ? 'scroll-thin flex snap-x snap-mandatory gap-3 overflow-x-auto'
                        : variant === 'responsive'
                          ? 'scroll-thin flex snap-x snap-mandatory gap-3 overflow-x-auto lg:grid lg:snap-none lg:overflow-x-visible'
                          : 'grid gap-3'
                } ${seamless ? 'py-1' : 'p-4'}`}
            >
                {ordered.map((product) => {
                    const pinned = product.productId === pinnedProductId;
                    const line = cart.data?.items.find((i) => i.productId === product.productId);
                    const applied = addedId === product.productId ? (line?.applied ?? []) : [];
                    const error = errorById[product.productId];
                    const stock = product.stock ?? null;
                    const soldOut = stock !== null && stock <= 0;
                    return (
                        <li
                            key={product.productId}
                            className={`card-hover flex flex-col overflow-hidden ${
                                variant === 'rail'
                                    ? 'w-56 shrink-0 snap-start'
                                    : variant === 'responsive'
                                      ? 'w-56 shrink-0 snap-start lg:w-full lg:shrink'
                                      : 'w-full'
                            } ${pinned ? 'border-accent' : ''}`}
                        >
                            <Link
                                to={`/p/${product.slug}`}
                                className="group relative block overflow-hidden"
                            >
                                {product.imageUrl === null ? (
                                    <div className="aspect-[4/3] w-full bg-surface" />
                                ) : (
                                    <img
                                        src={product.imageUrl}
                                        alt={product.title}
                                        className="aspect-[4/3] w-full bg-[#fff] object-cover transition duration-panel ease-out group-hover:scale-[1.03]"
                                        loading="lazy"
                                    />
                                )}
                                {pinned && (
                                    <span className="badge-accent absolute left-2 top-2">
                                        Featured now
                                    </span>
                                )}
                                {soldOut && (
                                    <span className="badge-neutral absolute bottom-2 left-2">
                                        Out of stock
                                    </span>
                                )}
                            </Link>

                            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                                <Link
                                    to={`/p/${product.slug}`}
                                    className="line-clamp-2 text-14 font-medium text-t1 hover:underline"
                                >
                                    {product.title}
                                </Link>

                                <PriceTag
                                    ladder={product.price}
                                    size="sm"
                                    onDark
                                    className="tnum"
                                />

                                <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                                    <button
                                        type="button"
                                        className="btn-commit btn-sm flex-1"
                                        disabled={
                                            !signedIn || soldOut || busyId === product.productId
                                        }
                                        onClick={() => addToCart(product)}
                                    >
                                        {soldOut
                                            ? 'Out of stock'
                                            : busyId === product.productId
                                              ? 'Adding…'
                                              : 'Add to cart'}
                                    </button>
                                    {canPin && (
                                        <button
                                            type="button"
                                            className={
                                                pinned ? 'btn-quiet btn-sm' : 'btn-standard btn-sm'
                                            }
                                            disabled={busyId === product.productId}
                                            onClick={() => setPinned(product.productId, pinned)}
                                        >
                                            {pinned ? 'Unpin' : 'Pin'}
                                        </button>
                                    )}
                                </div>

                                {canPin && stock !== null && (
                                    <p className="tnum text-13 text-t3">{stock} in stock</p>
                                )}
                                {!signedIn && (
                                    <p className="text-13 text-t3">Sign in to add to cart.</p>
                                )}
                                {applied.length > 0 && (
                                    <p className="tnum text-13 font-medium text-success">
                                        In cart at {formatInr(line?.pricing.netMinorUnits ?? 0)}
                                    </p>
                                )}
                                {addedId === product.productId &&
                                    applied.length === 0 &&
                                    error === undefined && (
                                        <p className="text-13 text-t2">Added to cart.</p>
                                    )}
                                {error !== undefined && error !== '' && (
                                    <p className="text-13 font-medium text-danger">{error}</p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>

            {ordered.length === 0 && (
                <p className={`text-14 text-t3 ${seamless ? '' : 'px-4 pb-4'}`}>
                    The seller has not added products to this show yet.
                </p>
            )}
        </section>
    );
};
