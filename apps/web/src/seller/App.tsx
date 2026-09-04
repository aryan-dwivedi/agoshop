import { Suspense, lazy, type ReactNode } from 'react';
import { Link, Outlet, Route, Routes } from 'react-router-dom';

import { StudioCommands } from '../components/seller/StudioCommands';
import { RtmProvider } from '../realtime/RtmProvider';
import { SessionProvider, useSession } from '../state/session';
import { SellerLayout } from './SellerLayout';

/**
 * Studio (:5174) — the seller console: today's work, shows and their live-only
 * markdown, catalog, orders, and the audience log.
 *
 * Paths are rebased against this origin: the console does not repeat `/seller` in
 * every URL when the host name already says which surface you are on.
 *
 * The broadcast room and its pre-flight are declared *outside* the shell on purpose.
 * They are the two screens that drop the rail entirely — full-bleed, their own 48–56px
 * controls, `data-room="broadcast"` on their own root — so wrapping them in a padded
 * console column would fight them for the frame.
 */
const Today = lazy(() => import('../pages/seller/Today'));
const Sessions = lazy(() => import('../pages/seller/Sessions'));
const SessionReport = lazy(() => import('../pages/seller/SessionAnalytics'));
const Inventory = lazy(() => import('../pages/seller/Inventory'));
const NewProduct = lazy(() => import('../pages/seller/NewProduct'));
const Orders = lazy(() => import('../pages/seller/Orders'));
const Payouts = lazy(() => import('../pages/seller/Payouts'));
const ModerationLog = lazy(() => import('../pages/seller/ModerationLog'));
const Host = lazy(() => import('../pages/Host'));
const Preflight = lazy(() => import('../pages/studio/Preflight'));

const Loading = (): JSX.Element => (
  <div className="space-y-2 px-4 py-4" aria-busy="true" aria-label="Loading">
    <div className="skeleton h-6 w-56" />
    <div className="skeleton h-4 w-80" />
    <div className="skeleton h-40 w-full" />
  </div>
);

const NotFound = (): JSX.Element => (
  <div className="card animate-fade-in mx-auto mt-12 max-w-md p-5 text-center">
    <p className="text-16 font-semibold text-t1">Nothing lives at this address.</p>
    <p className="mt-1 text-13 leading-relaxed text-t2">
      Shopper pages are on the storefront; this origin only holds Studio.
    </p>
    <Link to="/" className="btn-standard mt-4">
      Back to Today
    </Link>
  </div>
);

/** The rail plus whichever console screen is showing inside it. */
const Console = (): JSX.Element => (
  <SellerLayout>
    <Outlet />
  </SellerLayout>
);

/**
 * Realtime belongs to the Studio origin, not its navigation shell. Broadcast and
 * pre-flight deliberately render without the rail, but the broadcast room still
 * consumes chat through the same provider as the console.
 */
const StudioRealtime = ({ children }: { children: ReactNode }): JSX.Element => {
  const { config, user } = useSession();
  return (
    <RtmProvider appId={config?.agoraAppId ?? null} userId={user?.id ?? null}>
      {children}
    </RtmProvider>
  );
};

export const App = (): JSX.Element => (
  <SessionProvider>
    <StudioRealtime>
      <StudioCommands />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/live/:slug" element={<Host />} />
          <Route path="/live/:slug/preflight" element={<Preflight />} />

          <Route element={<Console />}>
            <Route path="/" element={<Today />} />
            <Route path="/shows" element={<Sessions />} />
            <Route path="/shows/:id/report" element={<SessionReport />} />
            <Route path="/catalog" element={<Inventory />} />
            <Route path="/catalog/new" element={<NewProduct />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/payouts" element={<Payouts />} />
            <Route path="/audience" element={<ModerationLog />} />

            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </StudioRealtime>
  </SessionProvider>
);
