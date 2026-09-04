import type { CategoryDto } from './ProductRail';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../lib/api';
import { HeartIcon, PlayIcon, TruckIcon } from './icons';

const ROWS = [
    {
        to: '/live',
        label: 'Live now',
        icon: (
            <span className="flex h-5 w-5 items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-live" />
            </span>
        ),
    },
    {
        to: '/live#watch-again',
        label: 'Replays',
        icon: <PlayIcon className="h-5 w-5 text-t3" />,
    },
    {
        to: '/wishlist',
        label: 'Wishlist',
        icon: <HeartIcon className="h-5 w-5 text-t3" />,
    },
    {
        to: '/orders',
        label: 'Orders',
        icon: <TruckIcon className="h-5 w-5 text-t3" />,
    },
];
const ITEM = 'flex min-h-ctl items-center gap-3 rounded-ctl px-3 text-14 text-t1 hover:bg-surface';
export const BrowsePanel = ({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}): JSX.Element | null => {
    const panelRef = useRef<HTMLDivElement>(null);
    const categories = useQuery({
        queryKey: ['categories'],
        queryFn: () =>
            api.get<{
                categories: CategoryDto[];
            }>('/api/categories'),
        staleTime: 5 * 60 * 1000,
    });
    useEffect(() => {
        if (!open) return undefined;
        const opener = document.activeElement as HTMLElement | null;
        return () => opener?.focus?.({ preventScroll: true });
    }, [open]);
    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
                return;
            }
            const panel = panelRef.current;
            if (panel === null) return;
            const all = [...panel.querySelectorAll<HTMLElement>('a,button')];
            if (all.length === 0) return;
            const at = all.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                all[at < 0 ? 0 : (at + 1) % all.length]!.focus();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                all[at <= 0 ? all.length - 1 : at - 1]!.focus();
            } else if (event.key === 'Home') {
                event.preventDefault();
                all[0]!.focus();
            } else if (event.key === 'End') {
                event.preventDefault();
                all[all.length - 1]!.focus();
            }
        };
        const onPointerDown = (event: MouseEvent): void => {
            const panel = panelRef.current;
            if (panel !== null && !panel.contains(event.target as Node)) onClose();
        };
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mousedown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('mousedown', onPointerDown);
        };
    }, [open, onClose]);
    if (!open) return null;
    const list = categories.data?.categories ?? [];
    return (
        <div
            ref={panelRef}
            role="menu"
            aria-label="Browse"
            className="absolute left-0 top-full z-50 mt-2 w-[18.5rem] max-w-[calc(100vw-1.5rem)] animate-slide-down rounded-panel border border-line bg-menu p-2 shadow-sheet max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[4.75rem] max-sm:left-auto max-sm:top-auto max-sm:mt-0 max-sm:w-auto max-sm:max-w-none max-sm:animate-slide-up"
        >
            <p className="eyebrow px-3 pb-1 pt-2">Categories</p>
            {categories.isPending ? (
                <div
                    className="grid gap-1.5 p-2"
                    aria-hidden="true"
                >
                    {[0, 1, 2, 3, 4].map((i) => (
                        <span
                            key={i}
                            className="skeleton h-6"
                        />
                    ))}
                </div>
            ) : (
                <div className="grid">
                    {list.map((c) => (
                        <Link
                            key={c.id}
                            role="menuitem"
                            to={`/c/${c.slug}`}
                            className={ITEM}
                            onClick={onClose}
                        >
                            {c.name}
                        </Link>
                    ))}
                </div>
            )}

            <div className="my-2 border-t border-line" />

            <div className="grid">
                {ROWS.map((row) => (
                    <Link
                        key={row.to}
                        role="menuitem"
                        to={row.to}
                        className={ITEM}
                        onClick={onClose}
                    >
                        {row.icon}
                        {row.label}
                    </Link>
                ))}
            </div>
        </div>
    );
};
