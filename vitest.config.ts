import { fileURLToPath } from 'node:url';

import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] })],
    test: {
        include: [
            'apps/api/src/__tests__/**/*.test.ts',
            'apps/web/src/**/*.test.ts',
            'packages/shared/**/*.test.ts',
        ],
        environment: 'node',
        testTimeout: 180000,
        hookTimeout: 60000,
        pool: 'forks',
        fileParallelism: false,
        reporters: ['default'],
    },
});
