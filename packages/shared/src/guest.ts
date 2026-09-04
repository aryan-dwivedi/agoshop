export const GUEST_EMAIL_DOMAIN = 'guest.invalid';
export const guestEmailFor = (id: string): string => `guest-${id}@${GUEST_EMAIL_DOMAIN}`;
export const isGuestEmail = (email: string): boolean =>
    email.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`);
export const GUEST_DISPLAY_NAME = 'Guest';
