import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { EmptyState, ErrorState } from '../components/EmptyState';
import {
  FacetSidebar,
  GridSkeleton,
  InfiniteScrollTrigger,
  ListingToolbar,
  PAGE_SIZE,
  ProductGrid,
  productsQueryString,
  readFacetState,
  type CategoryDto,
  type ProductListDto,
} from '../components/ProductRail';
import { ChevronRight } from '../components/icons';
import { api } from '../lib/api';

const Category = (): JSX.Element => {
  const { slug = '' } = useParams<{ slug: string }>();
  const [params, setParams] = useSearchParams();
  const facets = readFacetState(params);

  const patch = (next: Record<string, string>): void => {
    const merged = new URLSearchParams(params);
    merged.delete('page');
    for (const [k, v] of Object.entries(next)) {
      if (v === '') merged.delete(k);
      else merged.set(k, v);
    }
    setParams(merged, { replace: true });
  };

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.get<{ categories: CategoryDto[] }>('/api/categories'),
    staleTime: 5 * 60 * 1000,
  });

  const query = productsQueryString(facets, { category: slug });

  const listing = useInfiniteQuery({
    queryKey: ['products', 'infinite', query],
    queryFn: ({ pageParam }) => api.get<ProductListDto>(`/api/products?${query}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const pageSize = last.pageSize || PAGE_SIZE;
      return last.page * pageSize < last.total ? last.page + 1 : undefined;
    },
  });

  const category = categories.data?.categories.find((c) => c.slug === slug);
  const data = listing.data?.pages[0];
  const products = listing.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4 py-4 md:py-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-13 text-t3">
        <Link to="/" className="link">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="capitalize text-t2">{category?.name ?? slug}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-28 font-semibold capitalize tracking-[-0.02em] text-t1">
          {category?.name ?? slug}
        </h1>
        {data !== undefined && (
          <p className="tnum text-14 text-t2">{data.total.toLocaleString('en-IN')} products</p>
        )}
      </header>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <FacetSidebar
          maxPriceMinorUnits={facets.maxPriceMinorUnits}
          minRating={facets.minRating}
          sellerId={facets.sellerId}
          priceBounds={data?.facets.priceMinorUnits}
          facets={data?.facets}
          onChange={patch}
          onReset={() => setParams(new URLSearchParams(), { replace: true })}
        />

        <div className="min-w-0 flex-1">
          {listing.isPending ? (
            <GridSkeleton />
          ) : listing.error !== null ? (
            <ErrorState
              title="This category did not load"
              error={listing.error}
              onRetry={() => void listing.refetch()}
            />
          ) : data === undefined || products.length === 0 ? (
            <EmptyState
              title="Nothing matches these filters"
              body="Raise the price cap or drop the rating floor to widen the results."
              action={{ to: `/c/${slug}`, label: 'Clear filters' }}
            />
          ) : (
            <div className="card space-y-4 p-4">
              <ListingToolbar
                loaded={products.length}
                total={data.total}
                sort={facets.sort}
                onChange={patch}
              />
              <ProductGrid products={products} />
              <InfiniteScrollTrigger
                hasMore={listing.hasNextPage}
                loading={listing.isFetchingNextPage}
                loaded={products.length}
                total={data.total}
                onLoadMore={() => void listing.fetchNextPage()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Category;
