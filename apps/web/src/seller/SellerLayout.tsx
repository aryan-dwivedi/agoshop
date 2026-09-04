import {
  CalendarDays,
  PackageSearch,
  Radio,
  ReceiptText,
  PanelLeftClose,
  PanelLeftOpen,
  UsersRound,
  Settings,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import type { Role } from '@shop/shared';

import { openCommandPalette } from '../components/seller/StudioCommands';
import { MOD_LABEL } from '../components/CommandPalette';
import { api } from '../lib/api';
import { customerUrl } from '../lib/origins';
import { useSellerProducts, useSellerSessions } from '../lib/sellerApi';
import { useServerEvents } from '../lib/useServerEvents';
import { useSession } from '../state/session';

/**
 * Studio's shell (:5174) — a 224px rail, and nothing above the content.
 *
 * The two stacked header bars this replaces were a catalog IA bolted onto an operator
 * tool: a wordmark row, then a horizontal tab strip that ran out of room at six
 * destinations and scrolled sideways at eight. A rail holds every section at once,
 * survives the two new ones (Orders, Payouts), and leaves the full width of the screen
 * to the tables that are the actual work.
 *
 * `data-surface="studio"` is the density switch: it takes `--ctl-h` to 32px and
 * `--row-h` to 32px for everything below it (tokens.css). The broadcast room re-raises
 * both to 48/56 with `data-room="broadcast"` on its own root, which is why it renders
 * outside this shell.
 *
 * The badge counts here are Studio's *only* ambient alerting — shows on air, and stock
 * about to embarrass you on camera. There are deliberately no toasts anywhere in Studio
 * outside the broadcast room: an operator reading a table does not need a notification
 * telling them what the table already says.
 *
 * Every destination belongs to the seller panel. `RoleGate` still checks each page so
 * a customer who types a Studio URL cannot load seller data.
 */

const RAIL_STORAGE_KEY = 'studio.rail.collapsed';

type Section = {
  to: string;
  label: string;
  roles: Role[];
  Icon: LucideIcon;
  /** Only `/` needs exact matching; everything else owns its whole subtree. */
  exact?: boolean;
  badge?: 'live' | 'low';
  children?: { to: string; label: string }[];
};

const SECTIONS: Section[] = [
  { to: '/', label: 'Today', roles: ['seller'], Icon: CalendarDays, exact: true },
  { to: '/shows', label: 'Shows', roles: ['seller'], Icon: Radio, badge: 'live' },
  { to: '/catalog', label: 'Catalog', roles: ['seller'], Icon: PackageSearch, badge: 'low' },
  { to: '/orders', label: 'Orders', roles: ['seller'], Icon: ReceiptText },
  { to: '/payouts', label: 'Payouts', roles: ['seller'], Icon: WalletCards },
  { to: '/audience', label: 'Audience', roles: ['seller'], Icon: UsersRound },
];

export const SellerLayout = ({ children }: { children: ReactNode }): JSX.Element => {
  const { user } = useSession();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(RAIL_STORAGE_KEY) === '1',
  );
  const [accountOpen, setAccountOpen] = useState(false);

  // One SSE connection for the console shell: pricing, session status, moderation.
  useServerEvents({ enabled: Boolean(user) });

  const account = user !== null && !user.isGuest ? user : null;
  const operator = account?.role === 'seller';

  /**
   * Both badge sources are the same cache entries the Shows and Catalog pages read, so
   * an always-mounted rail costs no extra requests once either page has been opened.
   */
  const sessions = useSellerSessions(operator);
  const products = useSellerProducts(operator);
  const liveCount = sessions.data?.sessions.filter((row) => row.status === 'live').length ?? 0;
  const lowCount = products.data?.products.filter((row) => row.lowStock).length ?? 0;

  useEffect(() => {
    window.localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const visible = SECTIONS.filter(
    (section) => account !== null && section.roles.includes(account.role),
  );

  return (
    <div data-surface="studio" className="flex min-h-screen bg-bg text-13 text-t1">
      <nav
        aria-label="Studio sections"
        className={`sticky top-0 flex h-[100dvh] shrink-0 flex-col border-r border-line bg-surface transition-[width] duration-panel ease-out ${
          collapsed ? 'w-16' : 'w-56'
        }`}
      >
        <div
          className={`flex items-center gap-2 px-3 pb-2 pt-3 ${collapsed ? 'justify-center' : ''}`}
        >
          <NavLink
            to="/"
            className="flex min-w-0 items-center gap-2 rounded-ctl"
            title="agoshop Studio"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-chip bg-accent text-13 font-bold text-accent-ink">
              a
            </span>
            {!collapsed && (
              <span className="min-w-0 truncate text-14 font-semibold tracking-[-0.01em] text-t1">
                Studio
              </span>
            )}
          </NavLink>
        </div>

        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={openCommandPalette}
            className="flex h-ctl w-full items-center gap-2 rounded-ctl border border-line px-2 text-13 text-t2 transition duration-ctl hover:border-line-ctl hover:text-t1"
            title={`Command palette (${MOD_LABEL}K)`}
          >
            <span className="shrink-0 text-11 font-semibold tabular-nums">{MOD_LABEL}K</span>
            {!collapsed && <span className="truncate">Command palette</span>}
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-2 scroll-thin">
          {visible.map((section) => {
            const active =
              section.exact === true ? pathname === '/' : pathname.startsWith(section.to);
            const count =
              section.badge === 'live' ? liveCount : section.badge === 'low' ? lowCount : 0;
            return (
              <li key={section.to}>
                <NavLink
                  to={section.children?.[0]?.to ?? section.to}
                  aria-current={active ? 'page' : undefined}
                  title={collapsed ? section.label : undefined}
                  className={`mt-0.5 flex h-ctl items-center gap-2 rounded-ctl px-2 transition duration-ctl ${
                    active ? 'bg-elev font-semibold text-t1' : 'text-t2 hover:bg-elev hover:text-t1'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <section.Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="min-w-0 flex-1 truncate">{section.label}</span>}
                  {count > 0 && section.badge === 'live' && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-11 font-semibold tabular-nums text-live"
                      title={`${count} on air`}
                    >
                      <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-live" />
                      {!collapsed && count}
                    </span>
                  )}
                  {count > 0 && section.badge === 'low' && (
                    <span
                      className="shrink-0 text-11 font-semibold tabular-nums text-accent"
                      title={`${count} low on stock`}
                    >
                      {collapsed ? '•' : `${count} low`}
                    </span>
                  )}
                </NavLink>

                {!collapsed && active && section.children !== undefined && (
                  <ul className="mb-1 ml-6 border-l border-line pl-2">
                    {section.children.map((child) => (
                      <li key={child.to}>
                        <NavLink
                          to={child.to}
                          className={({ isActive }) =>
                            `flex h-ctl items-center rounded-ctl px-2 text-13 transition duration-ctl ${
                              isActive ? 'font-semibold text-t1' : 'text-t2 hover:text-t1'
                            }`
                          }
                        >
                          {child.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>

        <div className="relative border-t border-line px-2 py-2">
          {accountOpen && (
            <div
              className="animate-slide-up absolute bottom-full left-2 z-30 mb-1 w-52 overflow-hidden rounded-ctl border border-line bg-menu shadow-sheet"
              role="menu"
            >
              {account === null ? (
                <p className="px-3 py-2 text-13 text-t2">Not signed in.</p>
              ) : (
                <>
                  <div className="border-b border-line px-3 py-2">
                    <p className="truncate text-13 font-semibold text-t1">{account.displayName}</p>
                    <p className="truncate text-11 text-t3">
                      {account.email} · {account.role}
                    </p>
                  </div>
                  <a
                    href={customerUrl('/')}
                    target="_blank"
                    rel="noreferrer"
                    role="menuitem"
                    className="flex h-ctl items-center px-3 text-13 text-t2 transition duration-ctl hover:bg-surface hover:text-t1"
                  >
                    View storefront ↗
                  </a>
                  <button
                    type="button"
                    role="menuitem"
                    className="flex h-ctl w-full items-center px-3 text-left text-13 text-t2 transition duration-ctl hover:bg-surface hover:text-t1"
                    onClick={() => {
                      void api.post('/api/auth/logout').then(() => window.location.reload());
                    }}
                  >
                    Sign out
                  </button>
                </>
              )}
            </div>
          )}

          <button
            type="button"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            title="Settings"
            onClick={() => setAccountOpen((value) => !value)}
            className={`flex h-ctl w-full items-center gap-2 rounded-ctl px-2 text-t2 transition duration-ctl hover:bg-elev hover:text-t1 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <Settings className="h-4 w-4 shrink-0" strokeWidth={1.8} />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">Settings</span>}
          </button>

          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={`${collapsed ? 'Expand' : 'Collapse'} the rail (${MOD_LABEL}\\)`}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} the rail`}
            className={`mt-0.5 flex h-ctl w-full items-center gap-2 rounded-ctl px-2 text-t3 transition duration-ctl hover:bg-elev hover:text-t1 ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            ) : (
              <PanelLeftClose aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            )}
            {!collapsed && <span className="text-11">{MOD_LABEL}\</span>}
          </button>
        </div>
      </nav>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
};
