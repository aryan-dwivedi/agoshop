import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * `npm test` runs two kinds of check:
 *   - pure unit tests over the promotion evaluator (no I/O, milliseconds)
 *   - the integration checks, which drive real Postgres + Redis through the app
 *     factory and are executed as child processes so they keep their own env file
 *
 * Both are real assertions about observable contracts; neither mocks the thing it
 * is meant to prove.
 */
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
    testTimeout: 180_000,
    hookTimeout: 60_000,
    pool: 'forks',
    // The integration checks share one database; running them in parallel would
    // have them fight over the same fixtures.
    fileParallelism: false,
    reporters: ['default'],
  },
});
