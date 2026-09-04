import { defineConfig } from 'vite';

import { webConfig } from './vite.base';

/** Support dashboard: `support.html` on :5175. */
export default defineConfig(webConfig('support'));
