import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import type { Plugin, UserConfig } from 'vite';
export type WebApp = 'customer' | 'seller' | 'support';
export const WEB_APPS = {
    customer: { port: 5173, entry: 'index.html' },
    seller: { port: 5174, entry: 'seller.html' },
    support: { port: 5175, entry: 'support.html' },
} as const satisfies Record<WebApp, {
    port: number;
    entry: string;
}>;
const devEntry = (entry: string): Plugin => ({
    name: 'web-dev-entry',
    apply: 'serve',
    configureServer(server) {
        server.middlewares.use((req, _res, next) => {
            if (req.headers.accept?.includes('text/html') === true)
                req.url = `/${entry}`;
            next();
        });
    },
});
const productionBase = (app: WebApp): string => {
    const configured = app === 'seller'
        ? process.env.VITE_SELLER_BASE_PATH
        : app === 'support'
            ? process.env.VITE_SUPPORT_BASE_PATH
            : undefined;
    if (!configured)
        return '/';
    return `/${configured.replace(/^\/+|\/+$/g, '')}/`;
};
export const webConfig = (app: WebApp): UserConfig => {
    const { port, entry } = WEB_APPS[app];
    return {
        base: productionBase(app),
        cacheDir: `node_modules/.vite-${app}`,
        plugins: [react(), devEntry(entry)],
        resolve: {
            alias: {
                '@shop/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
                '@': fileURLToPath(new URL('./src', import.meta.url)),
            },
        },
        server: {
            port,
            strictPort: true,
            allowedHosts: ['.ngrok-free.app', '.ngrok.io'],
            proxy: {
                '/api/events': { target: 'http://localhost:8789', changeOrigin: true },
                '/mcp': { target: 'http://localhost:8787', changeOrigin: true },
                '/api': { target: 'http://localhost:8787', changeOrigin: true },
                '/media': { target: 'http://localhost:8787', changeOrigin: true },
            },
        },
        preview: { port },
        build: {
            outDir: `dist/${app}`,
            emptyOutDir: true,
            rollupOptions: { input: fileURLToPath(new URL(entry, import.meta.url)) },
        },
    };
};
