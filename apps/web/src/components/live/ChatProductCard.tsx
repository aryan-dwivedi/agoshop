import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SessionProductDto } from '@shop/shared';
import { api, ApiError, idempotencyKey } from '../../lib/api';
import { PriceTag } from '../PriceTag';
const ADD_ERROR: Record<string, string> = {
    invalid_live_session_product: 'The live price has ended.',
    out_of_stock: 'Out of stock.',
    rate_limited: 'Try again in a moment.',
};
export const ChatProductCard = ({ product, sessionId, live, signedIn, addable, }: {
    product: SessionProductDto;
    sessionId: string;
    live: boolean;
    signedIn: boolean;
    addable: boolean;
}): JSX.Element => {
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<'idle' | 'adding' | 'added'>('idle');
    const [error, setError] = useState<string | null>(null);
    const soldOut = product.stock <= 0;
    const addToCart = (): void => {
        setStatus('adding');
        setError(null);
        void api
            .post('/api/cart/items', {
            productId: product.productId,
            quantity: 1,
            ...(live ? { liveSessionId: sessionId } : {}),
        }, { 'Idempotency-Key': idempotencyKey() })
            .then(async () => {
            setStatus('added');
            await queryClient.invalidateQueries({ queryKey: ['cart'] });
        })
            .catch((cause: unknown) => {
            const code = cause instanceof ApiError ? cause.code : 'request_failed';
            setStatus('idle');
            setError(ADD_ERROR[code] ?? 'Could not add to cart.');
        });
    };
    return (<div className="mt-2 flex overflow-hidden rounded-ctl border border-line bg-elev text-left not-italic">
      <Link to={`/p/${product.slug}`} className="h-20 w-20 shrink-0 bg-white">
        {product.imageUrl === null ? (<span className="block h-full w-full bg-surface"/>) : (<img src={product.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy"/>)}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-2.5 py-2">
        <Link to={`/p/${product.slug}`} className="line-clamp-2 text-13 font-semibold text-t1 hover:underline">
          {product.title}
        </Link>
        <PriceTag ladder={product.price} size="sm" className="tnum"/>
        {addable && (<button type="button" className="btn-commit btn-xs mt-0.5 self-start" disabled={!signedIn || soldOut || status !== 'idle'} onClick={addToCart}>
            {soldOut
                ? 'Out of stock'
                : !signedIn
                    ? 'Sign in to add'
                    : status === 'adding'
                        ? 'Adding…'
                        : status === 'added'
                            ? 'Added'
                            : 'Add to cart'}
          </button>)}
        {error !== null && <p className="text-11 font-medium text-danger">{error}</p>}
      </div>
    </div>);
};
