import type { CategoryDto } from '../components/ProductRail';
import type { CartDto, LiveSessionDto, ProductDto, VariantDto } from '@shop/shared';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { buildPriceLadder, formatInr } from '@shop/shared';

import { COMPARE_MAX, CompareDrawer } from '../components/CompareDrawer';
import { ErrorState } from '../components/EmptyState';
import { PincodeCheck } from '../components/PincodeCheck';
import { PriceTag } from '../components/PriceTag';
import { CardImage, defaultVariant } from '../components/ProductCard';
import { ProductRail } from '../components/ProductRail';
import { Rating } from '../components/Rating';
import { ChevronRight, HeartIcon } from '../components/icons';
import { ApiError, api, idempotencyKey } from '../lib/api';
import { useSession } from '../state/session';

const ADD_TO_CART_MESSAGES: Record<string, string> = {
    out_of_stock: 'That variant just sold out. Pick another one or check back shortly.',
    invalid_live_session_product:
        'This product is no longer part of that show, so the live price does not apply to it.',
    rate_limited: 'Too many cart updates in a row. Wait a few seconds and try again.',
};
const SHOW_TIME: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
};
const VariantPrice = ({ variant }: { variant: VariantDto }): JSX.Element => {
    const ladder = buildPriceLadder({
        mrpMinorUnits: variant.mrpMinorUnits,
        shopMinorUnits: variant.priceMinorUnits,
    });
    return (
        <span className="tnum flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-13 font-semibold text-t1">
                {formatInr(ladder.shopMinorUnits)}
            </span>
            {ladder.mrpMinorUnits !== null && (
                <span className="text-11 text-t3 line-through">
                    {formatInr(ladder.mrpMinorUnits)}
                </span>
            )}
        </span>
    );
};
const Gallery = ({ product }: { product: ProductDto }): JSX.Element => {
    const [active, setActive] = useState(0);
    const images = product.images;
    return (
        <div className="space-y-3">
            <div className="card overflow-hidden p-3">
                {images.length === 0 ? (
                    <CardImage
                        product={product}
                        className="aspect-[4/5] w-full rounded-ctl"
                    />
                ) : (
                    <div className="aspect-[4/5] w-full overflow-hidden rounded-ctl bg-[#fff]">
                        <img
                            src={images[Math.min(active, images.length - 1)]}
                            alt={product.title}
                            className="h-full w-full object-contain"
                        />
                    </div>
                )}
            </div>
            {images.length > 1 && (
                <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
                    {images.map((src, i) => (
                        <button
                            key={src}
                            type="button"
                            onClick={() => setActive(i)}
                            aria-label={`View image ${i + 1}`}
                            aria-current={i === active}
                            className={`h-16 w-16 shrink-0 overflow-hidden rounded-ctl border bg-[#fff] transition duration-ctl ${i === active ? 'border-accent' : 'border-line hover:border-line-ctl'}`}
                        >
                            <img
                                src={src}
                                alt=""
                                className="h-full w-full object-contain"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
const Product = (): JSX.Element => {
    const { slug = '' } = useParams<{
        slug: string;
    }>();
    const { user } = useSession();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [variantId, setVariantId] = useState<string | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [compareIds, setCompareIds] = useState<string[]>([]);
    const [addError, setAddError] = useState<string | null>(null);
    const [added, setAdded] = useState<{
        discountMinorUnits: number;
    } | null>(null);
    const productQuery = useQuery({
        queryKey: ['product', slug],
        queryFn: () =>
            api.get<{
                product: ProductDto;
            }>(`/api/products/${encodeURIComponent(slug)}`),
    });
    const product = productQuery.data?.product;
    const shows = useQuery({
        queryKey: ['sessions', 'live-scheduled'],
        queryFn: () =>
            api.get<{
                sessions: LiveSessionDto[];
            }>('/api/sessions?status=live,scheduled'),
        refetchInterval: 30 * 1000,
    });
    const wishlist = useQuery({
        queryKey: ['wishlist'],
        queryFn: () =>
            api.get<{
                items: ProductDto[];
            }>('/api/wishlist'),
        enabled: user !== null,
    });
    const similar = useQuery({
        queryKey: ['recommendations', 'similar', product?.id],
        queryFn: () =>
            api.get<{
                items: ProductDto[];
            }>(
                `/api/recommendations?basedOn=similar&productId=${encodeURIComponent(product?.id ?? '')}&limit=8`,
            ),
        enabled: product !== undefined,
    });
    const categories = useQuery({
        queryKey: ['categories'],
        queryFn: () =>
            api.get<{
                categories: CategoryDto[];
            }>('/api/categories'),
        staleTime: 5 * 60 * 1000,
    });
    const show = useMemo(() => {
        if (product === undefined) return undefined;
        const featuring = (shows.data?.sessions ?? []).filter((s) =>
            s.products.some((p) => p.productId === product.id),
        );
        return featuring.find((s) => s.status === 'live') ?? featuring[0];
    }, [shows.data, product]);
    const liveShow = show?.status === 'live' ? show : undefined;
    const variant: VariantDto | undefined =
        product === undefined
            ? undefined
            : (product.variants.find((v) => v.id === variantId) ?? defaultVariant(product));
    const wishlisted = wishlist.data?.items.some((p) => p.id === product?.id) ?? false;
    const addToCart = useMutation({
        mutationFn: async (): Promise<CartDto> => {
            if (product === undefined || variant === undefined)
                throw new Error('Product not loaded');
            return api.post<CartDto>(
                '/api/cart/items',
                {
                    productId: product.id,
                    variantId: variant.id,
                    quantity,
                    ...(liveShow === undefined ? {} : { liveSessionId: liveShow.id }),
                    surface: 'browse',
                },
                { 'Idempotency-Key': idempotencyKey() },
            );
        },
        onSuccess: (cart) => {
            setAddError(null);
            setAdded({ discountMinorUnits: cart.totals.discountMinorUnits });
            queryClient.setQueryData(['cart'], cart);
        },
        onError: (err) => {
            setAdded(null);
            setAddError(
                err instanceof ApiError
                    ? (ADD_TO_CART_MESSAGES[err.code] ?? 'Could not add that to your cart.')
                    : 'Could not reach the cart just now.',
            );
        },
    });
    const toggleWishlist = useMutation({
        mutationFn: async (): Promise<void> => {
            if (product === undefined) return;
            if (wishlisted)
                await api.del(`/api/wishlist?productId=${encodeURIComponent(product.id)}`);
            else await api.post('/api/wishlist', { productId: product.id });
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
            void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
            void queryClient.invalidateQueries({ queryKey: ['cart'] });
        },
    });
    const toggleCompare = (productId: string): void => {
        setCompareIds((prev) =>
            prev.includes(productId)
                ? prev.filter((id) => id !== productId)
                : prev.length >= COMPARE_MAX
                  ? prev
                  : [...prev, productId],
        );
    };
    if (productQuery.isPending) {
        return (
            <div
                data-theme="light"
                className="grid gap-5 py-4 md:py-6 lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)]"
            >
                <div className="skeleton aspect-[4/5]" />
                <div className="space-y-3">
                    <div className="skeleton h-4 w-1/3" />
                    <div className="skeleton h-8 w-4/5" />
                    <div className="skeleton h-5 w-1/4" />
                    <div className="skeleton h-16 w-1/2" />
                    <div className="skeleton h-ctl-lg w-full" />
                    <div className="skeleton h-40 w-full" />
                </div>
            </div>
        );
    }
    if (productQuery.error !== null || product === undefined || variant === undefined) {
        return (
            <div
                data-theme="light"
                className="py-4 md:py-6"
            >
                <ErrorState
                    title="Product unavailable"
                    error={
                        productQuery.error ?? new Error('This product has no purchasable variant.')
                    }
                    onRetry={() => void productQuery.refetch()}
                />
            </div>
        );
    }
    const specs = Object.entries(product.specs);
    const variantAttrs = Object.entries(variant.attrs);
    const sessionProduct = liveShow?.products.find((p) => p.productId === product.id);
    const ladder = buildPriceLadder({
        mrpMinorUnits: variant.mrpMinorUnits,
        shopMinorUnits: variant.priceMinorUnits,
        liveMinorUnits:
            sessionProduct !== undefined &&
            sessionProduct.price.shopMinorUnits === variant.priceMinorUnits
                ? sessionProduct.price.liveMinorUnits
                : null,
    });
    const soldOut = variant.stock === 0;
    return (
        <div
            data-theme="light"
            className="space-y-8 py-4 md:py-6"
        >
            <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-1 text-13 text-t3"
            >
                <Link
                    to="/"
                    className="link"
                >
                    Home
                </Link>
                <ChevronRight className="h-3.5 w-3.5" />
                <Link
                    to={`/c/${product.categorySlug}`}
                    className="link"
                >
                    {categories.data?.categories.find((c) => c.slug === product.categorySlug)
                        ?.name ?? product.categorySlug}
                </Link>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="truncate text-t2">{product.title}</span>
            </nav>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,42%)_minmax(0,1fr)] xl:grid-cols-[minmax(0,36%)_minmax(0,1fr)_20rem]">
                <div className="lg:sticky lg:top-[calc(var(--bar-h)+1rem)] lg:self-start">
                    <Gallery product={product} />
                </div>

                <div className="min-w-0 space-y-4">
                    <div>
                        <p className="eyebrow">
                            {product.brand} · sold by {product.sellerName}
                        </p>
                        <h1 className="mt-1.5 text-28 font-semibold tracking-[-0.02em] text-t1">
                            {product.title}
                        </h1>
                        <div className="mt-2 flex flex-wrap items-center gap-3 border-b border-line pb-3">
                            <Rating
                                value={product.rating}
                                count={product.ratingCount}
                            />
                            {specs.length > 0 && (
                                <a
                                    href="#specifications"
                                    className="link text-13"
                                >
                                    Specifications
                                </a>
                            )}
                        </div>
                    </div>

                    {product.variants.length > 1 && (
                        <section className="card overflow-hidden">
                            <div className="border-b border-line px-4 py-3">
                                <h2 className="section-title">Choose a variant</h2>
                            </div>
                            <div
                                className="flex flex-wrap gap-2 p-4"
                                role="group"
                                aria-label="Variant"
                            >
                                {product.variants.map((v) => (
                                    <button
                                        key={v.id}
                                        type="button"
                                        aria-pressed={v.id === variant.id}
                                        onClick={() => {
                                            setVariantId(v.id);
                                            setQuantity(1);
                                            setAdded(null);
                                            setAddError(null);
                                        }}
                                        className={`flex min-h-ctl min-w-[7.5rem] flex-col items-start justify-center gap-0.5 rounded-ctl border px-3 py-2 text-left transition duration-ctl ${
                                            v.id === variant.id
                                                ? 'border-accent bg-accent-wash'
                                                : 'border-line-ctl hover:border-accent'
                                        } ${v.stock === 0 ? 'opacity-60' : ''}`}
                                    >
                                        <span className="text-13 font-medium text-t1">
                                            {v.label}
                                        </span>
                                        <VariantPrice variant={v} />
                                        {v.stock === 0 && (
                                            <span className="text-11 text-danger">Sold out</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    <section className="card overflow-hidden">
                        <div className="border-b border-line px-4 py-3">
                            <h2 className="section-title">About this item</h2>
                        </div>
                        <div className="p-4">
                            {product.highlights.length === 0 ? (
                                <p className="text-14 text-t2">
                                    This seller has not published highlights for this product.
                                </p>
                            ) : (
                                <ul className="list-disc space-y-2 pl-5 text-14 text-t2 marker:text-t3">
                                    {product.highlights.map((h) => (
                                        <li key={h}>{h}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                        <div className="border-t border-line p-4">
                            <p className="eyebrow">Description</p>
                            <p className="mt-1.5 text-14 text-t2">{product.description}</p>
                        </div>
                    </section>

                    <section
                        id="specifications"
                        className="card overflow-hidden"
                    >
                        <div className="border-b border-line px-4 py-3">
                            <h2 className="section-title">Specifications</h2>
                        </div>
                        {specs.length === 0 ? (
                            <p className="p-4 text-14 text-t2">No specifications published.</p>
                        ) : (
                            <table className="w-full text-14">
                                <tbody className="divide-y divide-line">
                                    {specs.map(([k, v]) => (
                                        <tr key={k}>
                                            <th className="w-2/5 px-4 py-2.5 text-left align-top font-medium text-t2">
                                                {k}
                                            </th>
                                            <td className="px-4 py-2.5 text-t1">{v}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </section>
                </div>

                <div className="space-y-3 lg:col-span-2 xl:col-span-1 xl:sticky xl:top-[calc(var(--bar-h)+1rem)] xl:self-start">
                    <div className="card space-y-4 p-4">
                        {show !== undefined && (
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line pb-3 text-14">
                                {liveShow !== undefined ? (
                                    <>
                                        <span className="inline-flex items-center gap-1.5 font-medium text-live">
                                            <span
                                                aria-hidden
                                                className="h-2 w-2 animate-breathe rounded-full bg-live"
                                            />
                                            Live now
                                        </span>
                                        <span className="min-w-0 text-t2">
                                            in “{show.title}”
                                            {ladder.liveMinorUnits !== null && (
                                                <span className="tnum text-t1">
                                                    {' '}
                                                    — {formatInr(ladder.liveMinorUnits)} while live
                                                </span>
                                            )}
                                        </span>
                                        <Link
                                            to={`/live/${show.slug}`}
                                            className="btn-standard btn-sm ml-auto"
                                        >
                                            Watch
                                        </Link>
                                    </>
                                ) : (
                                    <>
                                        <span className="min-w-0 text-t2">
                                            In “{show.title}”
                                            {show.scheduledFor !== null &&
                                                `, ${new Date(show.scheduledFor).toLocaleString('en-IN', SHOW_TIME)}`}
                                        </span>
                                        <Link
                                            to={`/live/${show.slug}`}
                                            className="btn-standard btn-sm ml-auto"
                                        >
                                            Open the show
                                        </Link>
                                    </>
                                )}
                            </div>
                        )}

                        <PriceTag
                            ladder={ladder}
                            size="lg"
                        />

                        <p
                            className={`text-14 font-medium ${soldOut ? 'text-danger' : 'text-success'}`}
                        >
                            {soldOut ? 'Out of stock' : 'In stock'}
                        </p>

                        <label className="flex items-center gap-2 text-13 font-medium text-t2">
                            Qty
                            <select
                                className="tnum h-ctl rounded-ctl border border-line-ctl bg-transparent px-2 text-14 text-t1 focus:border-accent"
                                value={quantity}
                                onChange={(e) => setQuantity(Number(e.target.value))}
                                disabled={soldOut}
                            >
                                {Array.from(
                                    { length: Math.min(5, Math.max(1, variant.stock)) },
                                    (_, i) => i + 1,
                                ).map((n) => (
                                    <option
                                        key={n}
                                        value={n}
                                    >
                                        {n}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div className="space-y-2">
                            {user === null ? (
                                <Link
                                    to={`/login?next=/p/${product.slug}`}
                                    className="btn-commit btn-lg w-full"
                                >
                                    Sign in to add to cart
                                </Link>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        className="btn-commit btn-lg w-full"
                                        disabled={soldOut || addToCart.isPending}
                                        onClick={() => addToCart.mutate()}
                                    >
                                        {addToCart.isPending
                                            ? 'Adding…'
                                            : soldOut
                                              ? 'Out of stock'
                                              : 'Add to cart'}
                                    </button>
                                    <button
                                        type="button"
                                        className="btn-quiet w-full"
                                        disabled={soldOut || addToCart.isPending}
                                        onClick={() => {
                                            addToCart.mutateAsync().then(
                                                () => navigate('/checkout'),
                                                () => undefined,
                                            );
                                        }}
                                    >
                                        Buy now
                                    </button>
                                </>
                            )}

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="btn-standard flex-1"
                                    disabled={user === null || toggleWishlist.isPending}
                                    onClick={() => toggleWishlist.mutate()}
                                    aria-pressed={wishlisted}
                                    title={
                                        user === null ? 'Sign in to use your wishlist' : undefined
                                    }
                                >
                                    <HeartIcon
                                        className={`h-4 w-4 ${wishlisted ? 'text-live' : 'text-t3'}`}
                                        filled={wishlisted}
                                    />
                                    {wishlisted ? 'Wishlisted' : 'Wishlist'}
                                </button>
                                <button
                                    type="button"
                                    className={`${compareIds.includes(product.id) ? 'chip-active' : 'chip'} flex-1 justify-center`}
                                    onClick={() => toggleCompare(product.id)}
                                    aria-pressed={compareIds.includes(product.id)}
                                >
                                    Compare
                                </button>
                            </div>
                        </div>

                        {addError !== null && (
                            <p
                                role="alert"
                                className="rounded-ctl bg-live-wash px-3 py-2 text-14 text-danger"
                            >
                                {addError}
                            </p>
                        )}

                        {added !== null && (
                            <p
                                role="status"
                                className="rounded-ctl bg-success-wash px-3 py-2 text-14 font-medium text-success"
                            >
                                Added to cart
                                {added.discountMinorUnits > 0 && (
                                    <span className="tnum font-normal text-t2">
                                        {' '}
                                        — {formatInr(added.discountMinorUnits)} off applied
                                    </span>
                                )}
                                .{' '}
                                <Link
                                    to="/cart"
                                    className="link font-medium"
                                >
                                    Open cart
                                </Link>
                            </p>
                        )}

                        {toggleWishlist.error !== null && (
                            <p
                                role="alert"
                                className="rounded-ctl bg-live-wash px-3 py-2 text-14 text-danger"
                            >
                                We could not update your wishlist. Try again.
                            </p>
                        )}

                        <dl className="divide-y divide-line border-t border-line text-13">
                            <div className="flex justify-between gap-3 py-2">
                                <dt className="text-t2">SKU</dt>
                                <dd className="tnum font-medium text-t1">{variant.sku}</dd>
                            </div>
                            {variantAttrs.map(([k, v]) => (
                                <div
                                    key={k}
                                    className="flex justify-between gap-3 py-2"
                                >
                                    <dt className="text-t2">{k}</dt>
                                    <dd className="font-medium text-t1">{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    <PincodeCheck defaultPincode={user?.defaultPincode ?? null} />
                </div>
            </div>

            <ProductRail
                title="Similar products"
                subtitle="Same category, nearest price band"
                to={`/c/${product.categorySlug}`}
                products={similar.data?.items.filter((p) => p.id !== product.id)}
                isLoading={similar.isPending}
                error={similar.error}
                onRetry={() => void similar.refetch()}
                emptyTitle="No close alternatives"
                emptyBody="Nothing else in this category sits in the same price band yet. Browse the full category to see everything."
                badgeFor={(p) =>
                    compareIds.includes(p.id) ? (
                        <span className="badge-accent">Comparing</span>
                    ) : null
                }
            />

            {similar.data !== undefined && similar.data.items.length > 0 && (
                <section className="card overflow-hidden">
                    <div className="border-b border-line px-4 py-3">
                        <h2 className="section-title">Add to comparison</h2>
                    </div>
                    <div className="flex flex-wrap gap-2 p-4">
                        {similar.data.items
                            .filter((p) => p.id !== product.id)
                            .map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => toggleCompare(p.id)}
                                    disabled={
                                        !compareIds.includes(p.id) &&
                                        compareIds.length >= COMPARE_MAX
                                    }
                                    aria-pressed={compareIds.includes(p.id)}
                                    className={`${compareIds.includes(p.id) ? 'chip-active' : 'chip'} disabled:opacity-40`}
                                >
                                    {p.title}
                                </button>
                            ))}
                    </div>
                </section>
            )}

            <CompareDrawer
                ids={compareIds}
                onRemove={(id) => setCompareIds((prev) => prev.filter((x) => x !== id))}
                onClear={() => setCompareIds([])}
            />
        </div>
    );
};
export default Product;
