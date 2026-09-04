import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ProductDto } from '@shop/shared';
import { EmptyState, ErrorState } from '../components/EmptyState';
import { ProductCard } from '../components/ProductCard';
import { ProductRail } from '../components/ProductRail';
import { ChevronRight } from '../components/icons';
import { api } from '../lib/api';
import { useSession } from '../state/session';
const Wishlist = (): JSX.Element => {
    const { user } = useSession();
    const queryClient = useQueryClient();
    const wishlist = useQuery({
        queryKey: ['wishlist'],
        queryFn: () => api.get<{
            items: ProductDto[];
        }>('/api/wishlist'),
        enabled: user !== null,
    });
    const because = useQuery({
        queryKey: ['recommendations', 'wishlist'],
        queryFn: () => api.get<{
            items: ProductDto[];
        }>('/api/recommendations?basedOn=wishlist&limit=8'),
        enabled: user !== null && (wishlist.data?.items.length ?? 0) > 0,
    });
    const remove = useMutation({
        mutationFn: (productId: string) => api.del<{
            removed: boolean;
        }>(`/api/wishlist?productId=${encodeURIComponent(productId)}`),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['wishlist'] });
            void queryClient.invalidateQueries({ queryKey: ['recommendations'] });
            void queryClient.invalidateQueries({ queryKey: ['cart'] });
        },
    });
    if (user === null) {
        return (<div className="py-4 md:py-6">
        <EmptyState title="Sign in to use your wishlist" body="Saved products stay with your account, and the home feed uses them to pick what it shows you." action={{ to: '/login?next=/wishlist', label: 'Sign in' }}/>
      </div>);
    }
    if (wishlist.isPending) {
        return (<div className="grid grid-cols-2 gap-3 py-4 sm:grid-cols-3 md:py-6 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (<div key={i} className="card overflow-hidden">
            <div className="aspect-[4/3] w-full animate-pulse bg-surface"/>
            <div className="space-y-2 p-3">
              <div className="skeleton h-3 w-1/3"/>
              <div className="skeleton h-3 w-full"/>
              <div className="skeleton h-4 w-1/2"/>
            </div>
          </div>))}
      </div>);
    }
    if (wishlist.error !== null) {
        return (<div className="py-4 md:py-6">
        <ErrorState title="Wishlist unavailable" error={wishlist.error} onRetry={() => void wishlist.refetch()}/>
      </div>);
    }
    const items = wishlist.data?.items ?? [];
    return (<div className="space-y-6 py-4 md:py-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-13 text-t3">
        <Link to="/" className="link">
          Home
        </Link>
        <ChevronRight className="h-3.5 w-3.5"/>
        <span className="text-t2">Wishlist</span>
      </nav>

      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-28 font-semibold tracking-[-0.02em] text-t1">Wishlist</h1>
          <p className="mt-0.5 text-14 text-t2">Newest first.</p>
        </div>
        {items.length > 0 && (<p className="tnum text-14 text-t2">
            {items.length} {items.length === 1 ? 'product' : 'products'}
          </p>)}
      </header>

      {remove.error !== null && (<p role="alert" className="rounded-ctl bg-live-wash px-4 py-3 text-14 text-danger">
          We could not remove that. Try again.
        </p>)}

      {items.length === 0 ? (<EmptyState title="Nothing wishlisted yet" body="Open any product and press Wishlist. The home feed then builds a rail from what you saved." action={{ to: '/', label: 'See what is live' }}/>) : (<>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((product) => (<ProductCard key={product.id} product={product} footer={<button type="button" className="btn-quiet btn-sm mt-1 w-full" disabled={remove.isPending} onClick={() => remove.mutate(product.id)}>
                    Remove
                  </button>}/>))}
          </div>

          <ProductRail title="Because you wishlisted" subtitle="Same category, nearest price band" products={because.data?.items.filter((p) => !items.some((w) => w.id === p.id))} isLoading={because.isPending} error={because.error} onRetry={() => void because.refetch()} emptyTitle="No close matches yet" emptyBody="Wishlist a product from another category and this rail widens with alternatives in the same price band."/>
        </>)}
    </div>);
};
export default Wishlist;
