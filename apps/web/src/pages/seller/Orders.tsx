import { useSearchParams } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { RoleGate } from '../../components/seller/RoleGate';
import { customerUrl } from '../../lib/origins';
import { useSellerOrders } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const methodLabel: Record<string, string> = {
  card: 'Card',
  upi: 'UPI',
  cod: 'Cash on delivery',
  emi: 'EMI',
};

const Orders = (): JSX.Element => {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId');
  const allowed = user?.role === 'seller';
  const query = useSellerOrders(allowed, sellerId);
  const orders = query.data?.orders ?? [];

  return (
    <RoleGate
      roles={['seller']}
      title="Orders"
      subtitle="Paid orders containing products from your storefront."
      theme="light"
      scope={
        query.data
          ? {
              sellers: query.data.sellers,
              value: sellerId,
              onChange: (next) => {
                const updated = new URLSearchParams(params);
                if (next === null) updated.delete('sellerId');
                else updated.set('sellerId', next);
                setParams(updated);
              },
            }
          : undefined
      }
    >
      {query.isLoading && (
        <div className="card space-y-2 p-4" aria-label="Loading orders" aria-busy="true">
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-8 w-full" />
          <div className="skeleton h-8 w-full" />
        </div>
      )}

      {query.isError && (
        <div className="card p-5">
          <p className="text-14 font-medium text-danger">Orders could not be loaded.</p>
          <button type="button" className="btn-standard mt-3" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}

      {!query.isLoading && !query.isError && orders.length === 0 && (
        <div className="card p-8 text-center">
          <h2 className="text-19 font-semibold text-t1">No paid orders yet</h2>
          <p className="mt-1 text-13 text-t2">New storefront orders will appear here.</p>
        </div>
      )}

      {orders.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-13">
              <thead className="border-b border-line bg-bg text-t3">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Products</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Placed</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {orders.map((order) => (
                  <tr key={order.id} className="align-top hover:bg-bg">
                    <td className="px-3 py-3">
                      <div className="font-medium text-t1">#{order.id.slice(-8).toUpperCase()}</div>
                      <span className="badge-success mt-1">Paid</span>
                    </td>
                    <td className="max-w-md px-3 py-3">
                      <ul className="space-y-1.5">
                        {order.items.map((item) => (
                          <li key={`${order.id}-${item.productId}-${item.variantLabel}`}>
                            <a
                              href={customerUrl(`/p/${item.productSlug}`)}
                              className="font-medium text-t1 hover:text-accent-text"
                            >
                              {item.productTitle}
                            </a>
                            <span className="ml-2 text-t3">
                              {item.variantLabel} · {item.quantity} ×{' '}
                              {formatInr(item.unitPriceMinorUnits)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-3 text-t2">
                      {methodLabel[order.paymentMethod] ?? order.paymentMethod}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-t2">
                      {dateTime.format(new Date(order.createdAt))}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-right font-semibold text-t1">
                      {formatInr(order.totalMinorUnits)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </RoleGate>
  );
};

export default Orders;
