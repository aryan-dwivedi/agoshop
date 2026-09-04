import { defineConfig } from 'vite';

import { webConfig } from './vite.base';

/** The seller console: `seller.html` on :5174. Storefront: `vite.config.ts`. */
export default defineConfig(webConfig('seller'));
