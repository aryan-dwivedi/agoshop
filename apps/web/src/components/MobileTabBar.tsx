import { useLocation, useNavigate } from 'react-router-dom';

import { useSheet } from './RightSheet';
import { CartIcon, MenuIcon, UserIcon } from './icons';

const TAB = 'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 text-11';
export const MobileTabBar = ({
    liveTo,
    liveCount,
    cartCount,
    browseOpen,
    onBrowse,
    accountOpen,
    onAccount,
}: {
    liveTo: string;
    liveCount: number;
    cartCount: number;
    browseOpen: boolean;
    onBrowse: () => void;
    accountOpen: boolean;
    onAccount: () => void;
}): JSX.Element => {
    const navigate = useNavigate();
    const location = useLocation();
    const sheet = useSheet((s) => s.open);
    const toggleSheet = useSheet((s) => s.toggleSheet);
    const liveActive =
        location.pathname.startsWith('/live') || location.pathname.startsWith('/replay');
    return (
        <nav
            aria-label="Sections"
            className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] sm:hidden"
        >
            <div className="flex h-ctl-lg items-stretch">
                <button
                    type="button"
                    onClick={() => navigate(liveTo)}
                    aria-current={liveActive ? 'page' : undefined}
                    className={`${TAB} ${liveActive ? 'text-accent' : 'text-t2'}`}
                >
                    <span className="flex h-5 items-center">
                        <span
                            className={`h-2 w-2 rounded-full ${liveCount > 0 ? 'bg-live animate-breathe' : 'bg-line-ctl'}`}
                        />
                    </span>
                    Live
                </button>

                <button
                    type="button"
                    onClick={onBrowse}
                    aria-expanded={browseOpen}
                    aria-haspopup="menu"
                    className={`${TAB} ${browseOpen ? 'text-accent' : 'text-t2'}`}
                >
                    <MenuIcon className="h-5 w-5" />
                    Browse
                </button>

                <button
                    type="button"
                    onClick={() => toggleSheet('cart')}
                    aria-expanded={sheet === 'cart'}
                    className={`${TAB} ${sheet === 'cart' ? 'text-accent' : 'text-t2'}`}
                >
                    <span className="relative flex h-5 items-center">
                        <CartIcon className="h-5 w-7" />
                        {cartCount > 0 && (
                            <span className="absolute -right-2 -top-1 rounded-full bg-accent px-1 text-11 font-semibold tabular-nums text-accent-ink">
                                {cartCount}
                            </span>
                        )}
                    </span>
                    Cart
                </button>

                <button
                    type="button"
                    onClick={onAccount}
                    aria-expanded={accountOpen}
                    aria-haspopup="menu"
                    className={`${TAB} ${accountOpen ? 'text-accent' : 'text-t2'}`}
                >
                    <UserIcon className="h-5 w-5" />
                    You
                </button>
            </div>
        </nav>
    );
};
