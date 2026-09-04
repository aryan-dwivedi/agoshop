import type { SessionProductDto } from '@shop/shared';

import { useCallback, useState } from 'react';

import { formatInr } from '@shop/shared';

import { api } from '../../lib/api';

export type PinControl = {
    pin: (productId: string | null) => void;
    pendingId: string | null;
    busy: boolean;
    error: string | null;
};
export const usePinProduct = (sessionId: string): PinControl => {
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const pin = useCallback(
        (productId: string | null): void => {
            setPendingId(productId);
            setBusy(true);
            setError(null);
            void api
                .post(`/api/sessions/${sessionId}/pin`, { productId })
                .catch(() =>
                    setError(
                        productId === null
                            ? 'Could not clear the pin.'
                            : 'Could not pin that product.',
                    ),
                )
                .finally(() => {
                    setPendingId(null);
                    setBusy(false);
                });
        },
        [sessionId],
    );
    return { pin, pendingId, busy, error };
};
const KEYED = 9;
export const LineupStrip = ({
    products,
    pinnedProductId,
    onPin,
    pendingId,
    busy,
    className = '',
}: {
    products: SessionProductDto[];
    pinnedProductId: string | null;
    onPin: (productId: string | null) => void;
    pendingId: string | null;
    busy: boolean;
    className?: string;
}): JSX.Element => {
    const ordered = [...products].sort((a, b) => a.sortOrder - b.sortOrder);
    return (
        <section
            className={className}
            aria-label="Line-up"
        >
            <div className="scroll-thin flex items-stretch gap-2 overflow-x-auto pb-1">
                {ordered.map((product, index) => {
                    const pinned = product.productId === pinnedProductId;
                    const stock = product.stock ?? null;
                    const soldOut = stock !== null && stock <= 0;
                    const key = index < KEYED ? String(index + 1) : null;
                    const waiting = pendingId === product.productId;
                    return (
                        <button
                            key={product.productId}
                            type="button"
                            disabled={busy}
                            aria-pressed={pinned}
                            {...(key === null ? {} : { 'aria-keyshortcuts': key })}
                            onClick={() => onPin(pinned ? null : product.productId)}
                            className={`flex w-[172px] shrink-0 flex-col gap-1 rounded-ctl border p-2 text-left transition duration-ctl ease-out disabled:cursor-not-allowed disabled:opacity-60 ${
                                soldOut
                                    ? 'border-danger bg-transparent'
                                    : pinned
                                      ? 'border-accent bg-accent text-accent-ink'
                                      : 'border-line bg-surface hover:border-line-ctl'
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                {key !== null && (
                                    <span
                                        className={`tnum inline-flex h-5 w-5 items-center justify-center rounded-chip border text-13 font-semibold ${
                                            pinned && !soldOut
                                                ? 'border-accent-ink text-accent-ink'
                                                : 'border-line-ctl text-t2'
                                        }`}
                                    >
                                        {key}
                                    </span>
                                )}
                                {pinned && (
                                    <span
                                        className={`text-11 font-semibold uppercase tracking-[0.08em] ${soldOut ? 'text-t2' : 'text-accent-ink'}`}
                                    >
                                        {waiting ? 'Pinning…' : 'Pinned'}
                                    </span>
                                )}
                                {soldOut && (
                                    <span className="text-11 font-semibold uppercase tracking-[0.08em] text-danger">
                                        Sold out
                                    </span>
                                )}
                            </span>

                            <span
                                className={`line-clamp-2 text-14 font-medium ${pinned && !soldOut ? 'text-accent-ink' : 'text-t1'}`}
                            >
                                {product.title}
                            </span>

                            <span className="mt-auto flex items-baseline gap-1.5">
                                <span
                                    className={`tnum text-14 font-semibold ${pinned && !soldOut ? 'text-accent-ink' : 'text-t1'}`}
                                >
                                    {formatInr(
                                        product.price.liveMinorUnits ??
                                            product.price.shopMinorUnits,
                                    )}
                                </span>
                                {stock !== null && !soldOut && (
                                    <span
                                        className={`tnum text-13 ${
                                            pinned && !soldOut
                                                ? 'text-accent-ink'
                                                : product.lowStock === true
                                                  ? 'text-accent'
                                                  : 'text-t2'
                                        }`}
                                    >
                                        {stock} in stock
                                    </span>
                                )}
                            </span>
                        </button>
                    );
                })}

                <button
                    type="button"
                    className="btn-standard btn-sm shrink-0 self-center"
                    disabled={busy || pinnedProductId === null}
                    aria-keyshortcuts="0"
                    onClick={() => onPin(null)}
                >
                    Unpin <span className="tnum text-t2">0</span>
                </button>
            </div>
        </section>
    );
};
