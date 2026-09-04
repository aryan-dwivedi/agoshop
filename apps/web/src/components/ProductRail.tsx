import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProductDto } from '@shop/shared';
import { EmptyState, ErrorState } from './EmptyState';
import { ProductCard } from './ProductCard';
import { STAR_PATH } from './Rating';
import { ChevronDown, ChevronLeft, ChevronRight } from './icons';
export type CategoryDto = {
    id: string;
    slug: string;
    name: string;
    imageUrl: string | null;
};
export type ProductFacetsDto = {
    categories: {
        slug: string;
        name: string;
        count: number;
    }[];
    sellers: {
        id: string;
        name: string;
        count: number;
    }[];
    priceMinorUnits: {
        min: number;
        max: number;
    };
    ratingBuckets: {
        minRating: number;
        count: number;
    }[];
};
export type ProductListDto = {
    items: ProductDto[];
    page: number;
    pageSize: number;
    total: number;
    facets: ProductFacetsDto;
};
export type ProductSort = 'relevance' | 'price_asc' | 'price_desc' | 'rating';
export const SORT_LABELS: {
    value: ProductSort;
    label: string;
}[] = [
    { value: 'relevance', label: 'Featured' },
    { value: 'price_asc', label: 'Price: low to high' },
    { value: 'price_desc', label: 'Price: high to low' },
    { value: 'rating', label: 'Best rated' },
];
export const PAGE_SIZE = 12;
export type ListingFacetState = {
    maxPriceMinorUnits: string;
    minRating: string;
    sellerId: string;
    sort: ProductSort;
};
export const readFacetState = (params: URLSearchParams): ListingFacetState => {
    const sort = params.get('sort');
    return {
        maxPriceMinorUnits: params.get('maxPriceMinorUnits') ?? '',
        minRating: params.get('minRating') ?? '',
        sellerId: params.get('sellerId') ?? '',
        sort: SORT_LABELS.some((s) => s.value === sort) ? (sort as ProductSort) : 'relevance',
    };
};
export const productsQueryString = (facets: ListingFacetState, extra: {
    category?: string;
    q?: string;
}): string => {
    const query = new URLSearchParams({
        sort: facets.sort,
        pageSize: String(PAGE_SIZE),
    });
    if (extra.category !== undefined)
        query.set('category', extra.category);
    if (extra.q !== undefined && extra.q.length > 0)
        query.set('q', extra.q);
    if (facets.maxPriceMinorUnits !== '') {
        query.set('maxPriceMinorUnits', facets.maxPriceMinorUnits);
    }
    if (facets.minRating !== '')
        query.set('minRating', facets.minRating);
    if (facets.sellerId !== '')
        query.set('sellerId', facets.sellerId);
    return query.toString();
};
export const SectionHeader = ({ title, subtitle, to, toLabel, children, }: {
    title: string;
    subtitle?: string;
    to?: string;
    toLabel?: string;
    children?: ReactNode;
}): JSX.Element => (<div className="flex items-center justify-between gap-4 px-5 pb-2 pt-5">
    <div className="min-w-0">
      <h2 className="section-title truncate">{title}</h2>
      {subtitle !== undefined && <p className="text-13 text-t2">{subtitle}</p>}
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {children}
      {to !== undefined && (<Link to={to} className="link whitespace-nowrap text-13">
          {toLabel ?? 'See all'} →
        </Link>)}
    </div>
  </div>);
const TileSkeleton = (): JSX.Element => (<div className="card overflow-hidden">
    <div className="aspect-[4/3] w-full animate-pulse bg-surface"/>
    <div className="space-y-2 p-3">
      <div className="skeleton h-3 w-1/3"/>
      <div className="skeleton h-3 w-full"/>
      <div className="skeleton h-4 w-1/2"/>
    </div>
  </div>);
export const ProductRail = ({ title, subtitle, to, toLabel, products, isLoading, error, onRetry, emptyTitle, emptyBody, badgeFor, }: {
    title: string;
    subtitle?: string;
    to?: string;
    toLabel?: string;
    products: ProductDto[] | undefined;
    isLoading: boolean;
    error: Error | null;
    onRetry?: () => void;
    emptyTitle: string;
    emptyBody: string;
    badgeFor?: (product: ProductDto) => ReactNode;
}): JSX.Element => {
    const scroller = useRef<HTMLDivElement>(null);
    const nudge = (direction: -1 | 1): void => {
        const el = scroller.current;
        if (el)
            el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.85), behavior: 'smooth' });
    };
    return (<section className="overflow-hidden rounded-panel bg-surface">
      <SectionHeader title={title} subtitle={subtitle} to={to} toLabel={toLabel}>
        {products !== undefined && products.length > 4 && (<span className="hidden items-center gap-1 sm:flex">
            <button type="button" aria-label={`Scroll ${title} left`} className="rounded-full border border-line p-1 text-t2 transition duration-ctl hover:border-line-ctl hover:text-t1" onClick={() => nudge(-1)}>
              <ChevronLeft className="h-4 w-4"/>
            </button>
            <button type="button" aria-label={`Scroll ${title} right`} className="rounded-full border border-line p-1 text-t2 transition duration-ctl hover:border-line-ctl hover:text-t1" onClick={() => nudge(1)}>
              <ChevronRight className="h-4 w-4"/>
            </button>
          </span>)}
      </SectionHeader>

      <div className="p-3 md:p-4">
        {isLoading ? (<div className="flex gap-3 overflow-hidden">
            {[0, 1, 2, 3, 4, 5].map((i) => (<div key={i} className="w-[11.5rem] shrink-0 sm:w-[12.5rem]">
                <TileSkeleton />
              </div>))}
          </div>) : error !== null ? (<ErrorState title={`${title} did not load`} error={error} onRetry={onRetry}/>) : products === undefined || products.length === 0 ? (<EmptyState title={emptyTitle} body={emptyBody}/>) : (<div ref={scroller} className="scroll-none flex snap-x gap-2 overflow-x-auto">
            {products.map((p) => (<div key={p.id} className="w-[11.5rem] shrink-0 snap-start sm:w-[13rem]">
                <ProductCard product={p} badge={badgeFor?.(p)}/>
              </div>))}
          </div>)}
      </div>
    </section>);
};
export const ProductGrid = ({ products, compare, badgeFor, }: {
    products: ProductDto[];
    compare?: {
        ids: string[];
        onToggle: (productId: string) => void;
        max: number;
    };
    badgeFor?: (product: ProductDto) => ReactNode;
}): JSX.Element => (<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {products.map((p) => (<ProductCard key={p.id} product={p} badge={badgeFor?.(p)} compare={compare === undefined
            ? undefined
            : {
                selected: compare.ids.includes(p.id),
                onToggle: compare.onToggle,
                disabled: compare.ids.length >= compare.max,
            }}/>))}
  </div>);
export const GridSkeleton = (): JSX.Element => (<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
    {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (<TileSkeleton key={i}/>))}
  </div>);
const RATING_CHOICES = [
    { value: '4.5', label: '4.5 and up' },
    { value: '4', label: '4 and up' },
    { value: '3.5', label: '3.5 and up' },
    { value: '3', label: '3 and up' },
];
const PRICE_STEPS_INR = [500, 1000, 2000, 5000, 10000, 25000, 50000, 100000];
const buildPriceBrackets = (maxMinor: number): {
    label: string;
    value: string;
}[] => {
    const ceiling = Math.ceil(maxMinor / 100);
    return PRICE_STEPS_INR.filter((step) => step < ceiling)
        .slice(0, 7)
        .map((step) => ({
        label: `Up to ₹${step.toLocaleString('en-IN')}`,
        value: String(step * 100),
    }));
};
const FilterStars = ({ filled }: {
    filled: number;
}): JSX.Element => (<span className="inline-flex items-center gap-px" aria-hidden="true">
    {[0, 1, 2, 3, 4].map((i) => (<svg key={i} width="14" height="14" viewBox="0 0 20 20">
        <path d={STAR_PATH} className={i < filled ? 'fill-accent-text' : 'fill-line'}/>
      </svg>))}
  </span>);
const FilterSection = ({ title, children, }: {
    title: string;
    children: ReactNode;
}): JSX.Element => (<section className="border-b border-line px-4 py-3 last:border-b-0">
    <h3 className="text-13 font-semibold text-t1">{title}</h3>
    <div className="mt-2">{children}</div>
  </section>);
const FacetChip = ({ selected, onSelect, children, }: {
    selected: boolean;
    onSelect: () => void;
    children: ReactNode;
}): JSX.Element => (<button type="button" aria-pressed={selected} onClick={onSelect} className={selected ? 'chip-active' : 'chip'}>
    {children}
  </button>);
export const FacetSidebar = ({ maxPriceMinorUnits, minRating, sellerId, priceBounds, facets, onChange, onReset, showCategories = false, }: {
    maxPriceMinorUnits: string;
    minRating: string;
    sellerId: string;
    priceBounds: {
        min: number;
        max: number;
    } | undefined;
    facets: ProductFacetsDto | undefined;
    onChange: (patch: Record<string, string>) => void;
    onReset: () => void;
    showCategories?: boolean;
}): JSX.Element => {
    const [open, setOpen] = useState(false);
    const [customMax, setCustomMax] = useState('');
    const priceBrackets = priceBounds === undefined ? [] : buildPriceBrackets(priceBounds.max);
    const panel = (<div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-14 font-semibold text-t1">Filters</h2>
        <button type="button" onClick={onReset} className="link text-13">
          Clear all
        </button>
      </div>

      <FilterSection title="Price">
        {priceBounds === undefined ? (<div className="flex flex-wrap gap-1.5">
            {[0, 1, 2].map((i) => (<div key={i} className="skeleton h-7 w-20"/>))}
          </div>) : (<div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <FacetChip selected={maxPriceMinorUnits === ''} onSelect={() => onChange({ maxPriceMinorUnits: '' })}>
                Any price
              </FacetChip>
              {priceBrackets.map((bracket) => (<FacetChip key={bracket.value} selected={maxPriceMinorUnits === bracket.value} onSelect={() => onChange({ maxPriceMinorUnits: bracket.value })}>
                  {bracket.label}
                </FacetChip>))}
            </div>
            <form className="flex items-center gap-1.5" onSubmit={(e) => {
                e.preventDefault();
                const parsed = Number(customMax.replace(/[^\d]/g, ''));
                if (!Number.isFinite(parsed) || parsed <= 0)
                    return;
                onChange({ maxPriceMinorUnits: String(parsed * 100) });
            }}>
              <label className="sr-only" htmlFor="facet-max-price">
                Maximum price in rupees
              </label>
              <input id="facet-max-price" type="text" inputMode="numeric" placeholder="Max ₹" value={customMax} onChange={(e) => setCustomMax(e.target.value)} className="input tnum"/>
              <button type="submit" className="btn-standard shrink-0">
                Go
              </button>
            </form>
          </div>)}
      </FilterSection>

      <FilterSection title="Rating">
        <div className="flex flex-wrap gap-1.5">
          <FacetChip selected={minRating === ''} onSelect={() => onChange({ minRating: '' })}>
            Any rating
          </FacetChip>
          {RATING_CHOICES.map((choice) => (<FacetChip key={choice.value} selected={minRating === choice.value} onSelect={() => onChange({ minRating: choice.value })}>
              <FilterStars filled={Math.min(5, Math.floor(Number(choice.value)))}/>
              <span className="tnum">{choice.label}</span>
            </FacetChip>))}
        </div>
      </FilterSection>

      {facets !== undefined && facets.sellers.length > 1 && (<FilterSection title="Seller">
          <div className="flex flex-wrap gap-1.5">
            <FacetChip selected={sellerId === ''} onSelect={() => onChange({ sellerId: '' })}>
              Any seller
            </FacetChip>
            {facets.sellers.map((seller) => (<FacetChip key={seller.id} selected={sellerId === seller.id} onSelect={() => onChange({ sellerId: seller.id })}>
                {seller.name}
                <span className="tnum text-t3">({seller.count})</span>
              </FacetChip>))}
          </div>
        </FilterSection>)}

      {showCategories && facets !== undefined && facets.categories.length > 1 && (<FilterSection title="Category">
          <div className="space-y-1">
            {facets.categories.map((category) => (<Link key={category.slug} to={`/c/${category.slug}`} className="link flex items-center justify-between gap-2 py-1 text-13">
                <span>{category.name}</span>
                <span className="tnum text-t3">({category.count})</span>
              </Link>))}
          </div>
        </FilterSection>)}
    </div>);
    return (<aside className="w-full shrink-0 lg:w-56 xl:w-64">
      <button type="button" className="btn-standard mb-3 w-full lg:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Filters
        <ChevronDown className={`h-4 w-4 transition duration-ctl ${open ? 'rotate-180' : ''}`}/>
      </button>
      <div className={`${open ? 'block' : 'hidden'} lg:block`}>{panel}</div>
    </aside>);
};
export const ListingToolbar = ({ loaded, total, sort, onChange, }: {
    loaded: number;
    total: number;
    sort: ProductSort;
    onChange: (patch: Record<string, string>) => void;
}): JSX.Element => (<div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
    <p className="text-14 text-t2">
      {total === 0 ? ('No results') : (<>
          Showing <span className="tnum font-medium text-t1">{loaded.toLocaleString('en-IN')}</span>{' '}
          of <span className="tnum">{total.toLocaleString('en-IN')}</span> products
        </>)}
    </p>
    <label className="flex items-center gap-2 text-14 text-t2">
      <span className="whitespace-nowrap">Sort by</span>
      <select className="h-ctl rounded-ctl border border-line-ctl bg-transparent px-3 text-14 text-t1 focus:border-accent" value={sort} onChange={(e) => onChange({ sort: e.target.value })}>
        {SORT_LABELS.map((option) => (<option key={option.value} value={option.value}>
            {option.label}
          </option>))}
      </select>
    </label>
  </div>);
export const InfiniteScrollTrigger = ({ hasMore, loading, loaded, total, onLoadMore, }: {
    hasMore: boolean;
    loading: boolean;
    loaded: number;
    total: number;
    onLoadMore: () => void;
}): JSX.Element => {
    const triggerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const node = triggerRef.current;
        if (!node || !hasMore || loading || typeof IntersectionObserver === 'undefined')
            return;
        const observer = new IntersectionObserver(([entry]) => {
            if (entry?.isIntersecting)
                onLoadMore();
        }, { rootMargin: '500px 0px' });
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loading, onLoadMore]);
    return (<div ref={triggerRef} className="flex min-h-20 flex-col items-center justify-center gap-2 pt-4">
      {loading ? (<>
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent"/>
          <span role="status" className="text-13 text-t3">
            Loading more products…
          </span>
        </>) : hasMore ? (<button type="button" className="btn-standard btn-sm" onClick={onLoadMore}>
          Load more products
        </button>) : (<p className="tnum text-13 text-t3">
          All {Math.min(loaded, total).toLocaleString('en-IN')} products loaded
        </p>)}
    </div>);
};
