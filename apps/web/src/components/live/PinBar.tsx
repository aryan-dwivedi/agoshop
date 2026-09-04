import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatInr, type OrderDto, type SessionProductDto } from '@shop/shared';
import { api, ApiError, idempotencyKey } from '../../lib/api';
import { useCart } from '../../hooks/useCart';
import { PriceTag } from '../PriceTag';
const ADD_ERROR: Record<string, string> = {
    invalid_live_session_product: 'That product is not part of this show.',
    out_of_stock: 'Out of stock.',
    rate_limited: 'Too many taps — try again in a moment.',
};
const ADDED_MS = 1200;
const OPENED_SLACK_MS = 120000;
export const PinBar = ({ sessionId, products, pinnedProductId, live, signedIn, onViewProducts, orientation = 'row', className, }: {
    sessionId: string;
    products: SessionProductDto[];
    pinnedProductId: string | null;
    live: boolean;
    signedIn: boolean;
    onViewProducts?: () => void;
    orientation?: 'row' | 'column';
    className?: string;
}): JSX.Element | null => {
    const queryClient = useQueryClient();
    const [busy, setBusy] = useState(false);
    const [added, setAdded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [wiped, setWiped] = useState(false);
    const openedAtRef = useRef(Date.now());
    const pinned = products.find((p) => p.productId === pinnedProductId) ??
        products.find((p) => p.isFeatured) ??
        [...products].sort((a, b) => a.sortOrder - b.sortOrder)[0] ??
        null;
    const productId = pinned?.productId ?? null;
    useEffect(() => {
        if (productId === null)
            return;
        setWiped(false);
        setError(null);
        setAdded(false);
        const frame = requestAnimationFrame(() => setWiped(true));
        return () => cancelAnimationFrame(frame);
    }, [productId]);
    useEffect(() => {
        if (!added)
            return;
        const timer = window.setTimeout(() => setAdded(false), ADDED_MS);
        return () => window.clearTimeout(timer);
    }, [added]);
    const cart = useCart(signedIn);
    const orders = useQuery({
        queryKey: ['orders'],
        queryFn: () => api.get<{
            orders: OrderDto[];
        }>('/api/orders'),
        enabled: signedIn,
    });
    const placedHere = (orders.data?.orders ?? []).find((order) => new Date(order.createdAt).getTime() >= openedAtRef.current - OPENED_SLACK_MS &&
        order.items.some((item) => item.liveSessionId === sessionId));
    const addToCart = useCallback(() => {
        if (productId === null)
            return;
        setBusy(true);
        setError(null);
        void api
            .post('/api/cart/items', { productId, quantity: 1, ...(live ? { liveSessionId: sessionId } : {}) }, { 'Idempotency-Key': idempotencyKey() })
            .then(async () => {
            setAdded(true);
            await queryClient.invalidateQueries({ queryKey: ['cart'] });
        })
            .catch((err: unknown) => {
            const code = err instanceof ApiError ? err.code : 'request_failed';
            setError(ADD_ERROR[code] ?? 'Could not add to cart.');
        })
            .finally(() => setBusy(false));
    }, [productId, live, sessionId, queryClient]);
    if (pinned === null)
        return null;
    const stock = pinned.stock ?? null;
    const soldOut = stock !== null && stock <= 0;
    const payable = pinned.price.liveMinorUnits ?? pinned.price.shopMinorUnits;
    const inCart = cart.data?.items.find((item) => item.productId === pinned.productId) ?? null;
    const column = orientation === 'column';
    const previewProducts = products
        .filter((product) => product.productId !== pinned.productId)
        .slice(0, 3);
    const liveDealCount = live
        ? products.reduce((count, product) => count + (product.price.liveMinorUnits === null ? 0 : 1), 0)
        : 0;
    const label = soldOut
        ? 'Out of stock'
        : added
            ? 'Added ✓'
            : busy
                ? 'Adding…'
                : `Add · ${formatInr(payable)}`;
    return (<div className={`relative flex shrink-0 items-center gap-3 border-t border-line bg-surface px-3 md:px-4 ${column
            ? 'min-h-pin-bar w-full flex-col items-start justify-center rounded-panel border py-4'
            : 'h-pin-bar'} ${className ?? ''}`}>

      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 origin-left bg-accent" style={{
            transform: `scaleX(${wiped ? 1 : 0})`,
            transition: 'transform var(--d-ctl) var(--ease-out)',
        }}/>

      <Link to={`/p/${pinned.slug}`} className="shrink-0 overflow-hidden rounded-ctl" tabIndex={-1} aria-hidden>
        {pinned.imageUrl === null ? (<span className="block h-16 w-16 bg-surface"/>) : (<img src={pinned.imageUrl} alt="" loading="lazy" className="block h-16 w-16 bg-[#fff] object-cover"/>)}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {pinnedProductId === pinned.productId ? (<span className="badge-accent w-fit text-11">Featured now</span>) : null}
        <Link to={`/p/${pinned.slug}`} className="truncate text-16 font-medium text-t1 hover:underline">
          {pinned.title}
        </Link>
        <PriceTag ladder={pinned.price} size="sm" className="tnum"/>
      </div>
      {!column && products.length > 1 && onViewProducts !== undefined && (<button type="button" aria-label={`View all ${products.length} products in this show`} className="hidden shrink-0 items-center gap-3 rounded-ctl border border-line px-3 py-2 text-left transition hover:border-accent hover:bg-canvas md:flex" onClick={onViewProducts}>
          <span className="flex -space-x-2" aria-hidden>
            {previewProducts.map((product) => product.imageUrl === null ? (<span key={product.productId} className="h-9 w-9 rounded-full border-2 border-surface bg-canvas"/>) : (<img key={product.productId} src={product.imageUrl} alt="" loading="lazy" className="h-9 w-9 rounded-full border-2 border-surface bg-white object-cover"/>))}
          </span>
          <span>
            <span className="block text-12 font-semibold text-t1">
              {liveDealCount > 0 ? `${liveDealCount} live deals` : `${products.length} show items`}
            </span>
            <span className="block text-11 text-t3">View the full lineup</span>
          </span>
        </button>)}

      <div className={`flex shrink-0 flex-col items-stretch gap-1 ${column ? 'w-full' : 'items-end'}`}>
        {placedHere ? (<span className="badge-success tnum text-14">
            Order placed · {formatInr(placedHere.totalMinorUnits)} ✓
          </span>) : (<button type="button" className="btn-commit btn-lg tnum whitespace-nowrap" disabled={soldOut || busy || !signedIn} aria-live="polite" onClick={addToCart}>
            {label}
          </button>)}
        {error !== null && <span className="text-13 text-danger">{error}</span>}
        {error === null && !signedIn && (<span className="text-13 text-t3">Sign in to add to cart</span>)}
        {error === null && signedIn && inCart !== null && !added && (<span className="tnum text-13 text-t2">
            In cart · {formatInr(inCart.pricing.netMinorUnits)}
          </span>)}
      </div>
    </div>);
};
