import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  formatInr,
  type LiveSessionDto,
} from '@shop/shared';

import { AssistantPanel } from '../ai/AssistantPanel';
import { useAssistantSurface } from '../ai/assistantSurface';
import { api } from '../lib/api';
import { useCart } from '../hooks/useCart';
import { sellerUrl } from '../lib/origins';
import { useServerEvents } from '../lib/useServerEvents';
import { RtmProvider } from '../realtime/RtmProvider';
import { useSession } from '../state/session';
import { BrowsePanel } from './BrowsePanel';
import { CartSheet } from './CartSheet';
import { MobileTabBar } from './MobileTabBar';
import { OfflineBar } from './OfflineBar';
import { RightSheet, useSheet } from './RightSheet';
import { AskIcon, CartIcon, ChevronDown, MenuIcon, PinIcon, SearchIcon, UserIcon } from './icons';

/**
 * Retail shell: a high-contrast blue utility bar, a compact department rail, and
 * one search field that remains the visual anchor. Account, live, assistant and cart
 * actions stay visible without competing with search.
 *
 * Browse and account menus remain anchored to their triggers. Cart and assistant
 * still share one right-sheet primitive; Ask Ago's floating smile is only another
 * entry point into that same mutually exclusive sheet.
 */

/** Menu rows: one shape for Browse and the account menu. */
const MENU_ITEM =
  'flex min-h-ctl w-full items-center gap-3 rounded-ctl px-3 text-14 text-t1 hover:bg-surface';

/** Anchored under its trigger on desktop; lifted above the tab bar on a phone. */
const MENU_PANEL =
  'absolute right-0 top-full z-50 mt-2 w-[17.5rem] animate-slide-down rounded-panel border border-line bg-menu p-2 shadow-sheet max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[4.75rem] max-sm:left-auto max-sm:top-auto max-sm:mt-0 max-sm:w-auto max-sm:animate-slide-up';

const Wordmark = (): JSX.Element => (
  <Link to="/" aria-label="agoshop home" className="flex shrink-0 items-center gap-2 text-white">
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="h-8 w-8 text-[#ffc220]"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
    >
      <path d="M16 3v7M16 22v7M3 16h7M22 16h7M6.8 6.8l5 5M20.2 20.2l5 5" />
    </svg>
    <span className="font-display text-23 font-bold tracking-[-0.04em]">
      ago<span className="text-[#ffc220]">shop</span>
    </span>
  </Link>
);

const SearchField = ({
  className = '',
  autoFocus = false,
  onSubmitted,
}: {
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: () => void;
}): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const [term, setTerm] = useState('');

  // The bar is mounted once for the whole app, so a new search route means a new term.
  useEffect(() => {
    if (location.pathname !== '/search') return;
    setTerm(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.pathname, location.search]);

  return (
    <form
      role="search"
      className={`min-w-0 items-center ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        navigate(`/search?${new URLSearchParams({ q: term.trim() }).toString()}`);
        onSubmitted?.();
      }}
    >
      <label className="relative flex min-w-0 flex-1 items-center rounded-full bg-white p-1 shadow-sm">
        <span className="sr-only">Search products, shows, creators</span>
        <input
          name="q"
          value={term}
          autoFocus={autoFocus}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search everything at AgoShop"
          className="h-10 min-w-0 flex-1 rounded-full bg-transparent px-4 text-14 text-[#001e60] outline-none placeholder:text-[#53657d]"
        />
        <button
          type="submit"
          aria-label="Search"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#004f9a] text-white transition hover:bg-[#003b73]"
        >
          <SearchIcon className="h-4 w-4" />
        </button>
      </label>
    </form>
  );
};

const AccountMenu = ({
  open,
  onClose,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onAsk: () => void;
}): JSX.Element | null => {
  const { user } = useSession();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent): void => {
      const panel = panelRef.current;
      const target = event.target as HTMLElement;
      // A trigger's own click already toggles: closing here first would make the
      // avatar and the `You` tab reopen the menu they were meant to dismiss.
      if (target.closest('[data-menu-trigger="account"]') !== null) return;
      if (panel !== null && !panel.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  // A guest is a real `users` row, so `user` alone does not mean "has an account".
  const account = user !== null && !user.isGuest ? user : null;
  const operator = user?.role === 'seller';

  return (
    <div ref={panelRef} role="menu" aria-label="Account" className={MENU_PANEL}>
      {account === null ? (
        <Link to="/login" role="menuitem" className={MENU_ITEM} onClick={onClose}>
          Sign in
        </Link>
      ) : (
        <p className="truncate px-3 pb-2 pt-1 text-13 text-t3">{account.displayName}</p>
      )}

      {/* §7: on a phone the assistant's entry point is this menu's first row. */}
      <button
        type="button"
        role="menuitem"
        className={`${MENU_ITEM} sm:hidden`}
        onClick={() => {
          onClose();
          onAsk();
        }}
      >
        <AskIcon className="h-5 w-5 text-t3" />
        Ask
      </button>

      <Link to="/orders" role="menuitem" className={MENU_ITEM} onClick={onClose}>
        Orders
      </Link>
      <Link to="/wishlist" role="menuitem" className={MENU_ITEM} onClick={onClose}>
        Wishlist
      </Link>


      {operator && (
        /* A different origin (:5174), so a document navigation beside the storefront
           rather than a router push that would only rewrite this origin's path. */
        <a
          href={sellerUrl('/')}
          target="_blank"
          rel="noreferrer"
          role="menuitem"
          className={MENU_ITEM}
          onClick={onClose}
        >
          Studio ↗
        </a>
      )}

      {account !== null && (
        <button
          type="button"
          role="menuitem"
          className={MENU_ITEM}
          onClick={() => {
            void api.post('/api/auth/logout').then(() => window.location.reload());
          }}
        >
          Sign out
        </button>
      )}
    </div>
  );
};

export const Layout = ({ children }: { children: ReactNode }): JSX.Element => {
  const { user, config } = useSession();
  const location = useLocation();
  const immersiveLive =
    location.pathname.startsWith('/live/') && location.pathname.split('/').length === 3;

  const sheet = useSheet((s) => s.open);
  const openSheet = useSheet((s) => s.openSheet);
  const toggleSheet = useSheet((s) => s.toggleSheet);
  const closeSheet = useSheet((s) => s.closeSheet);

  const [browseOpen, setBrowseOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  /** A live room or a replay owns the assistant: those surfaces have their own switch. */
  const pageOwned = useAssistantSurface((s) => s.pageOwned);
  const requestOpen = useAssistantSurface((s) => s.requestOpen);
  const browseRequested = useAssistantSurface((s) => s.browseRequested);
  const browseSeedPrompt = useAssistantSurface((s) => s.browseSeedPrompt);
  const consumeBrowseSeed = useAssistantSurface((s) => s.consumeBrowseSeed);
  const handledRequest = useRef(browseRequested);

  // One SSE connection for the app shell: cart total, repricing, order events.
  useServerEvents({ enabled: user !== null });

  const cart = useCart(user !== null);

  // Shares the home page's cache key, so the pill costs no extra request there.
  const liveNow = useQuery({
    queryKey: ['sessions', 'live'],
    queryFn: () => api.get<{ sessions: LiveSessionDto[] }>('/api/sessions?status=live'),
    refetchInterval: 30_000,
  });

  const cartCount = cart.data?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;
  const cartTotal = cart.data?.totals.totalMinorUnits ?? 0;
  const liveSessions = liveNow.data?.sessions ?? [];
  const liveCount = liveSessions.length;
  // One session on air: the pill is a shortcut into that room, not into a list of one.
  const liveTo = liveCount === 1 ? `/live/${liveSessions[0]!.slug}` : '/live';

  // Another surface asked for the assistant (a home example chip). On a browse
  // surface that is this sheet; inside a room the page already owns the panel.
  useEffect(() => {
    if (browseRequested === handledRequest.current) return;
    handledRequest.current = browseRequested;
    if (pageOwned) requestOpen();
    else openSheet('assistant');
  }, [browseRequested, pageOwned, requestOpen, openSheet]);

  // Navigating is a decision to leave: nothing anchored survives the route change.
  useEffect(() => {
    setBrowseOpen(false);
    setAccountOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  return (
    <RtmProvider appId={config?.agoraAppId ?? null} userId={user?.id ?? null}>
      <div
        className={`flex min-h-screen flex-col ${
          immersiveLive ? 'h-dvh min-h-0 overflow-hidden' : ''
        }`}
      >
        <header className="sticky top-0 z-40 shrink-0 shadow-[0_2px_8px_rgb(0_30_96/0.14)]">
          <div className="bg-[#0071dc]">
            <div
              className={`relative mx-auto flex h-[72px] items-center gap-2 px-3 md:gap-3 md:px-5 ${
                immersiveLive ? 'max-w-none' : 'max-w-page'
              }`}
            >
              <Wordmark />

              <Link
                to="/search"
                className="hidden h-12 shrink-0 items-center gap-2 rounded-full px-3 text-white transition hover:bg-[#0053a6] xl:flex"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                  <PinIcon className="h-4 w-4" />
                </span>
                <span className="max-w-[10rem] text-left text-11 leading-tight">
                  <span className="block font-semibold">
                    {user?.defaultPincode ? 'Delivery to your PIN' : 'Set delivery location'}
                  </span>
                  <span className="block truncate text-white/80">
                    {user?.defaultPincode ?? 'See what arrives fastest'}
                  </span>
                </span>
              </Link>

              <SearchField className="hidden flex-1 sm:flex" />
              <span className="flex-1 sm:hidden" />

              {liveCount > 0 && (
                <Link
                  to={liveTo}
                  className="hidden shrink-0 items-center gap-2 rounded-full px-3 py-2 text-13 font-semibold text-white transition hover:bg-[#0053a6] md:flex"
                >
                  <span className="h-2 w-2 rounded-full bg-[#ffc220] animate-breathe" />
                  <span className="tnum">{liveCount} live</span>
                </Link>
              )}

              {!pageOwned && (
                <button
                  type="button"
                  onClick={() => toggleSheet('assistant')}
                  aria-expanded={sheet === 'assistant'}
                  aria-label="Ask Ago"
                  className="hidden h-11 shrink-0 items-center gap-2 rounded-full px-3 text-13 font-semibold text-white transition hover:bg-[#0053a6] sm:flex"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#ffc220] text-[#001e60]">
                    <AskIcon className="h-4 w-4" />
                  </span>
                  <span className="hidden lg:inline">Ask Ago</span>
                </button>
              )}

              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setAccountOpen((v) => !v)}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  aria-label="Account menu"
                  className="flex h-11 items-center gap-2 rounded-full px-2 text-white transition hover:bg-[#0053a6]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/40 text-13 font-bold">
                    {user !== null && !user.isGuest ? (
                      user.displayName.trim().charAt(0).toUpperCase()
                    ) : (
                      <UserIcon className="h-4 w-4" />
                    )}
                  </span>
                  <span className="hidden text-left text-11 leading-tight lg:block">
                    <span className="block text-white/80">
                      {user !== null && !user.isGuest ? 'Welcome back' : 'Sign in'}
                    </span>
                    <span className="block font-semibold">Account</span>
                  </span>
                </button>
                <AccountMenu
                  open={accountOpen}
                  onClose={() => setAccountOpen(false)}
                  onAsk={() => openSheet('assistant')}
                />
              </div>

              <button
                type="button"
                onClick={() => toggleSheet('cart')}
                aria-expanded={sheet === 'cart'}
                aria-label={`Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
                className="relative hidden h-11 shrink-0 items-center gap-2 rounded-full px-3 text-white transition hover:bg-[#0053a6] sm:flex"
              >
                <CartIcon className="h-6 w-6" />
                <span className="hidden text-left text-11 leading-tight lg:block">
                  <span className="block text-white/80">{cartCount} items</span>
                  <span className="tnum block font-semibold">{formatInr(cartTotal)}</span>
                </span>
                {cartCount > 0 && (
                  <span className="tnum absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ffc220] px-1 text-11 font-bold text-[#001e60]">
                    {cartCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white hover:bg-[#0053a6] sm:hidden"
              >
                <SearchIcon className="h-5 w-5" />
              </button>

              {searchOpen && (
                <div className="absolute inset-0 z-10 flex items-center gap-2 bg-[#0071dc] px-3 sm:hidden">
                  <SearchField
                    className="flex flex-1"
                    autoFocus
                    onSubmitted={() => setSearchOpen(false)}
                  />
                  <button
                    type="button"
                    className="h-10 shrink-0 rounded-full px-2 text-13 font-semibold text-white"
                    onClick={() => setSearchOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="hidden border-b border-[#d5e5f5] bg-white sm:block">
            <nav
              aria-label="Main navigation"
              className={`relative mx-auto flex h-11 items-center gap-1 overflow-x-auto px-3 text-13 font-semibold text-[#001e60] scroll-none md:px-5 ${
                immersiveLive ? 'max-w-none' : 'max-w-page'
              }`}
            >
              <div className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setBrowseOpen((v) => !v)}
                  aria-expanded={browseOpen}
                  aria-haspopup="menu"
                  className="flex h-9 items-center gap-2 rounded-full px-3 transition hover:bg-[#e6f1fc]"
                >
                  <MenuIcon className="h-4 w-4" />
                  Departments
                  <ChevronDown className="h-4 w-4" />
                </button>
                <BrowsePanel open={browseOpen} onClose={() => setBrowseOpen(false)} />
              </div>
              <Link to="/live" className="shrink-0 rounded-full px-3 py-2 hover:bg-[#e6f1fc]">
                Live shopping
              </Link>
              <Link
                to="/search?sort=price_asc"
                className="shrink-0 rounded-full px-3 py-2 hover:bg-[#e6f1fc]"
              >
                Rollbacks &amp; more
              </Link>
              <Link
                to="/search?sort=rating"
                className="shrink-0 rounded-full px-3 py-2 hover:bg-[#e6f1fc]"
              >
                Top rated
              </Link>
              <Link to="/wishlist" className="shrink-0 rounded-full px-3 py-2 hover:bg-[#e6f1fc]">
                My items
              </Link>
              <Link to="/orders" className="shrink-0 rounded-full px-3 py-2 hover:bg-[#e6f1fc]">
                Orders
              </Link>
            </nav>
          </div>

          <div className="sm:hidden">
            <BrowsePanel open={browseOpen} onClose={() => setBrowseOpen(false)} />
          </div>
          <OfflineBar />
        </header>

        <main
          className={
            immersiveLive
              ? 'min-h-0 w-full flex-1 overflow-hidden pb-16 sm:pb-0'
              : 'mx-auto w-full max-w-page flex-1 px-3 pb-16 md:px-5 sm:pb-0'
          }
        >
          {children}
        </main>

        {!immersiveLive && (
          <footer className="mt-10 bg-[#001e60] text-white">
            <div className="mx-auto grid max-w-page gap-6 px-5 py-8 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <Wordmark />
                <p className="mt-2 max-w-md text-13 text-white/70">
                  Everyday value, live product help, and a cart that keeps the final price clear.
                </p>
              </div>
              <nav
                aria-label="Footer"
                className="flex flex-wrap gap-x-5 gap-y-3 text-13 font-semibold"
              >
                <Link to="/" className="hover:underline">
                  Shop
                </Link>
                <Link to="/live" className="hover:underline">
                  Live shopping
                </Link>
                <Link to="/wishlist" className="hover:underline">
                  My items
                </Link>
                <Link to="/orders" className="hover:underline">
                  Orders
                </Link>
              </nav>
            </div>
          </footer>
        )}

        {!pageOwned && sheet !== 'assistant' && (
          <button
            type="button"
            aria-label="Ask Ago"
            className="fixed bottom-[5.25rem] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-[#ffc220] text-[#001e60] shadow-[0_8px_28px_rgb(0_30_96/0.25)] transition hover:-translate-y-1 hover:shadow-[0_12px_34px_rgb(0_30_96/0.3)] sm:bottom-6 sm:right-6 sm:h-16 sm:w-16"
            onClick={() => openSheet('assistant')}
          >
            <svg viewBox="0 0 32 32" className="h-11 w-11" fill="none" aria-hidden="true">
              <circle cx="11" cy="12" r="1.8" fill="currentColor" />
              <circle cx="21" cy="12" r="1.8" fill="currentColor" />
              <path
                d="M8.5 19c2.5 4 12.5 4 15 0"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M16 2.5v3M4.5 7l2.3 2.2M27.5 7l-2.3 2.2"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        <MobileTabBar
          liveTo={liveTo}
          liveCount={liveCount}
          cartCount={cartCount}
          browseOpen={browseOpen}
          onBrowse={() => setBrowseOpen((v) => !v)}
          accountOpen={accountOpen}
          onAccount={() => setAccountOpen((v) => !v)}
        />

        {/* One right column, one thing in it. */}
        {sheet === 'cart' && <CartSheet />}
        {sheet === 'assistant' && (
          <RightSheet label="Ask Ago" onClose={closeSheet} scroll={false}>
            <AssistantPanel
              surface="browse"
              seamless
              className="flex-1"
              onClose={closeSheet}
              seedPrompt={browseSeedPrompt}
              onSeedPromptConsumed={consumeBrowseSeed}
            />
          </RightSheet>
        )}
      </div>
    </RtmProvider>
  );
};
