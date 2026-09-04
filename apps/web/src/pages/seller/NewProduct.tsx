import type { CategoryDto } from '../../components/ProductRail';
import type { NewProductInput, NewProductVariantInput, SellerProduct } from '../../lib/sellerApi';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { rupeesToMinorUnits } from '@shop/shared';

import { RoleGate } from '../../components/seller/RoleGate';
import { ApiError, api } from '../../lib/api';
import { customerUrl } from '../../lib/origins';
import { useCreateProduct, useSellerProducts } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const MAX_LIST_ROWS = 8;
const MAX_VARIANTS = 12;
type TextRow = {
    key: string;
    value: string;
};
type VariantDraft = {
    key: string;
    label: string;
    sku: string;
    price: string;
    mrp: string;
    stock: string;
};
const textRow = (): TextRow => ({ key: crypto.randomUUID(), value: '' });
const variantRow = (): VariantDraft => ({
    key: crypto.randomUUID(),
    label: '',
    sku: '',
    price: '',
    mrp: '',
    stock: '0',
});
type VariantErrors = {
    label?: string;
    sku?: string;
    price?: string;
    mrp?: string;
    stock?: string;
};
type FormErrors = {
    title?: string;
    brand?: string;
    description?: string;
    categorySlug?: string;
    variants: Record<string, VariantErrors>;
};
const validate = (draft: {
    title: string;
    brand: string;
    description: string;
    categorySlug: string;
    variants: VariantDraft[];
}): FormErrors => {
    const errors: FormErrors = { variants: {} };
    const title = draft.title.trim();
    const brand = draft.brand.trim();
    const description = draft.description.trim();
    if (title.length < 3) errors.title = 'Title needs at least 3 characters.';
    else if (title.length > 140) errors.title = 'Title is capped at 140 characters.';
    if (brand.length === 0) errors.brand = 'Brand is required.';
    else if (brand.length > 80) errors.brand = 'Brand is capped at 80 characters.';
    if (description.length < 10) errors.description = 'Description needs at least 10 characters.';
    else if (description.length > 4000)
        errors.description = 'Description is capped at 4000 characters.';
    if (draft.categorySlug === '')
        errors.categorySlug = 'Pick the department this listing sells in.';
    for (const variant of draft.variants) {
        const row: VariantErrors = {};
        const label = variant.label.trim();
        const sku = variant.sku.trim();
        if (label.length === 0) row.label = 'Every variant needs a label, e.g. “256 GB / Black”.';
        else if (label.length > 80) row.label = 'Label is capped at 80 characters.';
        if (sku.length > 0 && (sku.length < 3 || sku.length > 64))
            row.sku = 'A SKU you supply must be 3–64 characters.';
        const priceRupees = Number(variant.price);
        const hasPrice = variant.price.trim().length > 0 && Number.isFinite(priceRupees);
        const priceMinorUnits = hasPrice ? rupeesToMinorUnits(priceRupees) : Number.NaN;
        if (!hasPrice || priceMinorUnits <= 0) row.price = 'Price must be above zero.';
        if (variant.mrp.trim().length > 0) {
            const mrpRupees = Number(variant.mrp);
            const mrpMinorUnits = Number.isFinite(mrpRupees)
                ? rupeesToMinorUnits(mrpRupees)
                : Number.NaN;
            if (!Number.isFinite(mrpMinorUnits) || mrpMinorUnits <= 0)
                row.mrp = 'MRP must be a number above zero.';
            else if (Number.isFinite(priceMinorUnits) && mrpMinorUnits <= priceMinorUnits)
                row.mrp = 'MRP must be strictly above the price.';
        }
        const stock = Number.parseInt(variant.stock, 10);
        if (!Number.isInteger(stock) || stock < 0)
            row.stock = 'Stock must be a whole number, zero or more.';
        if (Object.keys(row).length > 0) errors.variants[variant.key] = row;
    }
    return errors;
};
const hasErrors = (errors: FormErrors): boolean =>
    errors.title !== undefined ||
    errors.brand !== undefined ||
    errors.description !== undefined ||
    errors.categorySlug !== undefined ||
    Object.keys(errors.variants).length > 0;
const FAILURE_COPY: Record<string, string> = {
    sku_taken:
        'One of those SKUs is already listed. Leave the SKU blank and the console will generate a free one.',
    mrp_below_price:
        'MRP must be strictly above the selling price — an equal MRP is not a markdown.',
    unknown_category: 'That department no longer exists. Reload the page and pick another.',
    seller_not_owned: 'That storefront is not one you can list under.',
};
const failureMessage = (error: Error | null): string | null => {
    if (error === null) return null;
    if (error instanceof ApiError) return FAILURE_COPY[error.code] ?? error.message;
    return error.message;
};
const FieldError = ({ message }: { message: string | undefined }): JSX.Element =>
    message === undefined ? (
        <></>
    ) : (
        <p className="mt-1 text-[11px] font-medium text-rose-600">{message}</p>
    );
const Published = ({
    product,
    onAnother,
}: {
    product: SellerProduct;
    onAnother: () => void;
}): JSX.Element => (
    <div className="card animate-slide-up border-emerald-200 bg-emerald-50 p-5">
        <h2 className="section-title">{product.title} is live</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
            {product.variants.length} variant
            {product.variants.length === 1 ? '' : 's'} listed under {product.brand} in{' '}
            {product.categorySlug}. Shoppers browsing the storefront can buy it now.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
            <a
                className="btn-commit"
                href={customerUrl(`/p/${product.slug}`)}
                target="_blank"
                rel="noreferrer"
            >
                View on storefront
            </a>
            <Link
                to="/catalog"
                className="btn-standard"
            >
                Back to products
            </Link>
            <button
                type="button"
                className="link text-sm font-semibold"
                onClick={onAnother}
            >
                List another product
            </button>
        </div>
    </div>
);
const Form = ({
    sellerId,
    categories,
}: {
    sellerId: string | null;
    categories: CategoryDto[];
}): JSX.Element => {
    const [title, setTitle] = useState('');
    const [brand, setBrand] = useState('');
    const [description, setDescription] = useState('');
    const [categorySlug, setCategorySlug] = useState('');
    const [highlights, setHighlights] = useState<TextRow[]>([textRow()]);
    const [images, setImages] = useState<TextRow[]>([textRow()]);
    const [variants, setVariants] = useState<VariantDraft[]>([variantRow()]);
    const [defaultKey, setDefaultKey] = useState<string>(() => variants[0]?.key ?? '');
    const [attempted, setAttempted] = useState(false);
    const create = useCreateProduct();
    const errors = useMemo(
        () => validate({ title, brand, description, categorySlug, variants }),
        [title, brand, description, categorySlug, variants],
    );
    const reset = (): void => {
        const fresh = variantRow();
        setTitle('');
        setBrand('');
        setDescription('');
        setCategorySlug('');
        setHighlights([textRow()]);
        setImages([textRow()]);
        setVariants([fresh]);
        setDefaultKey(fresh.key);
        setAttempted(false);
    };
    const patchVariant = (key: string, patch: Partial<VariantDraft>): void =>
        setVariants((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    const removeVariant = (key: string): void => {
        const next = variants.filter((row) => row.key !== key);
        const first = next[0];
        if (first === undefined) return;
        setVariants(next);
        if (key === defaultKey) setDefaultKey(first.key);
    };
    const submit = (): void => {
        setAttempted(true);
        if (hasErrors(errors)) return;
        const rows: NewProductVariantInput[] = variants.map((variant) => {
            const sku = variant.sku.trim();
            return {
                label: variant.label.trim(),
                ...(sku === '' ? {} : { sku }),
                priceMinorUnits: rupeesToMinorUnits(Number(variant.price)),
                mrpMinorUnits:
                    variant.mrp.trim() === '' ? null : rupeesToMinorUnits(Number(variant.mrp)),
                stock: Number.parseInt(variant.stock, 10),
                isDefault: variant.key === defaultKey,
            };
        });
        const highlightValues = highlights
            .map((row) => row.value.trim())
            .filter((v) => v.length > 0);
        const imageValues = images.map((row) => row.value.trim()).filter((v) => v.length > 0);
        const body: NewProductInput = {
            ...(sellerId === null ? {} : { sellerId }),
            title: title.trim(),
            brand: brand.trim(),
            description: description.trim(),
            categorySlug,
            ...(imageValues.length > 0 ? { images: imageValues } : {}),
            ...(highlightValues.length > 0 ? { highlights: highlightValues } : {}),
            variants: rows,
        };
        create.mutate(body, { onSuccess: reset });
    };
    const failure = failureMessage(create.error);
    const published = create.isSuccess ? create.data.product : null;
    return (
        <div className="space-y-5">
            {published !== null && (
                <Published
                    product={published}
                    onAnother={create.reset}
                />
            )}

            <form
                className="space-y-5"
                noValidate
                onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}
            >
                <section className="card p-5">
                    <h2 className="section-title">What you are selling</h2>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block">
                            <span className="label">Title</span>
                            <input
                                className="input"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Aurora 65W GaN Charger"
                            />
                            {attempted && <FieldError message={errors.title} />}
                        </label>

                        <label className="block">
                            <span className="label">Brand</span>
                            <input
                                className="input"
                                value={brand}
                                onChange={(e) => setBrand(e.target.value)}
                                placeholder="Aurora"
                            />
                            {attempted && <FieldError message={errors.brand} />}
                        </label>

                        <label className="block">
                            <span className="label">Department</span>
                            <select
                                className="input"
                                value={categorySlug}
                                onChange={(e) => setCategorySlug(e.target.value)}
                            >
                                <option value="">Choose a department…</option>
                                {categories.map((category) => (
                                    <option
                                        key={category.id}
                                        value={category.slug}
                                    >
                                        {category.name}
                                    </option>
                                ))}
                            </select>
                            {attempted && <FieldError message={errors.categorySlug} />}
                        </label>

                        <label className="block sm:col-span-2">
                            <span className="label">Description</span>
                            <textarea
                                className="input min-h-[72px] resize-y"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="What the shopper gets, in the words they would search for."
                            />
                            {attempted && <FieldError message={errors.description} />}
                        </label>
                    </div>
                </section>

                <section className="card p-5">
                    <h2 className="section-title">Highlights and images</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        Both are optional and capped at {MAX_LIST_ROWS} rows each — the product page
                        renders highlights as its bullet list and the first image as the card
                        thumbnail.
                    </p>

                    <div className="mt-4 grid gap-5 sm:grid-cols-2">
                        <div>
                            <span className="label">Highlights</span>
                            <div className="space-y-2">
                                {highlights.map((row, index) => (
                                    <div
                                        key={row.key}
                                        className="flex items-center gap-2"
                                    >
                                        <input
                                            className="input"
                                            value={row.value}
                                            onChange={(e) =>
                                                setHighlights((rows) =>
                                                    rows.map((r) =>
                                                        r.key === row.key
                                                            ? { ...r, value: e.target.value }
                                                            : r,
                                                    ),
                                                )
                                            }
                                            placeholder="Charges a laptop and a phone at once"
                                            aria-label={`Highlight ${index + 1}`}
                                        />
                                        <button
                                            type="button"
                                            className="btn-quiet btn-sm"
                                            onClick={() =>
                                                setHighlights((rows) =>
                                                    rows.length === 1
                                                        ? [textRow()]
                                                        : rows.filter((r) => r.key !== row.key),
                                                )
                                            }
                                            aria-label={`Remove highlight ${index + 1}`}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                className="btn-quiet btn-sm mt-2"
                                disabled={highlights.length >= MAX_LIST_ROWS}
                                onClick={() => setHighlights((rows) => [...rows, textRow()])}
                            >
                                Add highlight
                            </button>
                        </div>

                        <div>
                            <span className="label">Image URLs</span>
                            <div className="space-y-2">
                                {images.map((row, index) => (
                                    <div
                                        key={row.key}
                                        className="flex items-center gap-2"
                                    >
                                        <input
                                            className="input font-mono text-xs"
                                            value={row.value}
                                            onChange={(e) =>
                                                setImages((rows) =>
                                                    rows.map((r) =>
                                                        r.key === row.key
                                                            ? { ...r, value: e.target.value }
                                                            : r,
                                                    ),
                                                )
                                            }
                                            placeholder="/media/products/aurora-65w-1.jpg"
                                            aria-label={`Image URL ${index + 1}`}
                                        />
                                        <button
                                            type="button"
                                            className="btn-quiet btn-sm"
                                            onClick={() =>
                                                setImages((rows) =>
                                                    rows.length === 1
                                                        ? [textRow()]
                                                        : rows.filter((r) => r.key !== row.key),
                                                )
                                            }
                                            aria-label={`Remove image URL ${index + 1}`}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <button
                                type="button"
                                className="btn-quiet btn-sm mt-2"
                                disabled={images.length >= MAX_LIST_ROWS}
                                onClick={() => setImages((rows) => [...rows, textRow()])}
                            >
                                Add image
                            </button>
                        </div>
                    </div>
                </section>

                <section className="card p-5">
                    <h2 className="section-title">Variants</h2>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                        Add each buyable option with its price and available stock. The default row
                        opens first on the product page.
                    </p>

                    <div className="mt-4 space-y-3">
                        {variants.map((variant, index) => {
                            const rowErrors = errors.variants[variant.key];
                            return (
                                <div
                                    key={variant.key}
                                    className="rounded-lg border border-slate-200 p-3"
                                >
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                        <label className="block">
                                            <span className="label">Label</span>
                                            <input
                                                className="input"
                                                value={variant.label}
                                                onChange={(e) =>
                                                    patchVariant(variant.key, {
                                                        label: e.target.value,
                                                    })
                                                }
                                                placeholder="256 GB / Midnight"
                                            />
                                            {attempted && <FieldError message={rowErrors?.label} />}
                                        </label>

                                        <label className="block">
                                            <span className="label">SKU</span>
                                            <input
                                                className="input font-mono text-xs uppercase"
                                                value={variant.sku}
                                                onChange={(e) =>
                                                    patchVariant(variant.key, {
                                                        sku: e.target.value,
                                                    })
                                                }
                                                placeholder="generated from the title"
                                            />
                                            {attempted && <FieldError message={rowErrors?.sku} />}
                                        </label>

                                        <label className="block">
                                            <span className="label">Price (₹)</span>
                                            <input
                                                className="input tabular-nums"
                                                inputMode="decimal"
                                                value={variant.price}
                                                onChange={(e) =>
                                                    patchVariant(variant.key, {
                                                        price: e.target.value,
                                                    })
                                                }
                                                placeholder="2499"
                                            />
                                            {attempted && <FieldError message={rowErrors?.price} />}
                                        </label>

                                        <label className="block">
                                            <span className="label">MRP (₹)</span>
                                            <input
                                                className="input tabular-nums"
                                                inputMode="decimal"
                                                value={variant.mrp}
                                                onChange={(e) =>
                                                    patchVariant(variant.key, {
                                                        mrp: e.target.value,
                                                    })
                                                }
                                                placeholder="none"
                                            />
                                            {attempted && <FieldError message={rowErrors?.mrp} />}
                                        </label>

                                        <label className="block">
                                            <span className="label">Stock</span>
                                            <input
                                                className="input tabular-nums"
                                                inputMode="numeric"
                                                value={variant.stock}
                                                onChange={(e) =>
                                                    patchVariant(variant.key, {
                                                        stock: e.target.value,
                                                    })
                                                }
                                            />
                                            {attempted && <FieldError message={rowErrors?.stock} />}
                                        </label>

                                        <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
                                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                                <input
                                                    type="radio"
                                                    name="default-variant"
                                                    className="h-3.5 w-3.5 accent-accent"
                                                    checked={variant.key === defaultKey}
                                                    onChange={() => setDefaultKey(variant.key)}
                                                />
                                                Default variant
                                            </label>
                                            <button
                                                type="button"
                                                className="btn-quiet btn-sm"
                                                disabled={variants.length === 1}
                                                onClick={() => removeVariant(variant.key)}
                                            >
                                                Remove variant {index + 1}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        className="btn-standard btn-sm mt-3"
                        disabled={variants.length >= MAX_VARIANTS}
                        onClick={() => setVariants((rows) => [...rows, variantRow()])}
                    >
                        Add variant
                    </button>
                </section>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        className="btn-commit"
                        disabled={create.isPending}
                    >
                        {create.isPending ? 'Publishing…' : 'Publish listing'}
                    </button>
                    <button
                        type="button"
                        className="btn-standard"
                        onClick={reset}
                        disabled={create.isPending}
                    >
                        Clear form
                    </button>
                    {attempted && hasErrors(errors) && (
                        <span className="text-sm font-medium text-rose-600">
                            Fix the highlighted fields before publishing.
                        </span>
                    )}
                    {failure !== null && (
                        <span className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
                            {failure}
                        </span>
                    )}
                </div>
            </form>
        </div>
    );
};
const NewProduct = (): JSX.Element => {
    const { user } = useSession();
    const [params, setParams] = useSearchParams();
    const sellerId = params.get('sellerId');
    const allowed = user?.role === 'seller';
    const categories = useQuery({
        queryKey: ['categories'],
        queryFn: () =>
            api.get<{
                categories: CategoryDto[];
            }>('/api/categories'),
        staleTime: 5 * 60 * 1000,
    });
    const products = useSellerProducts(allowed, sellerId);
    return (
        <RoleGate
            roles={['seller']}
            title="List a product"
            subtitle="Create a product listing that shoppers can find across the storefront."
            actions={
                <Link
                    to="/catalog"
                    className="btn-standard"
                >
                    Back to products
                </Link>
            }
            scope={
                products.data === undefined
                    ? undefined
                    : {
                          sellers: products.data.sellers,
                          value: sellerId,
                          allLabel: 'My primary storefront',
                          onChange: (next) => setParams(next === null ? {} : { sellerId: next }),
                      }
            }
        >
            <Form
                sellerId={sellerId}
                categories={categories.data?.categories ?? []}
            />
        </RoleGate>
    );
};
export default NewProduct;
