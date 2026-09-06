import type {
    SellerProduct,
    SellerProductVariant,
    SellerProductsDto,
    VariantPricingInput,
} from '../../lib/sellerApi';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { Fragment, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Pencil, Upload } from 'lucide-react';

import { formatInr, minorUnitsToDecimalString, offPercent, rupeesToMinorUnits } from '@shop/shared';

import { ComingSoonIconButton } from '../../components/seller/ComingSoon';
import { Metric } from '../../components/seller/Metric';
import { RoleGate } from '../../components/seller/RoleGate';
import { customerUrl } from '../../lib/origins';
import { useSellerProducts, useUpdateVariantPricing } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const nf = new Intl.NumberFormat('en-IN');
type SortKey = 'title' | 'categorySlug' | 'priceMinorUnits' | 'totalStock' | 'rating';
const COLUMNS: {
    key: SortKey;
    label: string;
    align: 'left' | 'right';
}[] = [
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
    {
        variant: SellerProductVariant;
    },
    Error,
    VariantPricingInput
>;
type VariantDraft = {
    mrp: string;
    price: string;
    stock: string;
};
const toDraft = (variant: SellerProductVariant): VariantDraft => ({
    mrp: variant.mrpMinorUnits === null ? '' : minorUnitsToDecimalString(variant.mrpMinorUnits),
    price: minorUnitsToDecimalString(variant.priceMinorUnits),
    stock: String(variant.stock),
});
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
                <td className="py-1.5 pr-3 font-mono text-t3">{variant.sku}</td>
                <td className="py-1.5 pr-3 text-t2">{variant.label}</td>
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
                                <span className="tabular-nums text-t3 line-through">
                                    {formatInr(mrpMinorUnits)}
                                </span>
                            )}
                            <span className="font-bold tabular-nums text-t1">
                                {formatInr(priceMinorUnits)}
                            </span>
                            {off !== null && <span className="badge-success">{off}% off</span>}
                        </div>
                    ) : (
                        <div className="text-right text-t3">—</div>
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
                    <td
                        colSpan={7}
                        className="pb-2 text-11 font-medium text-danger"
                    >
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
        return <div className="card p-8 text-14 text-t3">Loading catalog…</div>;
    }
    if (products.isError) {
        return (
            <div className="card p-6">
                <p className="rounded-ctl border border-live bg-live-wash px-3 py-2 text-14 text-danger">
                    Could not load catalog.
                </p>
                <button
                    type="button"
                    className="btn-standard mt-3"
                    onClick={() => void products.refetch()}
                >
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
                    className="input-studio max-w-xs"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search title, brand, category or SKU"
                    aria-label="Filter catalog"
                />
                <label className="flex items-center gap-2 text-13 font-medium text-t2">
                    <input
                        type="checkbox"
                        className="h-4 w-4 accent-accent"
                        checked={lowOnly}
                        onChange={(e) => setLowOnly(e.target.checked)}
                    />
                    Low stock only
                </label>
                <div className="ml-auto flex items-center gap-2">
                    <ComingSoonIconButton
                        feature="bulkCatalog"
                        icon={Upload}
                        label="Bulk import"
                    />
                    <span className="text-11 tabular-nums text-t3">
                        {rows.length === all.length
                            ? `${nf.format(all.length)} products`
                            : `${nf.format(rows.length)} of ${nf.format(all.length)}`}
                    </span>
                </div>
            </div>

            {all.length === 0 ? (
                <div className="studio-empty">
                    <p className="text-14 font-semibold text-t1">No products assigned to you.</p>
                    <p className="mx-auto mt-2 max-w-md text-13 leading-relaxed text-t2">
                        List a product to add it to your catalog and show line-ups.
                    </p>
                    <Link
                        to="/catalog/new"
                        className="btn-commit mt-4"
                    >
                        List a product
                    </Link>
                </div>
            ) : rows.length === 0 ? (
                <div className="studio-empty text-14 text-t2">Nothing matches that filter.</div>
            ) : (
                <div className="studio-table-wrap overflow-x-auto">
                    <table className="studio-table min-w-[760px]">
                        <thead>
                            <tr>
                                {COLUMNS.map((col) => (
                                    <th
                                        key={col.key}
                                        className={`px-4 py-2 font-medium ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                                    >
                                        <button
                                            type="button"
                                            className="inline-flex items-center gap-1 transition hover:text-t1"
                                            onClick={() => {
                                                setAscending(
                                                    sortKey === col.key ? !ascending : true,
                                                );
                                                setSortKey(col.key);
                                            }}
                                            aria-sort={
                                                sortKey === col.key
                                                    ? ascending
                                                        ? 'ascending'
                                                        : 'descending'
                                                    : 'none'
                                            }
                                        >
                                            {col.label}
                                            <span
                                                className={
                                                    sortKey === col.key
                                                        ? 'text-accent-text'
                                                        : 'text-transparent'
                                                }
                                            >
                                                {ascending ? '↑' : '↓'}
                                            </span>
                                        </button>
                                    </th>
                                ))}
                                <th className="px-4 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((p) => (
                                <Fragment key={p.productId}>
                                    <tr>
                                        <td>
                                            <a
                                                href={customerUrl(`/p/${p.slug}`)}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-semibold text-t1 hover:text-accent-text hover:underline"
                                            >
                                                {p.title}
                                            </a>
                                            <div className="text-11 text-t3">{p.brand}</div>
                                        </td>
                                        <td className="text-t2">{p.categorySlug}</td>
                                        <td className="text-right font-bold tabular-nums text-t1">
                                            {formatInr(p.priceMinorUnits)}
                                        </td>
                                        <td className="text-right tabular-nums text-t2">
                                            {p.rating === 0 ? (
                                                <span className="text-t3">—</span>
                                            ) : (
                                                p.rating.toFixed(1)
                                            )}
                                        </td>
                                        <td className="text-right">
                                            <span
                                                className={`font-semibold tabular-nums ${
                                                    p.totalStock === 0
                                                        ? 'text-danger'
                                                        : p.lowStock
                                                          ? 'text-accent-text'
                                                          : 'text-t1'
                                                }`}
                                            >
                                                {nf.format(p.totalStock)}
                                            </span>
                                            {p.totalStock === 0 && (
                                                <span className="ml-2 pill bg-live-wash text-danger">
                                                    out
                                                </span>
                                            )}
                                            {p.totalStock > 0 && p.lowStock && (
                                                <span className="badge-accent ml-2">low</span>
                                            )}
                                        </td>
                                        <td className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <ComingSoonIconButton
                                                    feature="productEdit"
                                                    icon={Pencil}
                                                    label="Edit product"
                                                    message="Full product editing will be live soon. You can update variant price and stock below."
                                                />
                                                <button
                                                    type="button"
                                                    className="text-13 font-semibold text-accent-text hover:underline"
                                                    onClick={() =>
                                                        setExpanded(
                                                            expanded === p.productId
                                                                ? null
                                                                : p.productId,
                                                        )
                                                    }
                                                >
                                                    {expanded === p.productId
                                                        ? 'Hide'
                                                        : `${p.variants.length} variant${p.variants.length === 1 ? '' : 's'}`}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                    {expanded === p.productId && (
                                        <tr className="bg-surface">
                                            <td
                                                colSpan={6}
                                                className="px-4 py-3"
                                            >
                                                <table className="w-full text-11">
                                                    <thead className="text-t3">
                                                        <tr>
                                                            <th className="py-1 pr-3 text-left font-semibold">
                                                                SKU
                                                            </th>
                                                            <th className="py-1 pr-3 text-left font-semibold">
                                                                Variant
                                                            </th>
                                                            <th className="py-1 pr-2 text-right font-semibold">
                                                                MRP ₹
                                                            </th>
                                                            <th className="py-1 pr-2 text-right font-semibold">
                                                                Price ₹
                                                            </th>
                                                            <th className="py-1 pr-2 text-right font-semibold">
                                                                Stock
                                                            </th>
                                                            <th className="py-1 pr-3 text-right font-semibold">
                                                                What the shopper sees
                                                            </th>
                                                            <th className="py-1" />
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-line">
                                                        {p.variants.map((v) => (
                                                            <VariantEditor
                                                                key={`${v.id}:${v.mrpMinorUnits ?? 'none'}:${v.priceMinorUnits}:${v.stock}`}
                                                                productId={p.productId}
                                                                variant={v}
                                                                save={save}
                                                            />
                                                        ))}
                                                    </tbody>
                                                </table>
                                                <p className="mt-2 text-11 leading-relaxed text-t3">
                                                    Saving publishes immediately — storefront and
                                                    live tabs refresh their cached prices.
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
            title="Catalog"
            subtitle="Manage products, prices, and stock for your storefront."
            actions={
                <Link
                    to="/catalog/new"
                    className="btn-commit"
                >
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
            <Body
                products={products}
                sellerId={sellerId}
            />
        </RoleGate>
    );
};
export default Inventory;
