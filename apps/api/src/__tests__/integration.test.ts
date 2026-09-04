import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const envFile = join(repoRoot, '.env');
const CHECKS = [
    {
        name: 'commerce — cart coalescing, live-session mismatch, declined pre-auth leaves stock alone',
        script: 'apps/api/src/domain/__checks__/commerce.check.ts',
    },
    {
        name: 'live — conditional transitions, frozen shards, one-way tier flip, moderation',
        script: 'apps/api/src/domain/__checks__/live.check.ts',
    },
    {
        name: 'ai — signed callback, tool-call ordering, replay dedupe, disconnect abort',
        script: 'apps/api/src/ai/__checks__/ai.check.ts',
    },
    {
        name: 'seller — product creation scoping, SKU collisions, catalog visibility',
        script: 'apps/api/src/domain/__checks__/seller.check.ts',
    },
    {
        name: 'support — ticket reservation, RTC activation, authorization, close',
        script: 'apps/api/src/domain/__checks__/support.check.ts',
    },
] as const;
const run = (script: string): Promise<{
    code: number;
    output: string;
}> => {
    const { promise, resolve: settle } = Promise.withResolvers<{
        code: number;
        output: string;
    }>();
    const child = spawn(process.execPath, [`--env-file=${envFile}`, '--import', 'tsx', script], {
        cwd: repoRoot,
        env: { ...process.env, NODE_ENV: 'test' },
    });
    let output = '';
    child.stdout.on('data', (c) => (output += String(c)));
    child.stderr.on('data', (c) => (output += String(c)));
    child.on('close', (code) => settle({ code: code ?? 1, output }));
    return promise;
};
describe('integration checks', () => {
    it('has an .env to run against', () => {
        expect(existsSync(envFile), 'copy .env.example to .env before running the integration checks').toBe(true);
    });
    for (const check of CHECKS) {
        it(check.name, async () => {
            const { code, output } = await run(check.script);
            if (code !== 0) {
                throw new Error(`${check.script} exited ${code}\n\n${output}`);
            }
            expect(output).toMatch(/pass|ok\b/i);
        }, 180000);
    }
});
