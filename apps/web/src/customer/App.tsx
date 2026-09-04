import { Suspense, lazy } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { SessionProvider } from '../state/session';
const Home = lazy(() => import('../pages/Home'));
const Category = lazy(() => import('../pages/Category'));
const Search = lazy(() => import('../pages/Search'));
const Product = lazy(() => import('../pages/Product'));
const Cart = lazy(() => import('../pages/Cart'));
const Checkout = lazy(() => import('../pages/Checkout'));
const Orders = lazy(() => import('../pages/Orders'));
const Wishlist = lazy(() => import('../pages/Wishlist'));
const Login = lazy(() => import('../pages/Login'));
const Creator = lazy(() => import('../pages/Creator'));
const LiveIndex = lazy(() => import('../pages/LiveIndex'));
const Live = lazy(() => import('../pages/Live'));
const Replay = lazy(() => import('../pages/Replay'));
const RouteSkeleton = (): JSX.Element => (<div className="space-y-4 py-4" aria-hidden="true">
    <div className="skeleton h-7 w-56"/>
    <div className="skeleton h-56"/>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (<div key={i} className="skeleton h-64"/>))}
    </div>
  </div>);
const NotFound = (): JSX.Element => (<div className="card animate-fade-in mx-auto mt-10 max-w-md px-6 py-12 text-center">
    <p className="section-title">That page doesn&rsquo;t exist.</p>
    <Link to="/" className="btn-standard mt-5">
      Back to the storefront
    </Link>
  </div>);
export const App = (): JSX.Element => (<SessionProvider>
    <Layout>
      <Suspense fallback={<RouteSkeleton />}>
        <Routes>
          <Route path="/" element={<Home />}/>
          <Route path="/c/:slug" element={<Category />}/>
          <Route path="/search" element={<Search />}/>
          <Route path="/p/:slug" element={<Product />}/>
          <Route path="/cart" element={<Cart />}/>
          <Route path="/checkout" element={<Checkout />}/>
          <Route path="/orders" element={<Orders />}/>
          <Route path="/wishlist" element={<Wishlist />}/>
          <Route path="/login" element={<Login />}/>
          <Route path="/creator/:slug" element={<Creator />}/>

          <Route path="/live" element={<LiveIndex />}/>
          <Route path="/live/:slug" element={<Live />}/>
          <Route path="/replay/:slug" element={<Replay />}/>

          <Route path="*" element={<NotFound />}/>
        </Routes>
      </Suspense>
    </Layout>
  </SessionProvider>);
