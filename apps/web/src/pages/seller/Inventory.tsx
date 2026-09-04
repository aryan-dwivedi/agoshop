import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { formatInr, minorUnitsToDecimalString, offPercent, rupeesToMinorUnits } from '@shop/shared';

import { RoleGate } from '../../components/seller/RoleGate';
import { Metric } from '../../components/seller/Metric';
import { customerUrl } from '../../lib/origins';
import {
  useSellerProducts,
  useUpdateVariantPricing,
  type SellerProduct,
  type SellerProductsDto,
  type SellerProductVariant,
  type VariantPricingInput,
} from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const nf = new Intl.NumberFormat('en-IN');

type SortKey = 'title' | 'categorySlug' | 'priceMinorUnits' | 'totalStock' | 'rating';

const COLUMNS: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
  { key: 'title', label: 'Product', align: 'left' },
  { key: 'categorySlug', label: 'Category', align: 'left' },
  { key: 'priceMinorUnits', label: 'From', align: 'right' },
  { key: 'rating', label: 'Rating', align: 'right' },
  { key: 'totalStock', label: 'Stock', align: 'right' },
];

const compare = (a: SellerProduct, b: SellerProduct, key: SortKey): number => {
  const left = a[key];
  const right = b[key];
  return typeof left === 'string' && typeof right === 'string'
    ? left.localeCompare(right)
    : Number(left) - Number(right);
};

type VariantPricingSave = UseMutationResult<
  { variant: SellerProductVariant },
  Error,
  VariantPricingInput
>;

type VariantDraft = { mrp: string; price: string; stock: string };

/** Server truth as form text, so "dirty" is a string comparison and not a float one. */
const toDraft = (variant: SellerProductVariant): VariantDraft => ({
  mrp: variant.mrpMinorUnits === null ? '' : minorUnitsToDecimalString(variant.mrpMinorUnits),
  price: minorUnitsToDecimalString(variant.priceMinorUnits),
  stock: String(variant.stock),
});

/**
 * One editable variant row.
 *
 * Rupees are what a seller types and paise are what the API stores, so the crossing
 * happens exactly once, through `rupeesToMinorUnits` — a hand-rolled `* 100` on
 * "1299.99" is how a paisa goes missing. The ladder beside the inputs is rendered from
 * the same `offPercent` the storefront badge uses, so the seller reads the shopper's
 * number rather than an operator-only approximation of it.
 */
const VariantEditor = ({
  productId,
  variant,
  save,
}: {
  productId: string;
  variant: SellerProductVariant;
  save: VariantPricingSave;
}): JSX.Element => {
  const server = toDraft(variant);
  const [draft, setDraft] = useState<VariantDraft>(server);

  const dirty =
    draft.mrp !== server.mrp || draft.price !== server.price || draft.stock !== server.stock;

  const priceMinorUnits = rupeesToMinorUnits(Number(draft.price));
  const mrpMinorUnits = draft.mrp.trim() === '' ? null : rupeesToMinorUnits(Number(draft.mrp));
  const stock = Number.parseInt(draft.stock, 10);

  /**
   * Mirrors the server's `mrp_below_price` rather than clamping: silently rewriting a
   * seller's number is worse than refusing it, because they would never learn which of
   * the two figures the storefront actually took.
   */
  const invalid =
    !Number.isFinite(priceMinorUnits) || priceMinorUnits <= 0
      ? 'Price must be above zero.'
      : mrpMinorUnits !== null &&
          (!Number.isFinite(mrpMinorUnits) || mrpMinorUnits <= priceMinorUnits)
        ? 'MRP must be strictly above the price — an equal MRP is not a markdown.'
        : !Number.isInteger(stock) || stock < 0
          ? 'Stock must be a whole number, zero or more.'
          : null;

  const isTarget = save.variables?.variantId === variant.id;
  const pending = save.isPending && isTarget;
  const failure = save.isError && isTarget ? save.error.message : null;
  const off = offPercent(mrpMinorUnits, priceMinorUnits);

  return (
    <>
      <tr>
        <td className="py-1.5 pr-3 font-mono text-slate-500">{variant.sku}</td>
        <td className="py-1.5 pr-3 text-slate-700">{variant.label}</td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            inputMode="decimal"
            className="input w-24 px-2 py-1 text-right text-xs tabular-nums"
            value={draft.mrp}
            onChange={(e) => setDraft({ ...draft, mrp: e.target.value })}
            placeholder="none"
            aria-label={`MRP in rupees for ${variant.sku}`}
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            inputMode="decimal"
            className="input w-24 px-2 py-1 text-right text-xs tabular-nums"
            value={draft.price}
            onChange={(e) => setDraft({ ...draft, price: e.target.value })}
            aria-label={`Price in rupees for ${variant.sku}`}
          />
        </td>
        <td className="py-1.5 pr-2">
          <input
            type="text"
            inputMode="numeric"
            className="input w-20 px-2 py-1 text-right text-xs tabular-nums"
            value={draft.stock}
            onChange={(e) => setDraft({ ...draft, stock: e.target.value })}
            aria-label={`Stock for ${variant.sku}`}
          />
        </td>
        <td className="py-1.5 pr-3">
          {invalid === null ? (
            <div className="flex flex-wrap items-baseline justify-end gap-1.5">
              {mrpMinorUnits !== null && off !== null && (
                <span className="tabular-nums text-slate-400 line-through">
                  {formatInr(mrpMinorUnits)}
                </span>
              )}
              <span className="font-bold tabular-nums text-slate-900">
                {formatInr(priceMinorUnits)}
              </span>
              {off !== null && <span className="badge-success">{off}% off</span>}
            </div>
          ) : (
            <div className="text-right text-slate-400">—</div>
          )}
        </td>
        <td className="py-1.5 text-right">
          <button
            type="button"
            className="btn-standard btn-sm"
            disabled={!dirty || invalid !== null || pending}
            onClick={() =>
              save.mutate({
                productId,
                variantId: variant.id,
                priceMinorUnits,
                mrpMinorUnits,
                stock,
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </td>
      </tr>
      {(invalid !== null || failure !== null) && dirty && (
        <tr>
          <td colSpan={7} className="pb-2 text-[11px] font-medium text-rose-600">
            {invalid ?? failure}
          </td>
        </tr>
      )}
    </>
  );
};

const Body = ({
  products,
  sellerId,
}: {
  products: UseQueryResult<SellerProductsDto>;
  sellerId: string | null;
}): JSX.Element => {
  const [sortKey, setSortKey] = useState<SortKey>('totalStock');
  const [ascending, setAscending] = useState(true);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // One mutation for the whole table: `save.variables` says which row is in flight,
  // so a row does not need its own hook to know it is the one saving.
  const save = useUpdateVariantPricing(sellerId);

  const all = products.data?.products ?? [];
  const threshold = products.data?.lowStockThreshold ?? 0;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = all.filter(
      (p) =>
        (!lowOnly || p.lowStock) &&
        (needle === '' ||
          p.title.toLowerCase().includes(needle) ||
          p.brand.toLowerCase().includes(needle) ||
          p.categorySlug.includes(needle) ||
          p.variants.some((v) => v.sku.toLowerCase().includes(needle))),
    );
    return [...filtered].sort((a, b) => (ascending ? 1 : -1) * compare(a, b, sortKey));
  }, [all, ascending, lowOnly, query, sortKey]);

  if (products.isLoading) {
    return <div className="card p-8 text-sm text-slate-500">Loading inventory…</div>;
  }

  if (products.isError) {
    return (
      <div className="card p-6">
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
          Could not load inventory.
        </p>
        <button type="button" className="btn-standard mt-3" onClick={() => void products.refetch()}>
          Retry
        </button>
      </div>
    );
  }

  const lowCount = all.filter((p) => p.lowStock).length;
  const outCount = all.filter((p) => p.totalStock === 0).length;
  const stockValue = all.reduce(
    (sum, p) => sum + p.variants.reduce((s, v) => s + v.priceMinorUnits * v.stock, 0),
    0,
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Products"
          value={nf.format(all.length)}
          hint={`${nf.format(all.reduce((count, product) => count + product.variants.length, 0))} variants`}
        />
        <Metric
          label="Low stock"
          value={nf.format(lowCount)}
          hint={`At or below ${nf.format(threshold)} units across variants`}
        />
        <Metric
          label="Out of stock"
          value={nf.format(outCount)}
          hint="Unavailable for checkout until stock is added."
        />
        <Metric
          label="Stock at list price"
          value={formatInr(stockValue)}
          hint="Units on hand × current variant price."
        />
      </div>

      <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <input
          className="input max-w-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, brand, category or SKU"
          aria-label="Filter inventory"
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 accent-accent"
            checked={lowOnly}
            onChange={(e) => setLowOnly(e.target.checked)}
          />
          Low stock only
        </label>
        <span className="ml-auto text-xs tabular-nums text-slate-500">
          {rows.length === all.length
            ? `${nf.format(all.length)} products`
            : `${nf.format(rows.length)} of ${nf.format(all.length)} products`}
        </span>
      </div>

      {all.length === 0 ? (
        <div className="card px-4 py-12 text-center">
          <p className="text-sm font-semibold text-slate-800">No products are assigned to you.</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">
            Inventory is seeded per seller; a session's rail can only attach products you own.
          </p>
          <Link to="/catalog/new" className="btn-commit mt-4">
            List a product
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="card px-4 py-10 text-center text-sm text-slate-600">
          Nothing matches that filter.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-widest text-slate-500">
              <tr className="border-b border-slate-200">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={`px-4 py-2 font-semibold ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 transition hover:text-slate-900"
                      onClick={() => {
                        setAscending(sortKey === col.key ? !ascending : true);
                        setSortKey(col.key);
                      }}
                      aria-sort={
                        sortKey === col.key ? (ascending ? 'ascending' : 'descending') : 'none'
                      }
                    >
                      {col.label}
                      <span
                        className={sortKey === col.key ? 'text-accent-text' : 'text-transparent'}
                      >
                        {ascending ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                ))}
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((p) => (
                <Fragment key={p.productId}>
                  <tr className="transition hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <a
                        href={customerUrl(`/p/${p.slug}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-t1 hover:text-accent-text hover:underline"
                      >
                        {p.title}
                      </a>
                      <div className="text-xs text-slate-500">{p.brand}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{p.categorySlug}</td>
                    <td className="px-4 py-2.5 text-right font-bold tabular-nums text-slate-900">
                      {formatInr(p.priceMinorUnits)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {/* A listing nobody has rated carries no score; 0.0 would read as one. */}
                      {p.rating === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        p.rating.toFixed(1)
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-semibold tabular-nums ${
                          p.totalStock === 0
                            ? 'text-rose-600'
                            : p.lowStock
                              ? 'text-accent-text'
                              : 'text-slate-900'
                        }`}
                      >
                        {nf.format(p.totalStock)}
                      </span>
                      {p.totalStock === 0 && (
                        <span className="ml-2 pill bg-rose-50 text-rose-600">out</span>
                      )}
                      {p.totalStock > 0 && p.lowStock && (
                        <span className="badge-accent ml-2">low</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="text-13 font-semibold text-accent-text hover:underline"
                        onClick={() => setExpanded(expanded === p.productId ? null : p.productId)}
                      >
                        {expanded === p.productId
                          ? 'Hide variants'
                          : `${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}`}
                      </button>
                    </td>
                  </tr>
                  {expanded === p.productId && (
                    <tr className="bg-slate-50">
                      <td colSpan={6} className="px-4 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-slate-500">
                            <tr>
                              <th className="py-1 pr-3 text-left font-semibold">SKU</th>
                              <th className="py-1 pr-3 text-left font-semibold">Variant</th>
                              <th className="py-1 pr-2 text-right font-semibold">MRP ₹</th>
                              <th className="py-1 pr-2 text-right font-semibold">Price ₹</th>
                              <th className="py-1 pr-2 text-right font-semibold">Stock</th>
                              <th className="py-1 pr-3 text-right font-semibold">
                                What the shopper sees
                              </th>
                              <th className="py-1" />
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {p.variants.map((v) => (
                              <VariantEditor
                                /**
                                 * Keyed on server truth: when a save or an SSE price change
                                 * lands, the editor remounts on the new numbers instead of
                                 * holding a draft that no longer matches the catalog.
                                 */
                                key={`${v.id}:${v.mrpMinorUnits ?? 'none'}:${v.priceMinorUnits}:${v.stock}`}
                                productId={p.productId}
                                variant={v}
                                save={save}
                              />
                            ))}
                          </tbody>
                        </table>
                        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                          Saving publishes immediately: open storefront and live-session tabs are
                          told to drop their cached price, so nobody is shown a number you have just
                          moved.
                        </p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const Inventory = (): JSX.Element => {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId');
  const allowed = user?.role === 'seller';
  const products = useSellerProducts(allowed, sellerId);

  return (
    <RoleGate
      roles={['seller']}
      title="Inventory"
      subtitle="Manage listings, prices, variants, and the stock available to shoppers."
      actions={
        <Link to="/catalog/new" className="btn-commit">
          List a product
        </Link>
      }
      scope={
        products.data === undefined
          ? undefined
          : {
              sellers: products.data.sellers,
              value: sellerId,
              onChange: (next) => setParams(next === null ? {} : { sellerId: next }),
            }
      }
    >
      <Body products={products} sellerId={sellerId} />
    </RoleGate>
  );
};

export default Inventory;
