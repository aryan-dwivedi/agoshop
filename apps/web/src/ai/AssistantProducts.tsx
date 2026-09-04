import type { AiProductCard } from '@shop/shared';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { buildPriceLadder } from '@shop/shared';

import { PriceTag } from '../components/PriceTag';
import { useSheet } from '../components/RightSheet';
import { ApiError, api, idempotencyKey } from '../lib/api';

const ADD_ERROR: Record<string, string> = {
    out_of_stock: 'Out of stock',
    invalid_live_session_product: 'That price ended with the show',
    rate_limited: 'Too fast — try again in a moment',
};
const VISIBLE_ROWS = 3;
const ADDED_MS = 1200;
const AddState = {
    idle: 'idle',
    busy: 'busy',
    added: 'added',
} as const;
type AddStatus = (typeof AddState)[keyof typeof AddState];
export const AssistantProducts = ({
    products,
    liveSessionId,
}: {
    products: AiProductCard[];
    liveSessionId?: string | null;
}): JSX.Element => {
    const queryClient = useQueryClient();
    const openSheet = useSheet((state) => state.openSheet);
    const [status, setStatus] = useState<Record<string, AddStatus>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [showAll, setShowAll] = useState(false);
    const timers = useRef<number[]>([]);
    useEffect(
        () => () => {
            for (const timer of timers.current) window.clearTimeout(timer);
        },
        [],
    );
    const add = (card: AiProductCard): void => {
        setStatus((current) => ({ ...current, [card.productId]: AddState.busy }));
        setErrors((current) => ({ ...current, [card.productId]: '' }));
        void api
            .post(
                '/api/cart/items',
                {
                    productId: card.productId,
                    ...(card.variantId ? { variantId: card.variantId } : {}),
                    quantity: 1,
                    ...(liveSessionId ? { liveSessionId } : {}),
                },
                { 'Idempotency-Key': idempotencyKey() },
            )
            .then(async () => {
                setStatus((current) => ({
                    ...current,
                    [card.productId]: AddState.added,
                }));
                await queryClient.invalidateQueries({ queryKey: ['cart'] });
                openSheet('cart');
                timers.current.push(
                    window.setTimeout(() => {
                        setStatus((current) => ({
                            ...current,
                            [card.productId]: AddState.idle,
                        }));
                    }, ADDED_MS),
                );
            })
            .catch((err: unknown) => {
                const code = err instanceof ApiError ? err.code : 'request_failed';
                setStatus((current) => ({
                    ...current,
                    [card.productId]: AddState.idle,
                }));
                setErrors((current) => ({
                    ...current,
                    [card.productId]: ADD_ERROR[code] ?? 'Could not add',
                }));
            });
    };
    const visible = showAll ? products : products.slice(0, VISIBLE_ROWS);
    const hidden = products.length - visible.length;
    return (
        <div className="animate-fade-in mt-2 space-y-1.5">
            {visible.map((card) => {
                const ladder = buildPriceLadder({
                    mrpMinorUnits: card.mrpMinorUnits,
                    shopMinorUnits: card.priceMinorUnits,
                    liveMinorUnits: null,
                });
                const state = status[card.productId] ?? AddState.idle;
                const error = errors[card.productId];
                return (
                    <article
                        key={card.productId}
                        className="flex min-h-[72px] items-center gap-3 rounded-ctl border border-line bg-surface px-2"
                    >
                        <Link
                            to={`/p/${card.slug}`}
                            tabIndex={-1}
                            aria-hidden="true"
                            className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-chip bg-[#fff]"
                        >
                            {card.imageUrl === null ? (
                                <span className="text-11 text-t3">No image</span>
                            ) : (
                                <img
                                    src={card.imageUrl}
                                    alt=""
                                    loading="lazy"
                                    className="h-full w-full object-contain p-1"
                                />
                            )}
                        </Link>

                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <Link
                                to={`/p/${card.slug}`}
                                className="truncate text-14 font-medium text-t1 hover:underline"
                                title={card.title}
                            >
                                {card.title}
                            </Link>
                            <PriceTag
                                ladder={ladder}
                                size="sm"
                            />
                            {error && <p className="text-11 text-danger">{error}</p>}
                        </div>

                        {card.inStock ? (
                            <button
                                type="button"
                                className="btn-commit btn-sm shrink-0"
                                aria-label={`Add ${card.title} to cart`}
                                disabled={state !== AddState.idle}
                                onClick={() => add(card)}
                            >
                                {state === AddState.added
                                    ? 'Added ✓'
                                    : state === AddState.busy
                                      ? 'Adding…'
                                      : 'Add'}
                            </button>
                        ) : (
                            <span className="btn-standard btn-sm pointer-events-none shrink-0 opacity-60">
                                Out of stock
                            </span>
                        )}
                    </article>
                );
            })}

            {hidden > 0 && (
                <button
                    type="button"
                    className="btn-quiet btn-sm w-full"
                    onClick={() => setShowAll(true)}
                >
                    See {hidden} more
                </button>
            )}
        </div>
    );
};
