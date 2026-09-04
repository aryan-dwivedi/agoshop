import type { CategoryDto, ProductListDto } from '../components/ProductRail';
import type {
    CartDto,
    LiveSessionDto,
    PriceLadderDto,
    ProductDto,
    SessionProductDto,
} from '@shop/shared';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { EmptyState, ErrorState } from '../components/EmptyState';
import { PriceTag } from '../components/PriceTag';
import { ProductRail } from '../components/ProductRail';
import { PlayIcon } from '../components/icons';
import { LivePreviewMedia, SessionCoverImage } from '../components/live/LivePreviewMedia';
import { api, idempotencyKey } from '../lib/api';
import { useSession } from '../state/session';

const RAIL_SIZE = 8;
const VIEWER_FLOOR = 10;
const SHOW_TIME: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
};
const untilLabel = (scheduledFor: string | null, nowMs: number): string | null => {
    if (scheduledFor === null) return null;
    const ms = Date.parse(scheduledFor) - nowMs;
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `Starts in ${Math.max(1, minutes)} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Starts in ${hours} h ${minutes % 60} min`;
    const days = Math.round(hours / 24);
    return `Starts in ${days} ${days === 1 ? 'day' : 'days'}`;
};
const replayLength = (session: LiveSessionDto): string | null => {
    if (session.startedAt === null || session.endedAt === null) return null;
    const minutes = Math.round(
        (Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 60000,
    );
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};
const fromPrice = (session: LiveSessionDto): number | null => {
    if (session.products.length === 0) return null;
    return Math.min(
        ...session.products.map((p) => p.price.liveMinorUnits ?? p.price.shopMinorUnits),
    );
};
const quotedLadder = (product: SessionProductDto, isLive: boolean): PriceLadderDto =>
    isLive
        ? product.price
        : {
              ...product.price,
              liveMinorUnits: null,
              liveDiscountMinorUnits: 0,
              liveOffPercent: null,
          };
type NetworkInformation = {
    effectiveType?: string;
    saveData?: boolean;
    addEventListener?: (type: 'change', listener: () => void) => void;
    removeEventListener?: (type: 'change', listener: () => void) => void;
};
const useHeroAutoplay = (): boolean => {
    const [allowed, setAllowed] = useState(false);
    useEffect(() => {
        const wide = window.matchMedia('(min-width: 768px)');
        const connection = (
            navigator as Navigator & {
                connection?: NetworkInformation;
            }
        ).connection;
        const evaluate = (): void => {
            setAllowed(
                wide.matches && connection?.effectiveType === '4g' && connection.saveData !== true,
            );
        };
        evaluate();
        wide.addEventListener('change', evaluate);
        connection?.addEventListener?.('change', evaluate);
        return () => {
            wide.removeEventListener('change', evaluate);
            connection?.removeEventListener?.('change', evaluate);
        };
    }, []);
    return allowed;
};
const useServerClock = (serverNowMs: number | undefined): number => {
    const [localNow, setLocalNow] = useState(() => Date.now());
    const anchor = useRef<{
        server: number;
        local: number;
    } | null>(null);
    if (serverNowMs !== undefined && anchor.current?.server !== serverNowMs) {
        anchor.current = { server: serverNowMs, local: Date.now() };
    }
    useEffect(() => {
        const id = window.setInterval(() => setLocalNow(Date.now()), 30000);
        return () => window.clearInterval(id);
    }, []);
    const fixed = anchor.current;
    return fixed === null ? localNow : fixed.server + (localNow - fixed.local);
};
const heroClipUrl = (session: LiveSessionDto): string | null => {
    const source = session.liveSourceUrl;
    return session.status === 'live' && source !== null && !source.endsWith('.m3u8')
        ? source
        : null;
};
const HeroPriceCard = ({
    session,
    product,
    isLive,
}: {
    session: LiveSessionDto;
    product: SessionProductDto;
    isLive: boolean;
}): JSX.Element => {
    const { user } = useSession();
    const queryClient = useQueryClient();
    const [added, setAdded] = useState(false);
    const ladder = quotedLadder(product, isLive);
    const payable = ladder.liveMinorUnits ?? ladder.shopMinorUnits;
    const add = useMutation({
        mutationFn: () =>
            api.post<CartDto>(
                '/api/cart/items',
                {
                    productId: product.productId,
                    quantity: 1,
                    ...(isLive ? { liveSessionId: session.id } : {}),
                    surface: 'browse',
                },
                { 'Idempotency-Key': idempotencyKey() },
            ),
        onSuccess: (cart) => {
            queryClient.setQueryData(['cart'], cart);
            setAdded(true);
        },
    });
    return (
        <div className="on-video w-full rounded-ctl p-3">
            <p className="line-clamp-1 text-14 font-medium text-white/80">{product.title}</p>
            <PriceTag
                ladder={ladder}
                size="md"
                onDark
                className="mt-1"
            />

            {user === null ? (
                <Link
                    to={`/login?next=/live/${session.slug}`}
                    className="btn-commit mt-3 w-full"
                >
                    Sign in to add
                </Link>
            ) : (
                <button
                    type="button"
                    className="btn-commit tnum mt-3 w-full"
                    disabled={add.isPending}
                    onClick={() => add.mutate()}
                >
                    {add.isPending
                        ? 'Adding…'
                        : added
                          ? 'Added to cart'
                          : `Add · ${formatInr(payable)}`}
                </button>
            )}

            {add.error !== null && (
                <p
                    role="alert"
                    className="mt-2 text-13 text-danger"
                >
                    That did not go through. Try again from the room.
                </p>
            )}
        </div>
    );
};
const HeroStage = ({
    session,
    kind,
    nowMs,
}: {
    session: LiveSessionDto;
    kind: 'live' | 'scheduled' | 'replay';
    nowMs: number;
}): JSX.Element => {
    const autoplay = useHeroAutoplay();
    const clip = heroClipUrl(session);
    const playing = kind === 'live' && autoplay && clip !== null;
    const featured = session.products.find((p) => p.isFeatured) ?? session.products[0];
    const countdown = kind === 'scheduled' ? untilLabel(session.scheduledFor, nowMs) : null;
    const watch =
        kind === 'replay'
            ? {
                  to: `/replay/${session.slug}`,
                  label: `Watch the replay of ${session.title}`,
              }
            : { to: `/live/${session.slug}`, label: `Open ${session.title}` };
    return (
        <section className="group relative isolate overflow-hidden rounded-panel bg-[#07172e] shadow-sm">
            <div className="grid lg:h-[30rem] lg:grid-cols-[minmax(0,1.55fr)_minmax(20rem,0.8fr)] xl:h-[32rem]">
                <div className="relative aspect-video min-h-0 overflow-hidden bg-black lg:aspect-auto lg:h-full">
                    {session.coverImageUrl !== null && (
                        <img
                            src={session.coverImageUrl}
                            alt=""
                            aria-hidden
                            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
                        />
                    )}

                    <div className="absolute inset-0">
                        {playing ? (
                            <video
                                src={clip ?? undefined}
                                poster={session.coverImageUrl ?? undefined}
                                autoPlay
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                aria-hidden
                                tabIndex={-1}
                                className="h-full w-full object-contain"
                            />
                        ) : kind === 'live' ? (
                            <LivePreviewMedia
                                session={session}
                                variant="hero"
                                className="[&_img]:!object-contain [&_video]:!object-contain"
                            />
                        ) : (
                            <SessionCoverImage
                                session={session}
                                variant="hero"
                                className="!object-contain"
                            />
                        )}
                    </div>

                    <div
                        aria-hidden
                        className="scrim-top pointer-events-none absolute inset-x-0 top-0 h-24"
                    />
                    <div
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 right-0 hidden w-24 bg-gradient-to-r from-transparent to-[#07172e] lg:block"
                    />

                    <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-2 p-3 md:p-4">
                        {kind === 'live' && (
                            <span className="badge-live">
                                <span
                                    aria-hidden
                                    className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink"
                                />
                                Live
                            </span>
                        )}
                        {kind === 'replay' && <span className="on-video pill text-14">Replay</span>}
                        {kind === 'live' && session.viewerCount >= VIEWER_FLOOR && (
                            <span className="on-video pill tnum text-14">
                                {session.viewerCount.toLocaleString('en-IN')} watching
                            </span>
                        )}
                    </div>

                    {!playing && kind !== 'scheduled' && (
                        <Link
                            to={watch.to}
                            aria-label={watch.label}
                            className="on-video absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full transition duration-ctl ease-out hover:scale-105"
                        >
                            <PlayIcon className="h-7 w-7" />
                        </Link>
                    )}
                </div>

                <div className="flex min-w-0 flex-col justify-between gap-6 border-t border-white/10 p-5 text-white lg:min-h-0 lg:border-l lg:border-t-0 lg:p-7">
                    <div>
                        <p className="text-11 font-semibold uppercase tracking-[0.12em] text-white/55">
                            {kind === 'live'
                                ? 'Live now'
                                : kind === 'scheduled'
                                  ? 'Upcoming live show'
                                  : 'Watch again'}
                        </p>
                        <Link
                            to={watch.to}
                            className="mt-2 block"
                        >
                            <h3 className="line-clamp-3 font-display text-23 font-semibold leading-tight tracking-[-0.02em] text-white lg:text-28">
                                {session.title}
                            </h3>
                        </Link>
                        <p className="mt-2 text-14 font-medium text-white/70">
                            {session.hostName} · {session.sellerName}
                        </p>

                        {kind === 'scheduled' && (
                            <div className="mt-5 rounded-ctl border border-white/10 bg-white/[0.06] p-3">
                                <p className="text-11 font-semibold uppercase tracking-[0.08em] text-white/50">
                                    Scheduled for
                                </p>
                                <p className="mt-1 text-14 font-medium text-white">
                                    {session.scheduledFor === null
                                        ? 'Time to be announced'
                                        : new Date(session.scheduledFor).toLocaleString(
                                              'en-IN',
                                              SHOW_TIME,
                                          )}
                                </p>
                                {countdown !== null && (
                                    <p className="tnum mt-1 text-13 font-medium text-accent">
                                        {countdown}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-3">
                        <Link
                            to={watch.to}
                            className="flex h-11 w-full items-center justify-center rounded-full bg-white px-4 text-14 font-semibold text-[#001e60] transition duration-ctl hover:bg-white/90"
                        >
                            {kind === 'live'
                                ? 'Join the live show'
                                : kind === 'scheduled'
                                  ? 'Open show details'
                                  : 'Watch the replay'}
                        </Link>
                        {featured !== undefined && (
                            <HeroPriceCard
                                session={session}
                                product={featured}
                                isLive={kind === 'live'}
                            />
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};
const HeroSkeleton = (): JSX.Element => (
    <div className="aspect-video w-full animate-pulse rounded-panel bg-surface lg:h-[30rem] lg:aspect-auto xl:h-[32rem]" />
);
const SessionTile = ({
    session,
    kind,
    nowMs,
}: {
    session: LiveSessionDto;
    kind: 'live' | 'scheduled' | 'replay';
    nowMs: number;
}): JSX.Element => {
    const from = fromPrice(session);
    const countdown = kind === 'scheduled' ? untilLabel(session.scheduledFor, nowMs) : null;
    const length = kind === 'replay' ? replayLength(session) : null;
    return (
        <Link
            to={kind === 'replay' ? `/replay/${session.slug}` : `/live/${session.slug}`}
            className="card-hover group block w-[15rem] shrink-0 snap-start overflow-hidden sm:w-[17rem]"
        >
            <div className="relative aspect-video overflow-hidden">
                {kind === 'live' ? (
                    <LivePreviewMedia
                        session={session}
                        variant="tile"
                    />
                ) : (
                    <SessionCoverImage
                        session={session}
                        variant="tile"
                    />
                )}
                <div
                    aria-hidden
                    className="scrim-top pointer-events-none absolute inset-x-0 top-0 h-16"
                />
                <div className="absolute inset-x-0 top-0 flex flex-wrap items-center gap-1.5 p-2">
                    {kind === 'live' && (
                        <span className="badge-live">
                            <span
                                aria-hidden
                                className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink"
                            />
                            Live
                        </span>
                    )}
                    {kind === 'live' && session.viewerCount >= VIEWER_FLOOR && (
                        <span className="on-video pill tnum text-14">
                            {session.viewerCount.toLocaleString('en-IN')}
                        </span>
                    )}
                    {length !== null && (
                        <span className="on-video pill tnum text-14">{length}</span>
                    )}
                </div>
            </div>

            <div className="space-y-1 p-3">
                <p className="line-clamp-1 text-14 font-medium text-t1">{session.title}</p>
                <p className="line-clamp-1 text-13 text-t2">
                    {session.hostName} · {session.sellerName}
                </p>
                {countdown !== null && <p className="tnum text-13 text-t2">{countdown}</p>}
                {from !== null && (
                    <p className="tnum text-13 text-t2">
                        From <span className="font-medium text-t1">{formatInr(from)}</span>
                    </p>
                )}
            </div>
        </Link>
    );
};
const SessionRail = ({
    title,
    sessions,
    kind,
    nowMs,
    to,
}: {
    title: string;
    sessions: LiveSessionDto[];
    kind: 'live' | 'scheduled' | 'replay';
    nowMs: number;
    to?: string;
}): JSX.Element | null => {
    if (sessions.length === 0) return null;
    return (
        <section className="card overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
                <h2 className="section-title">
                    {title} <span className="tnum text-t3">({sessions.length})</span>
                </h2>
                {to !== undefined && (
                    <Link
                        to={to}
                        className="link whitespace-nowrap text-13"
                    >
                        See all →
                    </Link>
                )}
            </div>
            <div className="scroll-none flex snap-x gap-3 overflow-x-auto p-4">
                {sessions.map((session) => (
                    <SessionTile
                        key={session.id}
                        session={session}
                        kind={kind}
                        nowMs={nowMs}
                    />
                ))}
            </div>
        </section>
    );
};
const PromoProductTile = ({
    product,
    eyebrow,
    tone,
}: {
    product: ProductDto | undefined;
    eyebrow: string;
    tone: 'yellow' | 'blue';
}): JSX.Element => (
    <article
        className={`relative min-h-[13rem] overflow-hidden rounded-[20px] p-5 ${tone === 'yellow' ? 'bg-[#fff3c4]' : 'bg-[#dff3ff]'}`}
    >
        <div className="relative z-10 max-w-[58%]">
            <p className="text-11 font-bold uppercase tracking-[0.08em] text-[#0053a6]">
                {eyebrow}
            </p>
            {product === undefined ? (
                <div className="mt-3 space-y-2">
                    <div className="h-4 w-28 animate-pulse rounded bg-white/70" />
                    <div className="h-4 w-20 animate-pulse rounded bg-white/70" />
                </div>
            ) : (
                <>
                    <h2 className="mt-2 line-clamp-3 text-19 font-bold leading-tight text-[#001e60]">
                        {product.title}
                    </h2>
                    <p className="tnum mt-2 text-14 font-bold text-[#001e60]">
                        From{' '}
                        {formatInr(
                            product.variants[0]?.priceMinorUnits ?? product.basePriceMinorUnits,
                        )}
                    </p>
                    <Link
                        to={`/p/${product.slug}`}
                        className="mt-4 inline-flex rounded-full bg-[#001e60] px-4 py-2 text-13 font-bold text-white hover:bg-[#004f9a]"
                    >
                        Shop now
                    </Link>
                </>
            )}
        </div>
        {product?.images[0] !== undefined && (
            <img
                src={product.images[0]}
                alt=""
                className="absolute -bottom-3 -right-4 h-[72%] w-[48%] object-contain mix-blend-multiply"
            />
        )}
    </article>
);
const ShopHero = ({
    products,
    isLoading,
}: {
    products: ProductDto[];
    isLoading: boolean;
}): JSX.Element => {
    const lead = products[0];
    return (
        <section
            aria-labelledby="shop-hero-heading"
            className="grid gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(22rem,0.85fr)]"
        >
            <article className="relative min-h-[27rem] overflow-hidden rounded-[20px] bg-[#0071dc] px-6 py-9 text-white md:px-10 md:py-12">
                <div className="relative z-10 max-w-[34rem]">
                    <span className="inline-flex rounded-full bg-[#ffc220] px-3 py-1 text-13 font-bold text-[#001e60]">
                        Prices worth smiling about
                    </span>
                    <h1
                        id="shop-hero-heading"
                        className="mt-4 text-33 font-bold leading-[1.05] tracking-[-0.04em] text-white md:text-40"
                    >
                        Everything you need. All in one cart.
                    </h1>
                    <p className="mt-4 max-w-md text-16 leading-relaxed text-white/90">
                        Explore 500+ marketplace finds, compare sellers, and get live product help
                        before you buy.
                    </p>
                    <div className="mt-6 flex flex-wrap gap-3">
                        <Link
                            to="/search"
                            className="inline-flex h-12 items-center rounded-full bg-white px-6 text-16 font-bold text-[#001e60] transition hover:bg-[#f2f8fd]"
                        >
                            Shop all
                        </Link>
                        <Link
                            to="/search?sort=price_asc"
                            className="inline-flex h-12 items-center rounded-full border-2 border-white px-6 text-16 font-bold text-white transition hover:bg-white/10"
                        >
                            Browse deals
                        </Link>
                    </div>
                </div>

                {isLoading ? (
                    <div className="absolute -bottom-8 right-3 h-64 w-64 animate-pulse rounded-full bg-white/15 md:right-10 md:h-80 md:w-80" />
                ) : lead?.images[0] !== undefined ? (
                    <>
                        <div
                            aria-hidden
                            className="absolute -bottom-24 -right-20 h-[25rem] w-[25rem] rounded-full bg-[#ffc220] md:-right-8 md:h-[30rem] md:w-[30rem]"
                        />
                        <Link
                            to={`/p/${lead.slug}`}
                            aria-label={`Shop ${lead.title}`}
                            className="absolute bottom-0 right-0 hidden h-[88%] w-[43%] items-end justify-center md:flex"
                        >
                            <img
                                src={lead.images[0]}
                                alt=""
                                className="max-h-[88%] w-[90%] object-contain drop-shadow-[0_18px_28px_rgb(0_30_96/0.24)] mix-blend-multiply transition duration-panel hover:scale-[1.03]"
                            />
                        </Link>
                    </>
                ) : null}
            </article>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <PromoProductTile
                    product={products[1]}
                    eyebrow="Top-rated find"
                    tone="yellow"
                />
                <PromoProductTile
                    product={products[2]}
                    eyebrow="Fresh marketplace pick"
                    tone="blue"
                />
            </div>
        </section>
    );
};
const ShoppingPromises = (): JSX.Element => (
    <section
        aria-label="Shopping benefits"
        className="grid overflow-hidden rounded-[20px] border border-line bg-white sm:grid-cols-3"
    >
        {[
            ['500+ searchable finds', 'Products from 20 independent sellers'],
            ['Clear prices', 'Compare offers before adding to cart'],
            ['Help when you need it', 'Ask Ago or join a live demonstration'],
        ].map(([title, body], index) => (
            <div
                key={title}
                className={`flex gap-3 px-5 py-4 ${index > 0 ? 'border-t border-line sm:border-l sm:border-t-0' : ''}`}
            >
                <span
                    aria-hidden
                    className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#ffc220] text-11 font-black text-[#001e60]"
                >
                    ✓
                </span>
                <div>
                    <h2 className="text-14 font-bold text-[#001e60]">{title}</h2>
                    <p className="mt-0.5 text-13 text-t2">{body}</p>
                </div>
            </div>
        ))}
    </section>
);
const CategoryGallery = ({
    categories,
    isLoading,
}: {
    categories: CategoryDto[];
    isLoading: boolean;
}): JSX.Element => (
    <section className="rounded-[20px] bg-[#f2f8fd] px-5 py-6">
        <div className="flex items-end justify-between gap-4">
            <div>
                <p className="text-13 font-bold text-[#0053a6]">Departments</p>
                <h2 className="mt-1 text-23 font-bold text-[#001e60]">Shop by category</h2>
            </div>
            <Link
                to="/search"
                className="text-13 font-bold text-[#0053a6] hover:underline"
            >
                View all
            </Link>
        </div>
        <div className="scroll-none mt-5 flex gap-5 overflow-x-auto pb-1">
            {isLoading
                ? [0, 1, 2, 3, 4].map((i) => (
                      <div
                          key={i}
                          className="h-32 w-28 shrink-0 animate-pulse rounded-panel bg-white/80"
                      />
                  ))
                : categories.map((category) => (
                      <Link
                          key={category.id}
                          to={`/c/${category.slug}`}
                          className="group w-28 shrink-0 text-center"
                      >
                          <span className="mx-auto flex aspect-square w-24 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-white shadow-sm transition duration-panel group-hover:-translate-y-1 group-hover:border-[#ffc220]">
                              {category.imageUrl === null ? (
                                  <span className="px-2 text-13 font-bold text-t2">
                                      {category.name}
                                  </span>
                              ) : (
                                  <img
                                      src={category.imageUrl}
                                      alt=""
                                      loading="lazy"
                                      className="h-full w-full object-contain p-2 mix-blend-multiply"
                                  />
                              )}
                          </span>
                          <span className="mt-2 block text-13 font-bold text-[#001e60] group-hover:underline">
                              {category.name}
                          </span>
                      </Link>
                  ))}
        </div>
    </section>
);
const Recommendations = (): JSX.Element => {
    const { user } = useSession();
    const wishlist = useQuery({
        queryKey: ['wishlist'],
        queryFn: () =>
            api.get<{
                items: ProductDto[];
            }>('/api/wishlist'),
        enabled: user !== null,
    });
    const wishlisted = wishlist.data?.items ?? [];
    const forYou = useQuery({
        queryKey: ['recommendations', 'recently_viewed'],
        queryFn: () =>
            api.get<{
                items: ProductDto[];
            }>(`/api/recommendations?basedOn=recently_viewed&limit=${RAIL_SIZE}`),
        enabled: user !== null,
    });
    const because = useQuery({
        queryKey: ['recommendations', 'wishlist'],
        queryFn: () =>
            api.get<{
                items: ProductDto[];
            }>(`/api/recommendations?basedOn=wishlist&limit=${RAIL_SIZE}`),
        enabled: user !== null && wishlisted.length > 0,
    });
    const topRated = useQuery({
        queryKey: ['products', { sort: 'rating', pageSize: RAIL_SIZE }],
        queryFn: () => api.get<ProductListDto>(`/api/products?sort=rating&pageSize=${RAIL_SIZE}`),
        enabled: user === null,
    });
    if (user === null) {
        return (
            <ProductRail
                title="Highest rated"
                subtitle="Sign in and this rail follows what you look at"
                to="/search?sort=rating"
                products={topRated.data?.items}
                isLoading={topRated.isPending}
                error={topRated.error}
                onRetry={() => void topRated.refetch()}
                emptyTitle="Nothing to show yet"
                emptyBody="The catalog has no products in it right now. The shows above are still on."
            />
        );
    }
    const anchor = wishlisted[0];
    return (
        <>
            <ProductRail
                title="For you"
                subtitle="From what you have looked at and saved"
                products={forYou.data?.items}
                isLoading={forYou.isPending}
                error={forYou.error}
                onRetry={() => void forYou.refetch()}
                emptyTitle="Nothing here yet"
                emptyBody="Open a few products and this rail starts following what you look at."
            />

            {wishlisted.length > 0 && (
                <ProductRail
                    title="Because you wishlisted"
                    subtitle={anchor === undefined ? undefined : `Close to ${anchor.title}`}
                    to="/wishlist"
                    toLabel="Your wishlist"
                    products={because.data?.items}
                    isLoading={because.isPending}
                    error={because.error}
                    onRetry={() => void because.refetch()}
                    emptyTitle="No close matches yet"
                    emptyBody="Wishlist a couple more products and this rail fills with alternatives in the same price band."
                />
            )}
        </>
    );
};
const CategoryRail = ({ category }: { category: CategoryDto }): JSX.Element => {
    const products = useQuery({
        queryKey: ['products', { categorySlug: category.slug, pageSize: RAIL_SIZE }],
        queryFn: () =>
            api.get<ProductListDto>(
                `/api/products?category=${encodeURIComponent(category.slug)}&pageSize=${RAIL_SIZE}`,
            ),
    });
    return (
        <ProductRail
            title={category.name}
            to={`/c/${category.slug}`}
            products={products.data?.items}
            isLoading={products.isPending}
            error={products.error}
            onRetry={() => void products.refetch()}
            emptyTitle={`No ${category.name.toLowerCase()} products yet`}
            emptyBody="Nothing is listed in this category right now."
        />
    );
};
const Home = (): JSX.Element => {
    const shows = useQuery({
        queryKey: ['sessions', 'feed'],
        queryFn: () =>
            api.get<{
                sessions: LiveSessionDto[];
            }>('/api/sessions?status=live,scheduled,ended'),
        refetchInterval: 30 * 1000,
    });
    const categories = useQuery({
        queryKey: ['categories'],
        queryFn: () =>
            api.get<{
                categories: CategoryDto[];
            }>('/api/categories'),
        staleTime: 5 * 60 * 1000,
    });
    const featured = useQuery({
        queryKey: ['products', { sort: 'rating', pageSize: 6 }],
        queryFn: () => api.get<ProductListDto>('/api/products?sort=rating&pageSize=6'),
        staleTime: 5 * 60 * 1000,
    });
    const deals = useQuery({
        queryKey: [
            'products',
            { sort: 'price_asc', maxPriceMinorUnits: 100000, pageSize: RAIL_SIZE },
        ],
        queryFn: () =>
            api.get<ProductListDto>(
                `/api/products?sort=price_asc&maxPriceMinorUnits=100000&pageSize=${RAIL_SIZE}`,
            ),
        staleTime: 5 * 60 * 1000,
    });
    const all = shows.data?.sessions ?? [];
    const nowMs = useServerClock(all[0]?.serverNowMs);
    const live = all.filter((s) => s.status === 'live');
    const scheduled = all.filter((s) => s.status === 'scheduled');
    const replays = all
        .filter((s) => s.status === 'ended' && s.recordingUrl !== null)
        .sort((a, b) => Date.parse(b.endedAt ?? '') - Date.parse(a.endedAt ?? ''));
    const hero = live[0] ?? scheduled[0] ?? replays[0];
    const heroKind =
        live[0] !== undefined ? 'live' : scheduled[0] !== undefined ? 'scheduled' : 'replay';
    const categoryList = categories.data?.categories ?? [];
    return (
        <div className="space-y-8 py-5 md:py-8">
            <ShopHero
                products={featured.data?.items ?? []}
                isLoading={featured.isPending}
            />
            <ShoppingPromises />

            <CategoryGallery
                categories={categoryList}
                isLoading={categories.isPending}
            />
            <ProductRail
                title="Rollback-worthy deals"
                subtitle="Popular marketplace picks under ₹1,000"
                to="/search?sort=price_asc&maxPriceMinorUnits=100000"
                products={deals.data?.items}
                isLoading={deals.isPending}
                error={deals.error}
                onRetry={() => void deals.refetch()}
                emptyTitle="No deals in this price range"
                emptyBody="Browse all products to see the latest seller prices."
            />
            <Recommendations />

            <section
                className="space-y-4"
                aria-labelledby="shop-live-heading"
            >
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="eyebrow text-live">Live shopping</p>
                        <h2
                            id="shop-live-heading"
                            className="mt-1 font-display text-28 font-semibold text-t1"
                        >
                            See it in action
                        </h2>
                        <p className="mt-1 text-14 text-t2">
                            Product demonstrations, live questions, and the same secure cart.
                        </p>
                    </div>
                    <Link
                        to="/live"
                        className="link text-14 font-semibold"
                    >
                        See all shows →
                    </Link>
                </div>

                {shows.isPending ? (
                    <HeroSkeleton />
                ) : shows.error !== null ? (
                    <ErrorState
                        title="Shows did not load"
                        error={shows.error}
                        onRetry={() => void shows.refetch()}
                    />
                ) : hero === undefined ? (
                    <EmptyState
                        title="No shows right now"
                        body="Keep shopping the catalog and check back for upcoming demonstrations."
                        action={{ to: '/search?sort=rating', label: 'Browse products' }}
                    />
                ) : (
                    <HeroStage
                        session={hero}
                        kind={heroKind}
                        nowMs={nowMs}
                    />
                )}

                <SessionRail
                    title="Live now"
                    sessions={live}
                    kind="live"
                    nowMs={nowMs}
                    to={live.length > 1 ? '/live' : undefined}
                />
                <SessionRail
                    title="Starting soon"
                    sessions={scheduled}
                    kind="scheduled"
                    nowMs={nowMs}
                />
                <SessionRail
                    title="Watch again"
                    sessions={replays}
                    kind="replay"
                    nowMs={nowMs}
                />
            </section>

            {categories.error !== null ? (
                <ErrorState
                    title="Categories did not load"
                    error={categories.error}
                    onRetry={() => void categories.refetch()}
                />
            ) : (
                categoryList.map((category) => (
                    <CategoryRail
                        key={category.id}
                        category={category}
                    />
                ))
            )}
        </div>
    );
};
export default Home;
