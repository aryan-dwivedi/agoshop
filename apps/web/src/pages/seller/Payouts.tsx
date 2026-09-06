import { useSearchParams } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { ComingSoonPanel } from '../../components/seller/ComingSoon';
import { Metric } from '../../components/seller/Metric';
import { RoleGate } from '../../components/seller/RoleGate';
import { isFeatureLive } from '../../components/seller/studioFeatures';
import { useSellerOrders } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const Payouts = (): JSX.Element => {
    const { user } = useSession();
    const [params, setParams] = useSearchParams();
    const sellerId = params.get('sellerId');
    const allowed = user?.role === 'seller';
    const orders = useSellerOrders(allowed, sellerId);
    const grossPaid = (orders.data?.orders ?? []).reduce(
        (total, order) => total + order.totalMinorUnits,
        0,
    );
    const payoutsLive = isFeatureLive('payouts');

    return (
        <RoleGate
            roles={['seller']}
            title="Payouts"
            subtitle="Sales collected through your storefront."
            scope={
                orders.data
                    ? {
                          sellers: orders.data.sellers,
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
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="card">
                    <Metric
                        label="Paid sales"
                        value={orders.isLoading ? null : formatInr(grossPaid)}
                        hint="Total from paid orders in Studio."
                    />
                </div>
                {!payoutsLive && (
                    <div className="card">
                        <Metric
                            label="Available payout"
                            value={null}
                            hint="Bank settlement is not connected yet."
                        />
                    </div>
                )}
            </div>

            {!payoutsLive && (
                <div className="mt-4">
                    <ComingSoonPanel
                        feature="payouts"
                        title="Payouts are coming soon"
                        description="Studio tracks your paid sales. Bank details, fees, settlement schedules, and transfers will be available in a future release."
                    />
                </div>
            )}
        </RoleGate>
    );
};
export default Payouts;
