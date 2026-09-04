import { useQuery } from '@tanstack/react-query';
import { formatInr, type SessionAnalyticsDto, type SessionProductDto } from '@shop/shared';
import { api } from '../../lib/api';
import { operatorKeys } from '../../lib/sellerApi';
export const ShowReadout = ({ sessionId, products, live, }: {
    sessionId: string;
    products: SessionProductDto[];
    live: boolean;
}): JSX.Element => {
    const analytics = useQuery<SessionAnalyticsDto, Error>({
        queryKey: operatorKeys.analytics(sessionId),
        queryFn: () => api.get<SessionAnalyticsDto>(`/api/seller/sessions/${sessionId}/analytics`),
        refetchInterval: live ? 20000 : false,
    });
    const data = analytics.data ?? null;
    const metrics = [
        { label: 'Orders', value: data === null ? '—' : data.orders.toLocaleString('en-IN') },
        { label: 'Revenue', value: data === null ? '—' : formatInr(data.gmvMinorUnits) },
        {
            label: 'Conversion',
            value: data === null || data.uniqueViewers === 0
                ? '—'
                : `${(data.conversionRate * 100).toFixed(1)}%`,
        },
        { label: 'Add-to-carts', value: data === null ? '—' : data.addToCarts.toLocaleString('en-IN') },
    ];
    return (<section className="border-t border-line p-3" aria-label="This show">
      <h2 className="eyebrow">This show</h2>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {metrics.map((metric) => (<div key={metric.label}>
            <dt className="text-11 text-t3">{metric.label}</dt>
            <dd className="tnum text-19 font-semibold text-t1">{metric.value}</dd>
          </div>))}
      </dl>

      <h3 className="eyebrow mt-3">Stock</h3>
      <ul className="mt-1 space-y-1">
        {products.map((product) => {
            const stock = product.stock ?? null;
            return (<li key={product.productId} className="flex items-baseline gap-2 text-14">
              <span className="truncate text-t2">{product.title}</span>
              <span className={`tnum ml-auto font-medium ${stock !== null && stock <= 0
                    ? 'text-danger'
                    : product.lowStock === true
                        ? 'text-accent'
                        : 'text-t1'}`}>
                {stock === null ? '—' : stock <= 0 ? 'Out' : stock}
              </span>
            </li>);
        })}
      </ul>
    </section>);
};
