import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import type { Plugin, UserConfig } from 'vite';

/**
 * One source tree, two apps.
 *
 * The storefront and the seller console are separate origins on purpose: two
 * audiences, two release cadences, and a shopper's tab can never render an operator
 * surface. They still share this tree (catalog cards, the live room, the API client,
 * the session provider), so the split lives in the build config rather than in a
 * duplicated project: one entry HTML and one dev port per app.
 *
 * `@shop/shared` is consumed as TypeScript source (no build step), mirroring the
 * tsconfig `paths` entry. `/api` and `/media` proxy to nginx (8080), not to a single
 * replica, so the browser exercises the load balancer exactly like Agora's callback —
 * and because both dev servers proxy the same API host, the session cookie
 * (host-scoped to `localhost`, port-agnostic) is shared by both apps.
 */
export type WebApp = 'customer' | 'seller' | 'support';

export const WEB_APPS = {
  customer: { port: 5173, entry: 'index.html' },
  seller: { port: 5174, entry: 'seller.html' },
  support: { port: 5175, entry: 'support.html' },
} as const satisfies Record<WebApp, { port: number; entry: string }>;

/**
 * Dev-only entry routing.
 *
 * `build.rollupOptions.input` decides the entry of a *bundle*; the dev server knows
 * nothing about it and its SPA fallback always answers a navigation with the root
 * `index.html`. Without this the console port would hand back the storefront document
 * — a shopper header over `/products`, and every deep link a 404 from the wrong router.
 *
 * Only navigations are rewritten: module, asset and proxied `/api` requests do not ask
 * for `text/html`, so they resolve normally. Installed from `configureServer`'s body,
 * which runs before Vite's own middlewares, so the rewrite is in place by the time the
 * html transform looks at the URL.
 */
const devEntry = (entry: string): Plugin => ({
  name: 'web-dev-entry',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.headers.accept?.includes('text/html') === true) req.url = `/${entry}`;
      next();
    });
  },
});
const productionBase = (app: WebApp): string => {
  const configured =
    app === 'seller'
      ? process.env.VITE_SELLER_BASE_PATH
      : app === 'support'
        ? process.env.VITE_SUPPORT_BASE_PATH
        : undefined;
  if (!configured) return '/';
  return `/${configured.replace(/^\/+|\/+$/g, '')}/`;
};

export const webConfig = (app: WebApp): UserConfig => {
  const { port, entry } = WEB_APPS[app];
  return {
    base: productionBase(app),
    // Both dev servers run concurrently. Separate optimizer caches prevent one app
    // from invalidating dependency URLs that the other app has already served.
    cacheDir: `node_modules/.vite-${app}`,
    plugins: [react(), devEntry(entry)],
    resolve: {
      alias: {
        '@shop/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
      // ngrok tunnels the dev server for mobile / remote demos (e.g. `ngrok http 5173`).
      allowedHosts: ['.ngrok-free.app', '.ngrok.io'],
      proxy: {
        // Native dev: proxy straight to services. Production/docker uses nginx :8080.
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
