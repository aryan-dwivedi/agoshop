import type { Role } from '@shop/shared';

import { sellerUrl, supportUrl } from './origins';

export const DEMO_PASSWORD = 'demo1234';
export type DemoPersona = {
    role: Role;
    email: string;
    label: string;
    blurb: string;
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
export type ReservedTab = {
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
