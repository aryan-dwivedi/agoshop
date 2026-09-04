import type { Role } from '@shop/shared';

import { sellerUrl, supportUrl } from './origins';

/**
 * The two seeded demo identities and the surface each one exists for.
 *
 * A session is one opaque id in a signed httpOnly cookie per *browser*
 * (`middleware/session.ts`), never per tab, so switching persona is browser-wide by
 * construction. The seller opens the console on a different origin (:5174), while
 * the customer journey signs in exactly where it was clicked.
 */

export const DEMO_PASSWORD = 'demo1234';

export type DemoPersona = {
  role: Role;
  email: string;
  label: string;
  blurb: string;
  /**
   * The absolute URL of the console this persona owns, opened in its own tab.
   * `null` → sign in in place. Cross-origin, so it is a document navigation.
   */
  dashboard: string | null;
};

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  {
    role: 'shopper',
    email: 'shopper@demo.test',
    label: 'Customer',
    blurb: 'Cart, checkout, live sessions, the assistant. Starts with one wishlisted product.',
    dashboard: null,
  },
  {
    role: 'seller',
    email: 'seller@demo.test',
    label: 'Seller / host',
    blurb: 'Owns the demo shows: the broadcast room, catalog, audience log and reports.',
    dashboard: sellerUrl('/'),
  },
  {
    role: 'support',
    email: 'support@demo.test',
    label: 'Support agent',
    blurb: 'Handles AI escalations and voice handoffs from the support dashboard.',
    dashboard: supportUrl('/'),
  },
] as const;

export const demoPersona = (role: Role): DemoPersona => {
  const persona = DEMO_PERSONAS.find((p) => p.role === role);
  if (!persona) throw new Error(`no demo persona for role ${role}`);
  return persona;
};

/**
 * A tab held open across the login round-trip.
 *
 * `window.open` is only honoured while the click gesture is live: opening it *after*
 * the awaited `POST /api/auth/login` is treated as an unsolicited popup by Chrome and
 * Safari and silently blocked. So the tab is reserved during the handler and pointed
 * at the console once the cookie exists — and if the browser refused it anyway, the
 * console is opened in this tab rather than nowhere.
 *
 * `show` reports which of those happened, because a caller that also reloads or routes
 * this tab would cancel the fallback navigation it just started.
 */
export type ReservedTab = {
  /** `'popup'` → a second tab has the console · `'self'` → this tab is leaving for it. */
  show: () => 'popup' | 'self';
  cancel: () => void;
};

export const reserveDashboardTab = (dashboard: string | null): ReservedTab | null => {
  if (dashboard === null) return null;
  const tab = window.open('', '_blank');
  return {
    show: () => {
      if (tab === null) {
        window.location.assign(dashboard);
        return 'self';
      }
      tab.location.replace(dashboard);
      return 'popup';
    },
    cancel: () => tab?.close(),
  };
};
