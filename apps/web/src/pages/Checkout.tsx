import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { formatInr, type CartDto, type OrderDto, type PaymentMethod } from '@shop/shared';

import { EmptyState, ErrorState } from '../components/EmptyState';
import {
  BLOCKED_REASON_LABELS,
  PAYMENT_METHOD_LABELS,
  checkoutOptionsQuery,
} from '../components/PincodeCheck';
import { PinIcon, TruckIcon } from '../components/icons';
import { api, ApiError, idempotencyKey } from '../lib/api';
import { useSession } from '../state/session';

/**
 * The light "paperwork" surface, bled out to the layout column's own padding
 * (`Layout` owns `px-3 md:px-5` and no vertical padding). Never applied in the
 * cart sheet: that sheet sits next to live video and stays dark (§3.3).
 */
const PAPER = '-mx-3 min-h-full bg-bg px-3 py-6 text-t1 md:-mx-5 md:px-5';

type Totals = {
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  totalMinorUnits: number;
};

/** Distinct, actionable failures. Anything unlisted falls back to the server message. */
type Failure =
  | { kind: 'declined'; message: string }
  | { kind: 'out_of_stock'; message: string; variantId: string | null }
  | { kind: 'pricing_changed'; message: string; totals: Totals | null }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'other'; message: string };

const CARD_METHODS: PaymentMethod[] = ['card', 'emi'];

const OTHER_MESSAGES: Record<string, string> = {
  cart_empty: 'Your cart is empty — add something before checking out.',
  below_min_order: 'This order is below the minimum for checkout.',
  pincode_required: 'Enter the 6-digit PIN code you want this delivered to.',
  pincode_blocked: 'We cannot deliver to this PIN code right now.',
  pincode_not_serviceable: 'We do not deliver to this PIN code. Try another one.',
  payment_method_unavailable:
    'That payment method is no longer available for this order — pick another one below.',
  idempotency_in_progress: 'This order is still going through. Give it a second before retrying.',
};

const classify = (err: unknown): Failure => {
  if (!(err instanceof ApiError)) {
    return { kind: 'other', message: 'We could not reach the order service.' };
  }
  switch (err.code) {
    case 'payment_declined':
      return { kind: 'declined', message: err.message };
    case 'out_of_stock':
      // AppError details are spread inside `error`, so the sold-out variant
      // arrives as error.variantId alongside the code.
      return {
        kind: 'out_of_stock',
        message: err.message,
        variantId:
          (err.body as { error?: { variantId?: string } } | null)?.error?.variantId ?? null,
      };
    case 'pricing_changed':
      return {
        kind: 'pricing_changed',
        message: err.message,
        totals: (err.body as { error?: { totals?: Totals } } | null)?.error?.totals ?? null,
      };
    case 'rate_limited':
      return { kind: 'rate_limited', message: err.message };
    default:
      return { kind: 'other', message: OTHER_MESSAGES[err.code] ?? err.message };
  }
};

/**
 * One step of the checkout. On the page each step is its own numbered card; in the
 * sheet — where the pincode and the method are already known — the three collapse
 * into rows of a single card, which is the whole point of `compact`.
 */
const Step = ({
  step,
  title,
  collapsed,
  children,
}: {
  step: number;
  title: string;
  collapsed: boolean;
  children: ReactNode;
}): JSX.Element =>
  collapsed ? (
    <div className="border-b border-line p-4 last:border-b-0">
      <p className="eyebrow mb-2">{title}</p>
      {children}
    </div>
  ) : (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface text-13 font-semibold tnum text-t2">
          {step}
        </span>
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );

/**
 * The whole checkout, page or sheet. `compact` is the in-session variant: no page
 * chrome, one column, and — once a pincode and a payment method are known — the
 * three steps collapse to one screen so a live shopper never leaves the room.
 * `onPlaced` replaces the navigation to `/orders` so the sheet can collapse itself
 * into a confirmation row.
 */
export const CheckoutFlow = ({
  compact = false,
  onPlaced,
}: {
  compact?: boolean;
  onPlaced?: (orderId: string) => void;
}): JSX.Element => {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [pincode, setPincode] = useState(user?.defaultPincode ?? '');
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [card, setCard] = useState({ number: '', expiry: '', cvv: '', name: '' });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [reconfirm, setReconfirm] = useState(false);
  // What the shopper agreed to pay on the attempt that failed, so a price change
  // can be shown as a before/after instead of a bare new number.
  const [attempted, setAttempted] = useState<Totals | null>(null);

  const pincodeRef = useRef<HTMLInputElement>(null);
  const methodsRef = useRef<HTMLDivElement>(null);

  const cart = useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
    enabled: user !== null,
  });

  const pincodeReady = /^\d{6}$/.test(pincode);

  const options = useQuery({
    ...checkoutOptionsQuery(pincode),
    enabled: user !== null && pincodeReady,
  });

  const methods = options.data?.methods ?? [];
  const selected = method !== null && methods.includes(method) ? method : (methods[0] ?? null);
  const needsCard = selected !== null && CARD_METHODS.includes(selected);

  const removeLine = useMutation({
    mutationFn: (id: string) => api.del<CartDto>(`/api/cart/items/${id}`),
    onSuccess: (next) => {
      queryClient.setQueryData(['cart'], next);
      setFailure(null);
    },
  });

  const placeOrder = useMutation({
    mutationFn: async (): Promise<OrderDto> => {
      if (selected === null) throw new Error('No payment method selected');
      const res = await api.post<{ order: OrderDto }>(
        '/api/orders',
        {
          paymentMethod: selected,
          pincode,
          ...(needsCard ? { card } : {}),
        },
        { 'Idempotency-Key': idempotencyKey() },
      );
      let order = res.order;
      const deadline = Date.now() + 30_000;
      while (order.status === 'pending' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        const poll = await api.get<{ order: OrderDto }>(`/api/orders/${order.id}`);
        order = poll.order;
      }
      if (order.status === 'pending') {
        throw new Error('Order is still processing. Check your orders page in a moment.');
      }
      if (order.status === 'payment_failed' || order.status === 'expired') {
        throw new ApiError(402, 'payment_failed', 'Payment could not be completed', { order });
      }
      return order;
    },
    onSuccess: (order) => {
      setFailure(null);
      setReconfirm(false);
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      if (onPlaced !== undefined) onPlaced(order.id);
      else navigate(`/orders?highlight=${order.id}`);
    },
    onError: (err) => {
      const f = classify(err);
      setFailure(f);
      // Only a price change asks for a re-confirmation; any other failure clears
      // it, so the button never says "Confirm" about a total nobody moved.
      setReconfirm(f.kind === 'pricing_changed');
      // Stock and pricing both moved on the server: never render a stale total.
      if (f.kind === 'pricing_changed' || f.kind === 'out_of_stock') {
        void queryClient.invalidateQueries({ queryKey: ['cart'] });
      }
    },
  });

  const changePincode = (): void => {
    setFailure(null);
    pincodeRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pincodeRef.current?.focus();
    pincodeRef.current?.select();
  };

  const tryAnotherMethod = (): void => {
    setFailure(null);
    setMethod(null);
    methodsRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    methodsRef.current?.querySelector<HTMLInputElement>('input[type="radio"]')?.focus();
  };

  if (user === null) {
    return (
      <div data-theme={compact ? undefined : 'light'} className={compact ? '' : PAPER}>
        <EmptyState
          title="Sign in to check out"
          body="Your cart and its prices are waiting — signing in takes a moment."
          action={{ to: '/login?next=/checkout', label: 'Sign in' }}
        />
      </div>
    );
  }

  if (cart.isPending) {
    return (
      <div
        data-theme={compact ? undefined : 'light'}
        className={compact ? 'space-y-4' : `${PAPER} space-y-5`}
      >
        <div className="skeleton h-9 w-44" />
        <div className={compact ? 'space-y-4' : 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]'}>
          <div className="space-y-4">
            <div className="skeleton h-28" />
            <div className="skeleton h-40" />
            <div className="skeleton h-32" />
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
      <div data-theme={compact ? undefined : 'light'} className={compact ? '' : PAPER}>
        <ErrorState
          title="Cart unavailable"
          error={cart.error ?? new Error('We could not load your cart just now.')}
          onRetry={() => void cart.refetch()}
        />
      </div>
    );
  }

  if (cart.data.items.length === 0) {
    return (
      <div data-theme={compact ? undefined : 'light'} className={compact ? '' : PAPER}>
        <EmptyState
          title="Nothing to check out"
          body="Your cart is empty. Add a product — or join a live show and its price applies while the show runs."
          action={{ to: '/', label: 'Browse the catalog' }}
        />
      </div>
    );
  }

  const items = cart.data.items;
  const totals = cart.data.totals;
  const soldOut =
    failure?.kind === 'out_of_stock'
      ? (items.find((l) => l.variantId === failure.variantId) ?? null)
      : null;
  const blockedReason =
    options.data !== undefined && options.data.blockedReason !== null
      ? (BLOCKED_REASON_LABELS[options.data.blockedReason] ?? options.data.blockedReason)
      : null;
  const shortfall =
    options.data !== undefined ? options.data.minOrderMinorUnits - totals.totalMinorUnits : 0;
  const belowMin = options.data !== undefined && shortfall > 0;
  // While re-confirming, the button quotes the total the server just came back
  // with — the cached cart may still be a refetch behind, and the two numbers
  // must never disagree in front of the shopper.
  const quoted =
    failure?.kind === 'pricing_changed' && failure.totals !== null ? failure.totals : totals;
  // One screen only once both unknowns are answered; a first-time buyer in the
  // sheet still gets the pincode and the method as their own steps.
  const oneScreen = compact && pincodeReady && selected !== null;
  const canPlace =
    pincodeReady &&
    selected !== null &&
    !belowMin &&
    options.data?.pincodeServiceable !== false &&
    (!needsCard || /^\d{12,19}$/.test(card.number.replace(/\s/g, '')));

  const steps = (
    <>
      <Step step={1} title="Deliver to" collapsed={oneScreen}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <PinIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t3" />
            <input
              ref={pincodeRef}
              className="input w-40 pl-9 tnum"
              inputMode="numeric"
              maxLength={6}
              placeholder="PIN code"
              aria-label="Delivery PIN code"
              value={pincode}
              onChange={(e) => {
                setPincode(e.target.value.replace(/\D/g, '').slice(0, 6));
                setFailure(null);
              }}
            />
          </div>
          {!pincodeReady ? (
            <p className="text-14 text-t2">Payment options and delivery dates need a PIN code.</p>
          ) : options.isPending ? (
            <p className="text-14 text-t3">Checking delivery…</p>
          ) : options.data !== undefined ? (
            <p className="text-14">
              {options.data.pincodeServiceable === false ? (
                <span className="font-medium text-danger">
                  We do not deliver here — try another PIN code.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-medium text-success">
                  <TruckIcon className="h-4 w-4" />
                  Delivers here
                  {options.data.etaDays !== null && (
                    <span className="font-normal text-t2">
                      {' '}
                      · in {options.data.etaDays} {options.data.etaDays === 1 ? 'day' : 'days'}
                    </span>
                  )}
                </span>
              )}
            </p>
          ) : options.error !== null ? (
            <p className="text-14 font-medium text-danger">{options.error.message}</p>
          ) : null}
        </div>
        {blockedReason !== null && (
          <div className="mt-3 rounded-ctl border border-line bg-live-wash p-3">
            <p className="text-14 font-medium text-t1">{blockedReason}</p>
            <button type="button" className="btn-standard btn-sm mt-2" onClick={changePincode}>
              Change pincode
            </button>
          </div>
        )}
      </Step>

      <Step step={2} title="Pay with" collapsed={oneScreen}>
        <div ref={methodsRef}>
          {!pincodeReady ? (
            <p className="text-14 text-t2">Enter a PIN code to see how you can pay.</p>
          ) : options.isPending ? (
            <p className="text-14 text-t3">Loading payment options…</p>
          ) : methods.length === 0 ? (
            <div className="rounded-ctl border border-line bg-live-wash p-3">
              <p className="text-14 font-medium text-t1">
                No payment option is available for this order.
              </p>
              <button type="button" className="btn-standard btn-sm mt-2" onClick={changePincode}>
                Change pincode
              </button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {methods.map((m) => (
                <label
                  key={m}
                  className={`flex min-h-ctl cursor-pointer items-center gap-3 rounded-ctl border px-3 text-14 font-medium transition duration-ctl ${
                    selected === m
                      ? 'border-accent bg-accent-wash text-t1'
                      : 'border-line-ctl text-t2 hover:text-t1'
                  }`}
                >
                  <input
                    type="radio"
                    name="paymentMethod"
                    className="accent-accent"
                    checked={selected === m}
                    onChange={() => {
                      setMethod(m);
                      setFailure(null);
                    }}
                  />
                  {PAYMENT_METHOD_LABELS[m]}
                </label>
              ))}
            </div>
          )}
        </div>

        {needsCard && (
          <div className="animate-slide-up mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="label">Card number</span>
              <input
                className="input tnum"
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="4111 1111 1111 1111"
                value={card.number}
                onChange={(e) => setCard({ ...card, number: e.target.value })}
              />
            </label>
            <label>
              <span className="label">Expiry</span>
              <input
                className="input tnum"
                autoComplete="cc-exp"
                placeholder="12/29"
                value={card.expiry}
                onChange={(e) => setCard({ ...card, expiry: e.target.value })}
              />
            </label>
            <label>
              <span className="label">CVV</span>
              <input
                className="input tnum"
                inputMode="numeric"
                autoComplete="cc-csc"
                maxLength={4}
                placeholder="123"
                value={card.cvv}
                onChange={(e) => setCard({ ...card, cvv: e.target.value })}
              />
            </label>
          </div>
        )}
      </Step>

      <Step step={3} title="Review" collapsed={oneScreen}>
        <ul className="space-y-3">
          {items.map((line) => (
            <li key={line.id} className="flex items-center gap-3">
              {line.imageUrl === null ? (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-16 font-semibold text-t3">
                  {line.productTitle.slice(0, 1).toUpperCase()}
                </span>
              ) : (
                <img
                  src={line.imageUrl}
                  alt=""
                  className="h-12 w-12 shrink-0 rounded-ctl border border-line bg-[#fff] object-cover"
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-14 font-medium text-t1">
                  {line.productTitle}
                </span>
                <span className="block text-13 text-t2">
                  {line.variantLabel} · <span className="tnum">{line.quantity}</span>
                  {line.liveEligible && (
                    <span className="font-medium text-live"> · live price</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-14 font-medium tnum text-t1">
                  {formatInr(line.pricing.netMinorUnits)}
                </span>
                {/* What the line would cost without its offers, so review shows the
                    saving it is about to lock into the order. */}
                {line.pricing.discountMinorUnits > 0 && (
                  <span className="block text-11 tnum text-t3 line-through">
                    {formatInr(line.pricing.grossMinorUnits)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Step>
    </>
  );

  const summary = (
    <div className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="section-title">Summary</h2>
      </div>

      <div className="p-4">
        <dl className="space-y-2 text-14">
          <div className="flex justify-between gap-4">
            <dt className="text-t2">Subtotal</dt>
            <dd className="font-medium tnum text-t1">{formatInr(totals.subtotalMinorUnits)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-t2">Discount</dt>
            <dd className="font-medium tnum text-success">
              {totals.discountMinorUnits === 0
                ? formatInr(0)
                : `−${formatInr(totals.discountMinorUnits)}`}
            </dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-line pt-3">
            <dt className="text-16 font-medium text-t1">Total</dt>
            <dd className="text-23 font-semibold tnum text-t1">
              {formatInr(totals.totalMinorUnits)}
            </dd>
          </div>
        </dl>

        {belowMin && (
          <div className="mt-3 rounded-ctl border border-line bg-surface p-3">
            <p className="text-14 font-medium text-t1">
              Add <span className="tnum">{formatInr(shortfall)}</span> to check out
            </p>
            <Link to="/" className="btn-standard btn-sm mt-2">
              Add more items
            </Link>
          </div>
        )}

        <button
          type="button"
          className="btn-commit btn-lg mt-4 w-full"
          disabled={!canPlace || placeOrder.isPending}
          onClick={() => {
            setAttempted(totals);
            placeOrder.mutate();
          }}
        >
          {placeOrder.isPending ? (
            'Placing order…'
          ) : (
            <>
              {reconfirm ? 'Confirm at ' : 'Pay '}
              <span className="tnum">{formatInr(quoted.totalMinorUnits)}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  const failurePanel =
    failure === null ? null : (
      <section
        role="alert"
        className={`animate-slide-up rounded-ctl border border-line p-4 ${
          failure.kind === 'pricing_changed' ? 'bg-accent-wash' : 'bg-live-wash'
        }`}
      >
        {failure.kind === 'declined' && (
          <>
            <p className="text-14 font-medium leading-relaxed text-t1">
              That payment didn&rsquo;t go through. Nothing was charged.
            </p>
            <button type="button" className="btn-standard btn-sm mt-3" onClick={tryAnotherMethod}>
              Try another method
            </button>
          </>
        )}

        {failure.kind === 'out_of_stock' && (
          <>
            <p className="text-14 font-medium leading-relaxed text-t1">
              {soldOut === null
                ? 'One of your items just sold out. Nothing was charged.'
                : `${soldOut.productTitle} (${soldOut.variantLabel}) just sold out. Nothing was charged.`}
            </p>
            {soldOut === null ? (
              <Link to="/cart" className="btn-standard btn-sm mt-3">
                Review cart
              </Link>
            ) : (
              <button
                type="button"
                className="btn-danger btn-sm mt-3"
                disabled={removeLine.isPending}
                onClick={() => removeLine.mutate(soldOut.id)}
              >
                Remove it
              </button>
            )}
          </>
        )}

        {failure.kind === 'pricing_changed' && (
          <>
            <p className="text-14 font-medium leading-relaxed text-t1">
              Price changed to{' '}
              <span className="tnum">
                {formatInr(failure.totals?.totalMinorUnits ?? totals.totalMinorUnits)}
              </span>{' '}
              — confirm?
            </p>
            <p className="mt-1 text-13 leading-relaxed text-t2">
              Nothing was charged. Confirm the new total to place the order.
            </p>
            {failure.totals !== null && attempted !== null && (
              <dl className="mt-3 flex items-baseline gap-3 text-14">
                <dt className="text-t2">Total</dt>
                <dd className="tnum text-t3 line-through">
                  {formatInr(attempted.totalMinorUnits)}
                </dd>
                <dd aria-hidden="true" className="text-t3">
                  →
                </dd>
                <dd className="font-semibold tnum text-t1">
                  {formatInr(failure.totals.totalMinorUnits)}
                </dd>
              </dl>
            )}
          </>
        )}

        {failure.kind === 'rate_limited' && (
          <>
            <p className="text-14 font-medium leading-relaxed text-t1">
              Too many attempts. Try again in a moment.
            </p>
            <button
              type="button"
              className="btn-standard btn-sm mt-3"
              disabled={placeOrder.isPending}
              onClick={() => {
                setAttempted(totals);
                placeOrder.mutate();
              }}
            >
              Try again
            </button>
          </>
        )}

        {failure.kind === 'other' && (
          <>
            <p className="text-14 font-medium leading-relaxed text-t1">{failure.message}</p>
            <button
              type="button"
              className="btn-standard btn-sm mt-3"
              disabled={placeOrder.isPending}
              onClick={() => {
                setAttempted(totals);
                placeOrder.mutate();
              }}
            >
              Try again
            </button>
          </>
        )}
      </section>
    );

  if (compact) {
    return (
      <div className="space-y-4">
        {oneScreen ? <div className="card overflow-hidden">{steps}</div> : steps}
        {failurePanel}
        {summary}
      </div>
    );
  }

  return (
    <div data-theme="light" className={`${PAPER} space-y-5`}>
      <h1 className="text-23 font-semibold tracking-[-0.01em] text-t1">Checkout</h1>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          {steps}
          {failurePanel}
        </div>
        <aside className="h-fit lg:sticky lg:top-[calc(var(--bar-h)+16px)]">{summary}</aside>
      </div>
    </div>
  );
};

const Checkout = (): JSX.Element => <CheckoutFlow compact={false} />;

export default Checkout;
