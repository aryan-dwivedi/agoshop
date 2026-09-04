import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatInr, type CartDto, type OrderDto, type SessionProductDto } from '@shop/shared';

import { api, ApiError, idempotencyKey } from '../../lib/api';
import { PriceTag } from '../PriceTag';

/**
 * The pinned-product bar: the one surface in the room that makes money, and the one
 * thing nothing is ever allowed to cover.
 *
 * It sits in flow directly under the frame, at the frame's own width, so the buy
 * affordance is never a floating pill cropping the video and never scrolls away on a
 * phone. It carries exactly one commit control — amber, `Add · ₹X` — because a room
 * with two of those has taught the shopper nothing about either.
 *
 * What it shows, in order of preference: the product the host pinned; failing that
 * the session's featured product; failing that the first of the line-up. A room with
 * a line-up always has something to buy, so the bar is never empty while one exists.
 */

const ADD_ERROR: Record<string, string> = {
  invalid_live_session_product: 'That product is not part of this show.',
  out_of_stock: 'Out of stock.',
  rate_limited: 'Too many taps — try again in a moment.',
};

/** How long the confirmation tick holds before the button offers another add. */
const ADDED_MS = 1200;

/**
 * An order counts as "placed in this room" only if it landed after the shopper opened
 * it. The two-minute slack covers the gap between server and browser clocks; without
 * an anchor at all, every order this shopper ever placed from any show would light up
 * the bar on every visit.
 */
const OPENED_SLACK_MS = 120_000;

export const PinBar = ({
  sessionId,
  products,
  pinnedProductId,
  live,
  signedIn,
  onViewProducts,
  /**
   * `row` sits under a landscape frame. `column` stands beside a portrait one, where
   * a full-width bar under a 9:16 stage would be wider than the video it belongs to.
   */
  orientation = 'row',
  className,
}: {
  sessionId: string;
  products: SessionProductDto[];
  pinnedProductId: string | null;
  /** True only while the session is `live`: only then is `liveSessionId` sent. */
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

  const pinned =
    products.find((p) => p.productId === pinnedProductId) ??
    products.find((p) => p.isFeatured) ??
    [...products].sort((a, b) => a.sortOrder - b.sortOrder)[0] ??
    null;

  const productId = pinned?.productId ?? null;

  /**
   * Pinning is the one moment this bar changes under the shopper, so it is announced:
   * a 2px amber wipe across the bar, and no motion at all on the price. Money that
   * animates reads as money being manipulated.
   */
  useEffect(() => {
    if (productId === null) return;
    setWiped(false);
    setError(null);
    setAdded(false);
    const frame = requestAnimationFrame(() => setWiped(true));
    return () => cancelAnimationFrame(frame);
  }, [productId]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), ADDED_MS);
    return () => window.clearTimeout(timer);
  }, [added]);

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
    enabled: signedIn,
  });

  /**
   * The confirmation the checkout sheet collapses into. `['orders']` is invalidated by
   * the checkout that placed it, so this refreshes without a poll.
   */
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api.get<{ orders: OrderDto[] }>('/api/orders'),
    enabled: signedIn,
  });

  const placedHere = (orders.data?.orders ?? []).find(
    (order) =>
      new Date(order.createdAt).getTime() >= openedAtRef.current - OPENED_SLACK_MS &&
      order.items.some((item) => item.liveSessionId === sessionId),
  );

  const addToCart = useCallback(() => {
    if (productId === null) return;
    setBusy(true);
    setError(null);
    void api
      .post(
        '/api/cart/items',
        { productId, quantity: 1, ...(live ? { liveSessionId: sessionId } : {}) },
        { 'Idempotency-Key': idempotencyKey() },
      )
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

  if (pinned === null) return null;

  // Server truth, guarded: a room whose payload predates stock reporting simply has
  // no opinion about it, which is not the same as being sold out.
  const stock = pinned.stock ?? null;
  const soldOut = stock !== null && stock <= 0;
  const payable = pinned.price.liveMinorUnits ?? pinned.price.shopMinorUnits;
  const inCart = cart.data?.items.find((item) => item.productId === pinned.productId) ?? null;
  const column = orientation === 'column';
  const previewProducts = products
    .filter((product) => product.productId !== pinned.productId)
    .slice(0, 3);
  const liveDealCount = live
    ? products.reduce(
        (count, product) => count + (product.price.liveMinorUnits === null ? 0 : 1),
        0,
      )
    : 0;

  const label = soldOut
    ? 'Out of stock'
    : added
      ? 'Added ✓'
      : busy
        ? 'Adding…'
        : `Add · ${formatInr(payable)}`;

  return (
    <div
      className={`relative flex shrink-0 items-center gap-3 border-t border-line bg-surface px-3 md:px-4 ${
        column
          ? 'min-h-pin-bar w-full flex-col items-start justify-center rounded-panel border py-4'
          : 'h-pin-bar'
      } ${className ?? ''}`}
    >
      {/* The pin wipe. Transform only, so it never reflows the row it crosses. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 origin-left bg-accent"
        style={{
          transform: `scaleX(${wiped ? 1 : 0})`,
          transition: 'transform var(--d-ctl) var(--ease-out)',
        }}
      />

      <Link
        to={`/p/${pinned.slug}`}
        className="shrink-0 overflow-hidden rounded-ctl"
        tabIndex={-1}
        aria-hidden
      >
        {pinned.imageUrl === null ? (
          <span className="block h-16 w-16 bg-surface" />
        ) : (
          <img
            src={pinned.imageUrl}
            alt=""
            loading="lazy"
            /* A product photo is shot on white; the tile keeps it that way. */
            className="block h-16 w-16 bg-[#fff] object-cover"
          />
        )}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {pinnedProductId === pinned.productId ? (
          <span className="badge-accent w-fit text-11">Featured now</span>
        ) : null}
        <Link
          to={`/p/${pinned.slug}`}
          className="truncate text-16 font-medium text-t1 hover:underline"
        >
          {pinned.title}
        </Link>
        <PriceTag ladder={pinned.price} size="sm" className="tnum" />
      </div>
      {!column && products.length > 1 && onViewProducts !== undefined && (
        <button
          type="button"
          aria-label={`View all ${products.length} products in this show`}
          className="hidden shrink-0 items-center gap-3 rounded-ctl border border-line px-3 py-2 text-left transition hover:border-accent hover:bg-canvas md:flex"
          onClick={onViewProducts}
        >
          <span className="flex -space-x-2" aria-hidden>
            {previewProducts.map((product) =>
              product.imageUrl === null ? (
                <span
                  key={product.productId}
                  className="h-9 w-9 rounded-full border-2 border-surface bg-canvas"
                />
              ) : (
                <img
                  key={product.productId}
                  src={product.imageUrl}
                  alt=""
                  loading="lazy"
                  className="h-9 w-9 rounded-full border-2 border-surface bg-white object-cover"
                />
              ),
            )}
          </span>
          <span>
            <span className="block text-12 font-semibold text-t1">
              {liveDealCount > 0 ? `${liveDealCount} live deals` : `${products.length} show items`}
            </span>
            <span className="block text-11 text-t3">View the full lineup</span>
          </span>
        </button>
      )}

      <div
        className={`flex shrink-0 flex-col items-stretch gap-1 ${column ? 'w-full' : 'items-end'}`}
      >
        {placedHere ? (
          <span className="badge-success tnum text-14">
            Order placed · {formatInr(placedHere.totalMinorUnits)} ✓
          </span>
        ) : (
          <button
            type="button"
            className="btn-commit btn-lg tnum whitespace-nowrap"
            disabled={soldOut || busy || !signedIn}
            aria-live="polite"
            onClick={addToCart}
          >
            {label}
          </button>
        )}
        {error !== null && <span className="text-13 text-danger">{error}</span>}
        {error === null && !signedIn && (
          <span className="text-13 text-t3">Sign in to add to cart</span>
        )}
        {error === null && signedIn && inCart !== null && !added && (
          <span className="tnum text-13 text-t2">
            In cart · {formatInr(inCart.pricing.netMinorUnits)}
          </span>
        )}
      </div>
    </div>
  );
};
