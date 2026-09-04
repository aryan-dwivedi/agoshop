import { useQuery } from '@tanstack/react-query';
import { formatInr, type ComparisonDto } from '@shop/shared';
import { api } from '../lib/api';
import { CloseIcon } from './icons';
import { Rating } from './Rating';
export const COMPARE_MIN = 2;
export const COMPARE_MAX = 4;
export const CompareDrawer = ({ ids, onRemove, onClear, }: {
    ids: string[];
    onRemove: (productId: string) => void;
    onClear: () => void;
}): JSX.Element | null => {
    const key = ids.join(',');
    const comparison = useQuery({
        queryKey: ['compare', key],
        queryFn: () => api.get<ComparisonDto>(`/api/products/compare?ids=${encodeURIComponent(key)}`),
        enabled: ids.length >= COMPARE_MIN,
        staleTime: 60 * 1000,
    });
    if (ids.length === 0)
        return null;
    return (<aside className="fixed bottom-0 left-0 right-0 z-30 animate-slide-up rounded-t-sheet border border-line bg-elev shadow-sheet">
      <div className="mx-auto max-w-page px-4 py-3">
        <div className="flex items-center justify-between gap-4 border-b border-line pb-2.5">
          <h2 className="section-title">
            Comparing{' '}
            <span className="tnum text-t3">
              {ids.length}/{COMPARE_MAX}
            </span>
          </h2>
          <button type="button" className="btn-quiet btn-sm" onClick={onClear} aria-label="Clear comparison">
            <CloseIcon className="h-3.5 w-3.5"/>
            Clear
          </button>
        </div>

        {ids.length < COMPARE_MIN ? (<p className="mt-2.5 text-14 text-t2">
            Pick one more product from the similar-products rail to see specs side by side.
          </p>) : comparison.isPending ? (<div className="mt-2.5 space-y-2">
            {[0, 1, 2].map((i) => (<div key={i} className="skeleton h-8"/>))}
          </div>) : comparison.error !== null ? (<p className="mt-2.5 text-14 text-danger">
            We could not build this comparison. Remove a product and try again.
          </p>) : comparison.data !== undefined ? (<div className="scroll-thin mt-2.5 max-h-[46vh] overflow-auto">
            <table className="w-full border-collapse text-14">
              <thead className="sticky top-0 bg-elev">
                <tr className="divide-x divide-line">
                  <th className="w-40 border-b border-line py-2 pr-3 text-left align-bottom">
                    <span className="eyebrow">Attribute</span>
                  </th>
                  {comparison.data.rows.map((row) => (<th key={row.productId} className="border-b border-line px-3 py-2 text-left align-top">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-14 font-medium text-t1">{row.title}</span>
                        <button type="button" aria-label={`Remove ${row.title} from comparison`} className="shrink-0 rounded-chip p-0.5 text-t3 transition duration-ctl hover:bg-surface hover:text-t1" onClick={() => onRemove(row.productId)}>
                          <CloseIcon className="h-3.5 w-3.5"/>
                        </button>
                      </div>
                    </th>))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                <tr className="divide-x divide-line">
                  <th className="py-2 pr-3 text-left text-13 font-medium text-t2">Price</th>
                  {comparison.data.rows.map((row) => (<td key={row.productId} className="tnum px-3 py-2 text-14 font-semibold text-t1">
                      {formatInr(row.priceMinorUnits)}
                    </td>))}
                </tr>
                <tr className="divide-x divide-line bg-surface">
                  <th className="py-2 pr-3 text-left text-13 font-medium text-t2">Rating</th>
                  {comparison.data.rows.map((row) => (<td key={row.productId} className="px-3 py-2">
                      <Rating value={row.rating}/>
                    </td>))}
                </tr>
                {comparison.data.attributes.map((attr, i) => (<tr key={attr} className={`divide-x divide-line ${i % 2 === 1 ? 'bg-surface' : ''}`}>
                    <th className="py-2 pr-3 text-left text-13 font-medium text-t2">{attr}</th>
                    {comparison.data.rows.map((row) => (<td key={row.productId} className="px-3 py-2 text-t1">
                        {row.values[attr] ?? <span className="text-t3">—</span>}
                      </td>))}
                  </tr>))}
              </tbody>
            </table>
          </div>) : null}
      </div>
    </aside>);
};
