import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router-dom';

import { formatInr, type CartDto, type CartLineDto, type SuppressedPromotion } from '@shop/shared';

import { api } from '../lib/api';
import { useSession } from '../state/session';
import { ChevronLeft } from './icons';
import { RightSheet, useSheet } from './RightSheet';

/**
 * The cart as an overlay. Same data, same copy as `/cart`; the difference is that it
 * never navigates, because a shopper who leaves a running show to pay has left the
 * room and the room is the product (§2.3).
 */

/**
 * The checkout step, inline. Only ever mounted from a live room — everywhere else
 * the sheet hands off to the full `/checkout` page, which stays the deep-link and
 * first-purchase path.
 *
 * The dynamic import is `React.lazy`'s contract, not a runtime-selected specifier:
 * checkout drags in the payment options and the order mutation, and the shell must
 * not pay for that before a shopper has a cart.
 */
const CheckoutFlow = lazy(async () => ({
  default: (await import('../pages/Checkout')).CheckoutFlow,
}));

/**
 * Why an eligible promotion did not apply, in the shopper's language: the winning
 * offer by name, never a reason code (§4.5).
 */
export const suppressionReason = (s: SuppressedPromotion, appliedCodes: string[]): string => {
  const winner = appliedCodes[0];
  switch (s.reason) {
    case 'not_stackable':
      return winner === undefined
        ? `${s.code} can't be combined with this line's offer`
        : `${winner} is better than ${s.code}, so we applied it`;
    case 'capped':
      return `${s.code} is already at its limit on this line`;
    case 'redemption_limit':
      return `You've used ${s.code} as many times as it allows`;
  }
};

const QtyStepper = ({
  quantity,
  busy,
  onChange,
}: {
  quantity: number;
  busy: boolean;
  onChange: (next: number) => void;
}): JSX.Element => (
  <div className="flex items-center rounded-ctl border border-line-ctl">
    <button
      type="button"
      aria-label="Reduce quantity"
      disabled={busy || quantity <= 1}
      onClick={() => onChange(quantity - 1)}
      className="flex h-9 w-9 items-center justify-center text-16 text-t2 disabled:opacity-40"
    >
      −
    </button>
    <span aria-live="polite" className="tnum w-7 text-center text-14 font-medium text-t1">
      {quantity}
    </span>
    <button
      type="button"
      aria-label="Increase quantity"
      disabled={busy || quantity >= 10}
      onClick={() => onChange(quantity + 1)}
      className="flex h-9 w-9 items-center justify-center text-16 text-t2 disabled:opacity-40"
    >
      +
    </button>
  </div>
);

const Line = ({
  line,
  busy,
  onQuantity,
  onRemove,
}: {
  line: CartLineDto;
  busy: boolean;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}): JSX.Element => {
  const appliedCodes = line.applied.map((a) => a.code);
  const showEnded = line.liveSessionId !== null && !line.liveEligible;
  const displayedMinorUnits = showEnded ? line.pricing.grossMinorUnits : line.pricing.netMinorUnits;
  const appliedLabel = appliedCodes.length === 1 ? `After ${appliedCodes[0]}` : 'After discounts';

  return (
    <li className="flex gap-3 px-4 py-3">
      <Link to={`/p/${line.productSlug}`} className="shrink-0">
        {/* A product photo needs a white tile: the surface is the studio backdrop,
            not a theme colour, so it does not follow the sheet's palette. */}
        <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-chip bg-[#fff]">
          {line.imageUrl !== null && (
            <img
              src={line.imageUrl}
              alt={line.productTitle}
              className="h-full w-full object-contain"
            />
          )}
        </span>
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/p/${line.productSlug}`} className="block truncate text-14 text-t1">
              {line.productTitle}
            </Link>
            <p className="text-13 text-t3">{line.variantLabel}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-16 font-semibold text-t1">{formatInr(displayedMinorUnits)}</p>
            {showEnded && line.pricing.discountMinorUnits > 0 ? (
              <p className="tnum text-12 font-medium text-success">
                {appliedLabel}: {formatInr(line.pricing.netMinorUnits)}
              </p>
            ) : (
              line.pricing.discountMinorUnits > 0 && (
                <p className="tnum text-13 text-t3 line-through">
                  {formatInr(line.pricing.grossMinorUnits)}
                </p>
              )
            )}
          </div>
        </div>

        {line.liveSessionId !== null && (
          <p className="mt-1.5 flex items-center gap-1.5 text-13">
            {line.liveEligible ? (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-live animate-breathe" />
                <span className="text-t2">Live price — locked while the show runs</span>
              </>
            ) : (
              <span className="tnum text-t2">
                Show ended — back to {formatInr(line.pricing.unitPriceMinorUnits)}
              </span>
            )}
          </p>
        )}

        {line.suppressed.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-13 text-t3">
            {line.suppressed.map((s) => (
              <li key={`${s.code}-${s.reason}`}>{suppressionReason(s, appliedCodes)}</li>
            ))}
          </ul>
        )}

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <QtyStepper quantity={line.quantity} busy={busy} onChange={onQuantity} />
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="btn-quiet btn-sm text-danger hover:text-danger"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
};

export const CartSheet = (): JSX.Element => {
  const { user } = useSession();
  const closeSheet = useSheet((s) => s.closeSheet);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inLiveRoom = useMatch('/live/:slug') !== null;

  /**
   * Both of these carry the total forward, because by the time the order exists the
   * cart has been emptied and re-read: reading it after the fact would confirm the
   * purchase with `₹0`.
   */
  const [checkout, setCheckout] = useState<{ totalMinorUnits: number } | null>(null);
  const [placed, setPlaced] = useState<{ orderId: string; totalMinorUnits: number } | null>(null);

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
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

  if (placed !== null) {
    return (
      <RightSheet label="Cart" title="Order placed" onClose={closeSheet}>
        <div className="p-4">
          <p className="tnum text-19 font-semibold text-t1">
            Order placed · {formatInr(placed.totalMinorUnits)} ✓
          </p>
          <p className="mt-1 text-14 text-t2">The show is still running behind this sheet.</p>
          <div className="mt-4 flex gap-2">
            <Link
              to={`/orders?highlight=${placed.orderId}`}
              className="btn-standard"
              onClick={closeSheet}
            >
              View order
            </Link>
            <button type="button" className="btn-quiet" onClick={closeSheet}>
              Back to the show
            </button>
          </div>
        </div>
      </RightSheet>
    );
  }

  if (checkout !== null) {
    return (
      <RightSheet
        label="Checkout"
        title={
          <button
            type="button"
            onClick={() => setCheckout(null)}
            className="flex items-center gap-2 text-19 font-semibold text-t1"
          >
            <ChevronLeft className="h-5 w-5" />
            Checkout
          </button>
        }
        onClose={closeSheet}
      >
        <Suspense fallback={<div className="skeleton m-4 h-64" />}>
          <CheckoutFlow
            compact
            onPlaced={(orderId) =>
              setPlaced({ orderId, totalMinorUnits: checkout.totalMinorUnits })
            }
          />
        </Suspense>
      </RightSheet>
    );
  }

  if (user === null) {
    return (
      <RightSheet label="Cart" title="Cart" onClose={closeSheet}>
        <div className="p-4">
          <p className="text-14 text-t2">Sign in to see your cart.</p>
          <Link to="/login?next=/cart" className="btn-commit mt-3" onClick={closeSheet}>
            Sign in
          </Link>
        </div>
      </RightSheet>
    );
  }

  if (cart.isPending) {
    return (
      <RightSheet label="Cart" title="Cart" onClose={closeSheet}>
        <div className="grid gap-3 p-4" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} className="skeleton h-20" />
          ))}
        </div>
      </RightSheet>
    );
  }

  if (cart.error !== null || cart.data === undefined) {
    return (
      <RightSheet label="Cart" title="Cart" onClose={closeSheet}>
        <div className="p-4">
          <p className="text-14 text-t2">Your cart didn&rsquo;t load.</p>
          <button type="button" className="btn-standard mt-3" onClick={() => void cart.refetch()}>
            Try again
          </button>
        </div>
      </RightSheet>
    );
  }

  const data = cart.data;
  const busy = setQuantity.isPending || removeLine.isPending;
  const mutationError = setQuantity.error ?? removeLine.error;

  if (data.items.length === 0) {
    return (
      <RightSheet label="Cart" title="Cart" onClose={closeSheet}>
        <div className="p-4">
          <p className="text-14 text-t1">Nothing in your cart yet.</p>
          <Link to="/live" className="btn-standard mt-3" onClick={closeSheet}>
            See what&rsquo;s live
          </Link>
        </div>
      </RightSheet>
    );
  }

  const codes = data.items
    .flatMap((l) => l.applied.map((a) => a.code))
    .filter((code, at, all) => all.indexOf(code) === at);
  const discountLabel = codes.length === 1 ? `Discount (${codes[0]})` : 'Discounts';

  return (
    <RightSheet
      label="Cart"
      title={`Cart (${data.items.length})`}
      onClose={closeSheet}
      footer={
        <>
          <dl className="mb-3 grid gap-1.5 text-14">
            <div className="flex justify-between gap-4">
              <dt className="text-t2">Subtotal</dt>
              <dd className="tnum text-t1">{formatInr(data.totals.subtotalMinorUnits)}</dd>
            </div>
            {data.totals.discountMinorUnits > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-t2">{discountLabel}</dt>
                <dd className="tnum text-success">−{formatInr(data.totals.discountMinorUnits)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="text-16 font-semibold text-t1">Total</dt>
              <dd className="tnum text-23 font-semibold text-t1">
                {formatInr(data.totals.totalMinorUnits)}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn-commit btn-lg tnum w-full"
            onClick={() => {
              // In a room the shopper pays without leaving it; from a browse
              // surface the full page is the better screen and keeps the cart's
              // history entry.
              if (inLiveRoom) {
                setCheckout({ totalMinorUnits: data.totals.totalMinorUnits });
                return;
              }
              closeSheet();
              navigate('/checkout');
            }}
          >
            Checkout · {formatInr(data.totals.totalMinorUnits)}
          </button>

          <Link
            to="/cart"
            onClick={closeSheet}
            className="link mt-3 block text-center text-13 text-t2"
          >
            Open the full cart
          </Link>
        </>
      }
    >
      {data.notices.includes('live_discount_expired') && (
        <p role="alert" className="border-b border-line px-4 py-3 text-14 text-t2">
          The show ended, so its live price came off. Everything else is unchanged.
        </p>
      )}

      {mutationError !== null && (
        <p role="alert" className="border-b border-line px-4 py-3 text-14 text-danger">
          {mutationError.message}
        </p>
      )}

      <ul className="divide-y divide-line">
        {data.items.map((line) => (
          <Line
            key={line.id}
            line={line}
            busy={busy}
            onQuantity={(quantity) => setQuantity.mutate({ id: line.id, quantity })}
            onRemove={() => removeLine.mutate(line.id)}
          />
        ))}
      </ul>
    </RightSheet>
  );
};
