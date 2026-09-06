import type { Role } from '@shop/shared';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import {
    CalendarDays,
    CircleUser,
    PackageSearch,
    PanelLeftClose,
    PanelLeftOpen,
    Radio,
    ReceiptText,
    UsersRound,
    WalletCards,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { MOD_LABEL } from '../components/CommandPalette';
import { ComingSoonBadge, ComingSoonToasts } from '../components/seller/ComingSoon';
import { openCommandPalette } from '../components/seller/StudioCommands';
import { isFeatureLive } from '../components/seller/studioFeatures';
import { api } from '../lib/api';
import { customerUrl } from '../lib/origins';
import { useSellerProducts, useSellerSessions } from '../lib/sellerApi';
import { useServerEvents } from '../lib/useServerEvents';
import { useSession } from '../state/session';

const RAIL_STORAGE_KEY = 'studio.rail.collapsed';

type Section = {
    to: string;
    label: string;
    roles: Role[];
    Icon: LucideIcon;
    exact?: boolean;
    badge?: 'live' | 'low';
    comingSoon?: boolean;
};

const SECTIONS: Section[] = [
    { to: '/', label: 'Today', roles: ['seller'], Icon: CalendarDays, exact: true },
    { to: '/shows', label: 'Shows', roles: ['seller'], Icon: Radio, badge: 'live' },
    {
        to: '/catalog',
        label: 'Catalog',
        roles: ['seller'],
        Icon: PackageSearch,
        badge: 'low',
    },
    { to: '/orders', label: 'Orders', roles: ['seller'], Icon: ReceiptText },
    {
        to: '/payouts',
        label: 'Payouts',
        roles: ['seller'],
        Icon: WalletCards,
        comingSoon: !isFeatureLive('payouts'),
    },
    { to: '/audience', label: 'Audience', roles: ['seller'], Icon: UsersRound },
];

export const SellerLayout = ({ children }: { children: ReactNode }): JSX.Element => {
    const { user } = useSession();
    const { pathname } = useLocation();
    const [collapsed, setCollapsed] = useState(
        () => window.localStorage.getItem(RAIL_STORAGE_KEY) === '1',
    );
    const [accountOpen, setAccountOpen] = useState(false);
    useServerEvents({ enabled: Boolean(user) });
    const account = user !== null && !user.isGuest ? user : null;
    const operator = account?.role === 'seller';
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
        <div
            data-surface="studio"
            className="flex min-h-screen bg-bg text-13 text-t1"
        >
            <ComingSoonToasts />

            <nav
                aria-label="Studio sections"
                className={`sticky top-0 flex h-[100dvh] shrink-0 flex-col border-r border-line bg-elev transition-[width] duration-panel ease-out ${collapsed ? 'w-[60px]' : 'w-[220px]'}`}
            >
                <div
                    className={`flex items-center gap-2.5 px-3 pb-3 pt-4 ${collapsed ? 'justify-center' : ''}`}
                >
                    <NavLink
                        to="/"
                        className="flex min-w-0 items-center gap-2.5"
                        title="agoshop Studio"
                    >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-ctl bg-accent text-13 font-bold text-accent-ink shadow-e1">
                            a
                        </span>
                        {!collapsed && (
                            <span className="min-w-0 truncate font-display text-16 font-semibold tracking-[-0.02em] text-t1">
                                Studio
                            </span>
                        )}
                    </NavLink>
                </div>

                <div className="px-2.5 pb-2">
                    <button
                        type="button"
                        onClick={openCommandPalette}
                        className="flex h-8 w-full items-center gap-2 rounded-ctl border border-line bg-surface px-2.5 text-11 text-t2 transition duration-ctl hover:border-line-ctl hover:text-t1"
                        title={`Command palette (${MOD_LABEL}K)`}
                    >
                        <span className="shrink-0 rounded-chip bg-bg px-1.5 py-0.5 text-11 font-semibold tabular-nums text-t3">
                            {MOD_LABEL}K
                        </span>
                        {!collapsed && <span className="truncate">Search</span>}
                    </button>
                </div>

                <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 scroll-thin">
                    {visible.map((section) => {
                        const active =
                            section.exact === true
                                ? pathname === '/'
                                : pathname.startsWith(section.to);
                        const count =
                            section.badge === 'live'
                                ? liveCount
                                : section.badge === 'low'
                                  ? lowCount
                                  : 0;
                        return (
                            <li key={section.to}>
                                <NavLink
                                    to={section.to}
                                    aria-current={active ? 'page' : undefined}
                                    title={collapsed ? section.label : undefined}
                                    className={`flex h-9 items-center gap-2.5 rounded-ctl px-2.5 transition duration-ctl ${active ? 'bg-accent-wash font-semibold text-accent-text' : 'text-t2 hover:bg-surface hover:text-t1'} ${collapsed ? 'justify-center' : ''}`}
                                >
                                    <section.Icon
                                        className={`h-4 w-4 shrink-0 ${active ? 'text-accent' : ''}`}
                                        strokeWidth={active ? 2.2 : 1.8}
                                    />
                                    {!collapsed && (
                                        <span className="min-w-0 flex-1 truncate text-13">
                                            {section.label}
                                        </span>
                                    )}
                                    {!collapsed && section.comingSoon === true && (
                                        <ComingSoonBadge />
                                    )}
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
                                            {collapsed ? '•' : count}
                                        </span>
                                    )}
                                </NavLink>
                            </li>
                        );
                    })}
                </ul>

                <div className="relative border-t border-line px-2.5 py-2.5">
                    {accountOpen && (
                        <div
                            className="animate-slide-up absolute bottom-full left-2.5 z-30 mb-1.5 w-52 overflow-hidden rounded-ctl border border-line bg-menu shadow-sheet"
                            role="menu"
                        >
                            {account === null ? (
                                <p className="px-3 py-2 text-13 text-t2">Not signed in.</p>
                            ) : (
                                <>
                                    <div className="border-b border-line px-3 py-2.5">
                                        <p className="truncate text-13 font-semibold text-t1">
                                            {account.displayName}
                                        </p>
                                        <p className="truncate text-11 text-t3">{account.email}</p>
                                    </div>
                                    <a
                                        href={customerUrl('/')}
                                        target="_blank"
                                        rel="noreferrer"
                                        role="menuitem"
                                        className="flex h-9 items-center px-3 text-13 text-t2 transition duration-ctl hover:bg-surface hover:text-t1"
                                    >
                                        View storefront ↗
                                    </a>
                                    <button
                                        type="button"
                                        role="menuitem"
                                        className="flex h-9 w-full items-center px-3 text-left text-13 text-t2 transition duration-ctl hover:bg-surface hover:text-t1"
                                        onClick={() => {
                                            void api
                                                .post('/api/auth/logout')
                                                .then(() => window.location.reload());
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
                        title="Account"
                        onClick={() => setAccountOpen((value) => !value)}
                        className={`flex h-9 w-full items-center gap-2.5 rounded-ctl px-2.5 text-t2 transition duration-ctl hover:bg-surface hover:text-t1 ${collapsed ? 'justify-center' : ''}`}
                    >
                        <CircleUser
                            className="h-4 w-4 shrink-0"
                            strokeWidth={1.8}
                        />
                        {!collapsed && (
                            <span className="min-w-0 flex-1 truncate text-left text-13">
                                Account
                            </span>
                        )}
                    </button>

                    <button
                        type="button"
                        onClick={() => setCollapsed((value) => !value)}
                        title={`${collapsed ? 'Expand' : 'Collapse'} sidebar (${MOD_LABEL}\\)`}
                        aria-label={`${collapsed ? 'Expand' : 'Collapse'} sidebar`}
                        className={`mt-0.5 flex h-8 w-full items-center gap-2 rounded-ctl px-2.5 text-t3 transition duration-ctl hover:bg-surface hover:text-t1 ${collapsed ? 'justify-center' : ''}`}
                    >
                        {collapsed ? (
                            <PanelLeftOpen
                                className="h-4 w-4"
                                strokeWidth={1.8}
                            />
                        ) : (
                            <PanelLeftClose
                                className="h-4 w-4"
                                strokeWidth={1.8}
                            />
                        )}
                        {!collapsed && <span className="text-11 text-t3">{MOD_LABEL}\</span>}
                    </button>
                </div>
            </nav>

            <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
        </div>
    );
};
