import type { ReactNode } from 'react';

import { useEffect, useId, useRef } from 'react';
import { create } from 'zustand';

import { CloseIcon } from './icons';

export type SheetName = 'cart' | 'assistant';
type SheetStore = {
    open: SheetName | null;
    openSheet: (name: SheetName) => void;
    toggleSheet: (name: SheetName) => void;
    closeSheet: () => void;
};
export const useSheet = create<SheetStore>((set) => ({
    open: null,
    openSheet: (name) => set({ open: name }),
    toggleSheet: (name) => set((s) => ({ open: s.open === name ? null : name })),
    closeSheet: () => set({ open: null }),
}));
const FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]',
].join(',');
const focusables = (root: HTMLElement): HTMLElement[] =>
    [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.tabIndex >= 0 && el.offsetParent !== null,
    );
export const RightSheet = ({
    label,
    title,
    onClose,
    children,
    footer,
    scroll = true,
    bodyClassName = '',
}: {
    label: string;
    title?: ReactNode;
    onClose: () => void;
    children: ReactNode;
    footer?: ReactNode;
    scroll?: boolean;
    bodyClassName?: string;
}): JSX.Element => {
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();
    useEffect(() => {
        const opener = document.activeElement as HTMLElement | null;
        return () => opener?.focus?.({ preventScroll: true });
    }, []);
    useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previous;
        };
    }, []);
    useEffect(() => {
        const panel = panelRef.current;
        if (panel === null) return;
        if (panel.contains(document.activeElement)) return;
        (focusables(panel)[0] ?? panel).focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            const panel = panelRef.current;
            if (panel === null) return;
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
                return;
            }
            if (event.key !== 'Tab') return;
            const items = focusables(panel);
            if (items.length === 0) {
                event.preventDefault();
                panel.focus({ preventScroll: true });
                return;
            }
            const first = items[0]!;
            const last = items[items.length - 1]!;
            const active = document.activeElement;
            if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && (active === first || !panel.contains(active))) {
                event.preventDefault();
                last.focus();
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        return () => document.removeEventListener('keydown', onKeyDown, true);
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div
                role="presentation"
                aria-hidden="true"
                onClick={onClose}
                className="absolute inset-0 animate-fade-in bg-chip"
            />

            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className="relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-elev shadow-sheet outline-none animate-slide-up lg:mt-0 lg:h-full lg:max-h-none lg:w-sidebar lg:rounded-l-sheet"
            >
                {title === undefined ? (
                    <span
                        id={titleId}
                        className="sr-only"
                    >
                        {label}
                    </span>
                ) : (
                    <header className="flex h-bar shrink-0 items-center gap-3 border-b border-line px-4">
                        <h2
                            id={titleId}
                            className="section-title min-w-0 flex-1 truncate"
                        >
                            {title}
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label={`Close ${label.toLowerCase()}`}
                            className="btn-quiet -mr-2 h-10 w-10 px-0"
                        >
                            <CloseIcon className="h-5 w-5" />
                        </button>
                    </header>
                )}

                <div
                    className={`flex min-h-0 flex-1 flex-col ${scroll ? 'overflow-y-auto scroll-thin' : 'overflow-hidden'} ${bodyClassName}`}
                >
                    {children}
                </div>

                {footer !== undefined && (
                    <div className="shrink-0 border-t border-line p-4">{footer}</div>
                )}
            </div>
        </div>
    );
};
