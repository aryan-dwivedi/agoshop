import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.browser,
            },
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                {
                    prefer: 'type-imports',
                    fixStyle: 'separate-type-imports',
                    disallowTypeAnnotations: false,
                },
            ],
            '@typescript-eslint/no-import-type-side-effects': 'error',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-empty-object-type': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
        },
    },
    {
        files: [
            'apps/api/**/*.{ts,tsx}',
            'apps/worker/**/*.{ts,tsx}',
            'apps/ai-service/**/*.{ts,tsx}',
            'apps/sse-gateway/**/*.{ts,tsx}',
            'packages/**/*.{ts,tsx}',
        ],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        ':matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression) ImportExpression',
                    message:
                        'Avoid inline dynamic imports inside functions. Use a top-level static import instead.',
                },
            ],
        },
    },
    eslintConfigPrettier,
    {
        ignores: ['**/dist/**', '**/node_modules/**', '**/.stack/**', '**/var/**'],
    },
);
