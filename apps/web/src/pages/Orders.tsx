import type { OrderDto } from '@shop/shared';

import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { EmptyState, ErrorState } from '../components/EmptyState';
import { PAYMENT_METHOD_LABELS } from '../components/PincodeCheck';
import { api } from '../lib/api';
import { useSession } from '../state/session';

const PAPER = '-mx-3 min-h-full bg-bg px-3 py-6 text-t1 md:-mx-5 md:px-5';
const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
});
const STATUS_LABELS: Record<string, string> = {
    paid: 'Paid',
    pending: 'Pending',
    failed: 'Failed',
};
const StatusPill = ({ status }: { status: string }): JSX.Element => {
    const label = STATUS_LABELS[status] ?? status;
    if (status === 'paid') return <span className="badge-success">{label}</span>;
    if (status === 'failed') return <span className="pill font-semibold text-danger">{label}</span>;
    return <span className="badge-neutral">{label}</span>;
};
const OrderCard = ({
    order,
    highlighted,
}: {
    order: OrderDto;
    highlighted: boolean;
}): JSX.Element => {
    const liveLines = order.items.filter((i) => i.liveSessionId !== null);
    return (
        <article className={`card overflow-hidden ${highlighted ? 'border-accent' : ''}`}>
            <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line bg-surface p-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="section-title">
                            Order <span className="tnum">{order.id.slice(0, 8)}</span>
                        </p>
                        <StatusPill status={order.status} />
                    </div>
                    <p className="mt-1 text-13 text-t2">
                        {DATE_FORMAT.format(new Date(order.createdAt))} ·{' '}
                        {PAYMENT_METHOD_LABELS[order.paymentMethod]} · PIN{' '}
                        <span className="tnum">{order.pincode}</span>
                    </p>
                </div>
                <div className="text-right">
                    <p className="text-19 font-semibold tnum text-t1">
                        {formatInr(order.totalMinorUnits)}
                    </p>
                    {order.discountMinorUnits > 0 && (
                        <p className="text-13 font-medium tnum text-success">
                            saved {formatInr(order.discountMinorUnits)}
                        </p>
                    )}
                </div>
            </header>

            <ul className="divide-y divide-line">
                {order.items.map((item, i) => (
                    <li
                        key={`${item.productId}-${i}`}
                        className="flex flex-wrap gap-x-6 gap-y-2 p-4"
                    >
                        <Link
                            to={`/p/${item.productSlug}`}
                            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-ctl border border-line bg-surface text-19 font-semibold text-t3 transition duration-ctl hover:text-t1"
                            aria-hidden="true"
                            tabIndex={-1}
                        >
                            {item.productTitle.slice(0, 1).toUpperCase()}
                        </Link>
                        <div className="min-w-0 flex-1">
                            <Link
                                to={`/p/${item.productSlug}`}
                                className="link text-14 font-medium"
                            >
                                {item.productTitle}
                            </Link>
                            <p className="mt-0.5 text-13 text-t2">
                                {item.variantLabel} · qty{' '}
                                <span className="tnum">{item.quantity}</span> ·{' '}
                                <span className="tnum">{formatInr(item.unitPriceMinorUnits)}</span>{' '}
                                each
                            </p>

                            {item.liveSessionId !== null && (
                                <p className="mt-2">
                                    <span className="badge-live">
                                        Bought live in {item.liveSessionTitle ?? 'a live show'}
                                    </span>
                                </p>
                            )}

                            {item.appliedPromotionCodes.length > 0 && (
                                <p className="mt-2 flex flex-wrap gap-1.5">
                                    {item.appliedPromotionCodes.map((code) => (
                                        <span
                                            key={code}
                                            className="badge-accent"
                                        >
                                            {code}
                                        </span>
                                    ))}
                                </p>
                            )}
                        </div>

                        <div className="text-right">
                            <p className="text-14 font-medium tnum text-t1">
                                {formatInr(
                                    item.unitPriceMinorUnits * item.quantity -
                                        item.lineDiscountMinorUnits,
                                )}
                            </p>
                            {item.lineDiscountMinorUnits > 0 && (
                                <p className="text-13 font-medium tnum text-success">
                                    −{formatInr(item.lineDiscountMinorUnits)} on this line
                                </p>
                            )}
                        </div>
                    </li>
                ))}
            </ul>

            <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line bg-surface px-4 py-3 text-13 text-t2">
                <span className="tnum">
                    Subtotal {formatInr(order.subtotalMinorUnits)} · Discount −
                    {formatInr(order.discountMinorUnits)} · Paid {formatInr(order.totalMinorUnits)}
                </span>
                <span className="flex flex-wrap items-center gap-3">
                    {liveLines.length > 0 && (
                        <span className="font-medium text-live">
                            <span className="tnum">
                                {liveLines.length} of {order.items.length}
                            </span>{' '}
                            lines bought live
                        </span>
                    )}
                    <span className="text-t3">Ref {order.paymentRef}</span>
                </span>
            </footer>
        </article>
    );
};
const Orders = (): JSX.Element => {
    const { user } = useSession();
    const [params] = useSearchParams();
    const highlight = params.get('highlight');
    const orders = useQuery({
        queryKey: ['orders'],
        queryFn: () =>
            api.get<{
                orders: OrderDto[];
            }>('/api/orders'),
        enabled: user !== null,
    });
    if (user === null) {
        return (
            <div
                data-theme="light"
                className={PAPER}
            >
                <EmptyState
                    title="Sign in to see your orders"
                    body="Every order keeps the show it was bought in and the offers that applied to each line."
                    action={{ to: '/login?next=/orders', label: 'Sign in' }}
                />
            </div>
        );
    }
    if (orders.isPending) {
        return (
            <div
                data-theme="light"
                className={`${PAPER} space-y-5`}
            >
                <div className="skeleton h-9 w-36" />
                <div className="space-y-4">
                    {[0, 1].map((i) => (
                        <div
                            key={i}
                            className="card overflow-hidden"
                        >
                            <div className="flex items-center justify-between gap-4 border-b border-line bg-surface p-4">
                                <div className="space-y-2">
                                    <div className="skeleton h-5 w-40" />
                                    <div className="skeleton h-4 w-56" />
                                </div>
                                <div className="skeleton h-6 w-24" />
                            </div>
                            <div className="flex gap-4 p-4">
                                <div className="skeleton h-14 w-14 shrink-0" />
                                <div className="flex-1 space-y-2">
                                    <div className="skeleton h-4 w-1/2" />
                                    <div className="skeleton h-4 w-1/3" />
                                </div>
                            </div>
                            <div className="border-t border-line bg-surface px-4 py-3">
                                <div className="skeleton h-4 w-2/3" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }
    if (orders.error !== null) {
        return (
            <div
                data-theme="light"
                className={PAPER}
            >
                <ErrorState
                    title="Could not load your orders"
                    error={orders.error}
                    onRetry={() => void orders.refetch()}
                />
            </div>
        );
    }
    const list = orders.data?.orders ?? [];
    return (
        <div
            data-theme="light"
            className={`${PAPER} space-y-5`}
        >
            <header className="flex items-baseline gap-2">
                <h1 className="text-23 font-semibold tracking-[-0.01em] text-t1">Orders</h1>
                {list.length > 0 && <p className="text-19 tnum text-t3">({list.length})</p>}
            </header>

            {list.length === 0 ? (
                <EmptyState
                    title="No orders yet"
                    body="Place one from the cart and it shows up here with the show it came from and the offers that applied."
                    action={{ to: '/', label: 'Browse the catalog' }}
                />
            ) : (
                <div className="space-y-4">
                    {list.map((order) => (
                        <OrderCard
                            key={order.id}
                            order={order}
                            highlighted={order.id === highlight}
                        />
                    ))}
                </div>
            )}

            <p className="text-13 text-t2">
                Looking for a show you bought from?{' '}
                <Link
                    to="/live"
                    className="link font-medium"
                >
                    Watch it again
                </Link>
                .
            </p>
        </div>
    );
};
export default Orders;
