import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { Router } from 'express';

import { db } from '@shop/db/client.js';
import { analyticsStreamBacklog, registry } from '@shop/platform/lib/metrics.js';
import { isDraining } from '@shop/platform/lib/readiness.js';
import { keys, redis } from '@shop/platform/lib/redis.js';

export const router = Router();
const readAppVersion = (): string => {
    const here = dirname(fileURLToPath(import.meta.url));
    const candidates = [
        join(here, '../package.json'),
        join(here, '../../package.json'),
        join(process.cwd(), 'apps/api/package.json'),
        join(process.cwd(), 'package.json'),
    ];
    for (const path of candidates) {
        try {
            const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
                version?: string;
            };
            if (typeof pkg.version === 'string') return pkg.version;
        } catch {}
    }
    return 'unknown';
};
const VERSION = readAppVersion();
router.get('/api/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});
router.get('/api/health/ready', async (_req, res, next) => {
    try {
        if (isDraining()) {
            res.status(503).json({ status: 'draining' });
            return;
        }
        const [dbOk, redisOk] = await Promise.all([
            db
                .execute(sql`select 1`)
                .then(() => true)
                .catch(() => false),
            redis
                .ping()
                .then((r) => r === 'PONG')
                .catch(() => false),
        ]);
        const ready = dbOk && redisOk;
        res.status(ready ? 200 : 503).json({
            status: ready ? 'ok' : 'degraded',
            db: dbOk ? 'up' : 'down',
            redis: redisOk ? 'up' : 'down',
            version: VERSION,
        });
    } catch (err) {
        next(err);
    }
});
router.get('/api/health', async (_req, res, next) => {
    try {
        const [dbOk, redisOk] = await Promise.all([
            db
                .execute(sql`select 1`)
                .then(() => true)
                .catch(() => false),
            redis
                .ping()
                .then((r) => r === 'PONG')
                .catch(() => false),
        ]);
        const status = dbOk && redisOk ? 'ok' : 'degraded';
        res.status(status === 'ok' ? 200 : 503).json({
            status,
            db: dbOk ? 'up' : 'down',
            redis: redisOk ? 'up' : 'down',
            version: VERSION,
        });
    } catch (err) {
        next(err);
    }
});
router.get('/metrics', async (_req, res, next) => {
    try {
        try {
            analyticsStreamBacklog.set(await redis.xlen(keys.analyticsStream));
        } catch {}
        res.setHeader('Content-Type', registry.contentType);
        res.send(await registry.metrics());
    } catch (err) {
        next(err);
    }
});
