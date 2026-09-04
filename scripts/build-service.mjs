#!/usr/bin/env node
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = process.argv[2];
const outfile = process.argv[3];
if (!entry || !outfile) {
    console.error('usage: build-service.mjs <entry.ts> <outfile.js>');
    process.exit(1);
}
const pkgPath = resolve(__dirname, '../package.json');
const rootPkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const external = [
    ...Object.keys(rootPkg.dependencies ?? {}),
    ...Object.keys(rootPkg.devDependencies ?? {}),
];
await build({
    entryPoints: [resolve(process.cwd(), entry)],
    outfile: resolve(process.cwd(), outfile),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'external',
    external,
    alias: {
        '@shop/shared': resolve(__dirname, '../packages/shared/src/index.ts'),
        '@shop/db/schema': resolve(__dirname, '../packages/db/src/schema.ts'),
        '@shop/db': resolve(__dirname, '../packages/db/src/index.ts'),
        '@shop/search': resolve(__dirname, '../packages/search/src/index.ts'),
    },
    logLevel: 'info',
});
