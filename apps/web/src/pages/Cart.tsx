import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { formatInr, type CartDto, type CartLineDto, type ProductDto } from '@shop/shared';

// The §4.5 suppression wording lives once, next to the cart sheet, so the page and
// the sheet cannot drift apart.
import { suppressionReason } from '../components/CartSheet';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ProductRail } from '../components/ProductRail';
import { TagIcon, TruckIcon } from '../components/icons';
import { api } from '../lib/api';
import { useSession } from '../state/session';

/**
 * The light "paperwork" surface, bled out to the layout column's own padding
 * (`Layout` owns `px-3 md:px-5` and no vertical padding) so the sheet of paper
 * reaches the column edges instead of floating inside a dark gutter.
 */
const PAPER = '-mx-3 min-h-full bg-bg px-3 py-6 text-t1 md:-mx-5 md:px-5';

const QuantityStepper = ({
  line,
  busy,
  onQuantity,
}: {
  line: CartLineDto;
  busy: boolean;
  onQuantity: (quantity: number) => void;
}): JSX.Element => (
  <div className="inline-flex items-center rounded-ctl border border-line-ctl">
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-l-ctl text-16 text-t2 transition duration-ctl hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`Decrease quantity of ${line.productTitle}`}
      disabled={busy || line.quantity <= 1}
      onClick={() => onQuantity(line.quantity - 1)}
    >
      −
    </button>
    <span className="w-8 text-center text-14 font-medium tnum text-t1" aria-live="polite">
      {line.quantity}
    </span>
    <button
      type="button"
      className="flex h-8 w-8 items-center justify-center rounded-r-ctl text-16 text-t2 transition duration-ctl hover:text-t1 disabled:cursor-not-allowed disabled:opacity-40"
      aria-label={`Increase quantity of ${line.productTitle}`}
      disabled={busy || line.quantity >= 10}
      onClick={() => onQuantity(line.quantity + 1)}
    >
      +
    </button>
  </div>
);

const CartLine = ({
  line,
  onQuantity,
  onRemove,
  busy,
}: {
  line: CartLineDto;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
  busy: boolean;
}): JSX.Element => {
  const appliedCodes = line.applied.map((a) => a.code);
  const showEnded = line.liveSessionId !== null && !line.liveEligible;
  const displayedMinorUnits = showEnded ? line.pricing.grossMinorUnits : line.pricing.netMinorUnits;
  const appliedLabel = appliedCodes.length === 1 ? `After ${appliedCodes[0]}` : 'After discounts';

  return (
    <li className="flex flex-col gap-4 p-4 sm:flex-row">
      <Link to={`/p/${line.productSlug}`} className="shrink-0">
        {line.imageUrl === null ? (
          <div className="flex h-24 w-24 items-center justify-center rounded-ctl border border-line bg-surface text-23 font-semibold text-t3">
            {line.productTitle.slice(0, 1).toUpperCase()}
          </div>
        ) : (
          <img
            src={line.imageUrl}
            alt={line.productTitle}
            className="h-24 w-24 rounded-ctl border border-line bg-[#fff] object-cover"
          />
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <Link to={`/p/${line.productSlug}`} className="link text-16 font-medium">
              {line.productTitle}
            </Link>
            <p className="mt-0.5 text-13 text-t2">{line.variantLabel}</p>
            {line.liveSessionId !== null && (
              <p className="mt-2">
                {line.liveEligible ? (
                  <span className="pill bg-live-wash text-live">
                    <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden="true" />
                    Live price — locked while the show runs
                  </span>
                ) : (
                  <span className="badge-neutral">
                    Show ended — back to{' '}
                    <span className="tnum">{formatInr(line.pricing.unitPriceMinorUnits)}</span>
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="text-right">
            <p className="text-19 font-semibold tnum text-t1">{formatInr(displayedMinorUnits)}</p>
            {showEnded && line.pricing.discountMinorUnits > 0 ? (
              <p className="text-13 font-medium tnum text-success">
                {appliedLabel}: {formatInr(line.pricing.netMinorUnits)}
              </p>
            ) : (
              line.pricing.discountMinorUnits > 0 && (
                <p className="text-13 tnum text-t3 line-through">
                  {formatInr(line.pricing.grossMinorUnits)}
                </p>
              )
            )}
            {/* Per unit stays per unit: the line total is the server's, and a client
                that multiplies its own totals is how a cart starts disagreeing with
                a bill. */}
            <p className="text-11 tnum text-t3">
              {formatInr(line.pricing.unitPriceMinorUnits)} × {line.quantity}
              {line.pricing.unitMrpMinorUnits !== null && (
                <>
                  {' · MRP '}
                  <span className="line-through">{formatInr(line.pricing.unitMrpMinorUnits)}</span>
                  {' / unit'}
                </>
              )}
            </p>
          </div>
        </div>

        {(line.applied.length > 0 || line.suppressed.length > 0) && (
          <dl className="mt-3 space-y-1 border-t border-line pt-3 text-13">
            {line.applied.map((a) => (
              <div key={a.code} className="flex items-baseline justify-between gap-3">
                <dt className="text-success">
                  <span className="font-semibold">{a.code}</span>
                  <span className="text-t2"> — {a.label}</span>
                </dt>
                <dd className="shrink-0 font-semibold tnum text-success">
                  −{formatInr(a.minorUnits)}
                </dd>
              </div>
            ))}
            {line.suppressed.map((s) => (
              <div key={`${s.code}-${s.reason}`}>
                <dt className="text-t3">{suppressionReason(s, appliedCodes)}</dt>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-3 flex items-center gap-3">
          <QuantityStepper line={line} busy={busy} onQuantity={onQuantity} />
          <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
    </li>
  );
};

const Cart = (): JSX.Element => {
  const { user } = useSession();
  const queryClient = useQueryClient();

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
    enabled: user !== null,
  });

  const recommended = useQuery({
    queryKey: ['recommendations', 'recently_viewed'],
    queryFn: () =>
      api.get<{ items: ProductDto[] }>('/api/recommendations?basedOn=recently_viewed&limit=8'),
    enabled: user !== null,
  });

  const setQuantity = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.patch<CartDto>(`/api/cart/items/${id}`, { quantity }),
    onSuccess: (next) => queryClient.setQueryData(['cart'], next),
  });

  const removeLine = useMutation({
    mutationFn: (id: string) => api.del<CartDto>(`/api/cart/items/${id}`),
    onSuccess: (next) => queryClient.setQueryData(['cart'], next),
  });

  if (user === null) {
    return (
      <div data-theme="light" className={PAPER}>
        <EmptyState
          title="Sign in to see your cart"
          body="Your cart follows you between devices, and a live show's price applies while the show is running."
          action={{ to: '/login?next=/cart', label: 'Sign in' }}
        />
      </div>
    );
  }

  if (cart.isPending) {
    return (
      <div data-theme="light" className={`${PAPER} space-y-5`}>
        <div className="skeleton h-9 w-40" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="card divide-y divide-line overflow-hidden">
            {[0, 1].map((i) => (
              <div key={i} className="flex gap-4 p-4">
                <div className="skeleton h-24 w-24 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-5 w-2/3" />
                  <div className="skeleton h-4 w-1/3" />
                  <div className="skeleton h-8 w-28" />
                </div>
              </div>
            ))}
          </div>
          <div className="card h-fit space-y-3 p-4">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-8 w-2/3" />
            <div className="skeleton h-ctl-lg w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (cart.error !== null || cart.data === undefined) {
    return (
      <div data-theme="light" className={PAPER}>
        <ErrorState
          title="Cart unavailable"
          error={cart.error ?? new Error('We could not load your cart just now.')}
          onRetry={() => void cart.refetch()}
        />
      </div>
    );
  }

  const data = cart.data;
  const expired = data.notices.includes('live_discount_expired');
  const liveActive = data.notices.includes('live_discount_active');
  const busy = setQuantity.isPending || removeLine.isPending;
  const mutationError = setQuantity.error ?? removeLine.error;

  if (data.items.length === 0) {
    return (
      <div data-theme="light" className={`${PAPER} space-y-8`}>
        <EmptyState
          title="Your cart is empty"
          body="Add anything from the catalog, or join a live show — a line added while the show runs keeps its live price for as long as the show is on."
          action={{ to: '/live', label: 'See live shows' }}
        />
        <ProductRail
          title="Pick up where you left off"
          subtitle="Recently viewed, newest first"
          products={recommended.data?.items}
          isLoading={recommended.isPending}
          error={recommended.error}
          emptyTitle="Nothing viewed yet"
          emptyBody="Open a product and it shows up here, so there is always a way back into the catalog."
        />
      </div>
    );
  }

  return (
    <div data-theme="light" className={`${PAPER} space-y-5`}>
      <header className="flex items-baseline gap-2">
        <h1 className="text-23 font-semibold tracking-[-0.01em] text-t1">Cart</h1>
        <p className="text-19 tnum text-t3">({data.items.length})</p>
      </header>

      {expired && (
        <div
          role="alert"
          className="animate-slide-down rounded-ctl border border-line bg-surface p-4"
          data-testid="live-discount-expired"
        >
          <p className="text-14 leading-relaxed text-t1">
            The show ended, so its live price came off. Everything else is unchanged.
          </p>
        </div>
      )}

      {liveActive && (
        <div className="animate-slide-down flex items-center gap-2.5 rounded-ctl border border-line bg-live-wash p-4">
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-live" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
          </span>
          <p className="text-14 leading-relaxed text-t1">
            <span className="font-semibold text-live">Live price on this cart.</span> Check out
            while the show is on and the saving below stays on your order.
          </p>
        </div>
      )}

      {mutationError !== null && (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-live-wash px-4 py-3 text-14 font-medium text-danger"
        >
          {mutationError.message}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="card overflow-hidden">
          <ul className="divide-y divide-line">
            {data.items.map((line) => (
              <CartLine
                key={line.id}
                line={line}
                busy={busy}
                onQuantity={(quantity) => setQuantity.mutate({ id: line.id, quantity })}
                onRemove={() => removeLine.mutate(line.id)}
              />
            ))}
          </ul>
        </div>

        <aside className="h-fit lg:sticky lg:top-[calc(var(--bar-h)+16px)]">
          <div className="card overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <h2 className="section-title">Summary</h2>
            </div>

            <div className="p-4">
              <dl className="space-y-2 text-14">
                <div className="flex justify-between gap-4">
                  <dt className="text-t2">Subtotal</dt>
                  <dd className="font-medium tnum text-t1">
                    {formatInr(data.totals.subtotalMinorUnits)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-t2">Discount</dt>
                  <dd className="font-medium tnum text-success">
                    {data.totals.discountMinorUnits === 0
                      ? formatInr(0)
                      : `−${formatInr(data.totals.discountMinorUnits)}`}
                  </dd>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-3">
                  <dt className="text-16 font-medium text-t1">Total</dt>
                  <dd className="text-23 font-semibold tnum text-t1">
                    {formatInr(data.totals.totalMinorUnits)}
                  </dd>
                </div>
              </dl>

              {data.totals.discountMinorUnits > 0 && (
                <p className="badge-success mt-3">
                  <TagIcon className="h-3.5 w-3.5" />
                  You save {formatInr(data.totals.discountMinorUnits)}
                </p>
              )}

              <Link to="/checkout" className="btn-commit btn-lg mt-4 w-full">
                Checkout · <span className="tnum">{formatInr(data.totals.totalMinorUnits)}</span>
              </Link>
              <Link to="/" className="btn-quiet mt-2 w-full">
                Keep shopping
              </Link>
            </div>

            <p className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-13 text-t2">
              <TruckIcon className="h-4 w-4 shrink-0 text-t3" />
              Delivery to your PIN code is checked at checkout
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Cart;
