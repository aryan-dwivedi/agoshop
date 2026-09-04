import tseslint from 'typescript-eslint';

import baseConfig from '@shop/config-eslint';

export default tseslint.config(
    ...baseConfig,
    {
        ignores: [
            'eslint.config.js',
            'packages/config-eslint/**',
            'vitest.config.ts',
            'scripts/**',
        ],
    },
    {
        files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-exports': [
                'error',
                { fixMixedExportsWithInlineTypeSpecifier: true },
            ],
        },
    },
    {
        files: ['**/__checks__/**', '**/*.test.ts', '**/*.check.ts'],
        rules: {
            'no-restricted-syntax': 'off',
            'no-empty': 'off',
        },
    },
    {
        files: ['packages/domain-commerce/src/orders.ts'],
        rules: {
            'no-restricted-syntax': 'off',
        },
    },
);
