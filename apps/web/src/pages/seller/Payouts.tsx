import { useSearchParams } from 'react-router-dom';
import { formatInr } from '@shop/shared';
import { Metric } from '../../components/seller/Metric';
import { RoleGate } from '../../components/seller/RoleGate';
import { useSellerOrders } from '../../lib/sellerApi';
import { useSession } from '../../state/session';
const Payouts = (): JSX.Element => {
    const { user } = useSession();
    const [params, setParams] = useSearchParams();
    const sellerId = params.get('sellerId');
    const allowed = user?.role === 'seller';
    const orders = useSellerOrders(allowed, sellerId);
    const grossPaid = (orders.data?.orders ?? []).reduce((total, order) => total + order.totalMinorUnits, 0);
    return (<RoleGate roles={['seller']} title="Payouts" subtitle="Sales collected through your storefront." theme="light" scope={orders.data
            ? {
                sellers: orders.data.sellers,
                value: sellerId,
                onChange: (next) => {
                    const updated = new URLSearchParams(params);
                    if (next === null)
                        updated.delete('sellerId');
                    else
                        updated.set('sellerId', next);
                    setParams(updated);
                },
            }
            : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card">
          <Metric label="Paid sales" value={orders.isLoading ? null : formatInr(grossPaid)} hint="Total from the paid orders currently listed in Studio."/>
        </div>
        <div className="card">
          <Metric label="Available payout" value={null} hint="Payout processing is not connected yet."/>
        </div>
      </div>

      <section className="card mt-4 p-5">
        <h2 className="section-title">Payout setup is coming next</h2>
        <p className="mt-2 max-w-2xl text-14 leading-relaxed text-t2">
          Studio records paid sales, but bank details, fees, settlement schedules, and transfers are
          not connected. This page will show those details only when they are backed by real payout
          data.
        </p>
      </section>
    </RoleGate>);
};
export default Payouts;
