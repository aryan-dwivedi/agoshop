import { defineConfig } from 'vite';

import { webConfig } from './vite.base';

/** The customer storefront: `index.html` on :5173. Seller console: `vite.seller.config.ts`. */
export default defineConfig(webConfig('customer'));
