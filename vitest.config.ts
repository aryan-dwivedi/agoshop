import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
    resolve: {
        alias: {
            '@shop/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
        },
    },
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
