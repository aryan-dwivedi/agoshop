const trimSlashes = (origin: string): string => origin.replace(/\/+$/, '');
const runtimeOrigin =
    typeof window === 'undefined' ? 'http://localhost:5173' : window.location.origin;
const deployedPath = (value: string | undefined, fallback: string): string =>
    `/${(value ?? fallback).replace(/^\/+|\/+$/g, '')}`;
export const CUSTOMER_ORIGIN = trimSlashes(
    import.meta.env.VITE_CUSTOMER_ORIGIN ??
        (import.meta.env.DEV ? 'http://localhost:5173' : runtimeOrigin),
);
export const SELLER_ORIGIN = trimSlashes(
    import.meta.env.VITE_SELLER_ORIGIN ??
        (import.meta.env.DEV
            ? 'http://localhost:5174'
            : `${runtimeOrigin}${deployedPath(import.meta.env.VITE_SELLER_BASE_PATH, 'studio')}`),
);
export const SUPPORT_ORIGIN = trimSlashes(
    import.meta.env.VITE_SUPPORT_ORIGIN ??
        (import.meta.env.DEV
            ? 'http://localhost:5175'
            : `${runtimeOrigin}${deployedPath(import.meta.env.VITE_SUPPORT_BASE_PATH, 'support')}`),
);
export const customerUrl = (path = '/'): string => `${CUSTOMER_ORIGIN}${path}`;
export const sellerUrl = (path = '/'): string => `${SELLER_ORIGIN}${path}`;
export const supportUrl = (path = '/'): string => `${SUPPORT_ORIGIN}${path}`;
