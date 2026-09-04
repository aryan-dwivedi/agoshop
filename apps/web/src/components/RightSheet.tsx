import { useEffect, useId, useRef, type ReactNode } from 'react';
import { create } from 'zustand';

import { CloseIcon } from './icons';

/**
 * The one overlay primitive on Shop.
 *
 * Everything that used to float — the cart, the assistant — is the same right column:
 * 380px beside the page on desktop, a 92dvh bottom sheet under 1024px. Position and
 * size are the only difference between them, so there is one component and one
 * z-index, and a shopper never has two overlays stacked over a running video.
 *
 * Which is why the open sheet is a single value rather than a boolean per surface:
 * the cart and the assistant are mutually exclusive by construction (§7), not by
 * every call site remembering to close the other one.
 */
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

/** Tab-order members: rendered, enabled, and not explicitly removed from the order. */
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
  /** Accessible name. Used as the visible heading too when `title` is omitted. */
  label: string;
  /**
   * Renders the sheet's own 56px header. Omitted when the content brings its own
   * (the assistant's header carries its context and language controls), so the
   * shopper never sees two title rows and two close buttons.
   */
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * The sheet scrolls its own body. Content that owns a scroller — the assistant's
   * transcript above a pinned composer — sets this false and takes the height.
   */
  scroll?: boolean;
  bodyClassName?: string;
}): JSX.Element => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // The trigger lives in the top bar; sending focus back to it is what makes the
  // sheet dismissable without a mouse.
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

  /**
   * Focus goes to the first control unless the content already claimed it — the
   * assistant focuses its composer on mount, and a parent effect runs after the
   * child's, so without this check the sheet would steal the caret back.
   */
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
          <span id={titleId} className="sr-only">
            {label}
          </span>
        ) : (
          <header className="flex h-bar shrink-0 items-center gap-3 border-b border-line px-4">
            <h2 id={titleId} className="section-title min-w-0 flex-1 truncate">
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
          className={`flex min-h-0 flex-1 flex-col ${
            scroll ? 'overflow-y-auto scroll-thin' : 'overflow-hidden'
          } ${bodyClassName}`}
        >
          {children}
        </div>

        {footer !== undefined && <div className="shrink-0 border-t border-line p-4">{footer}</div>}
      </div>
    </div>
  );
};
