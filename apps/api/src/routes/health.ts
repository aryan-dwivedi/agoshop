import { createRequire } from 'node:module';

import { Router } from 'express';
import { sql } from 'drizzle-orm';

import { db } from '../db/client.js';
import { analyticsStreamBacklog, registry } from '../lib/metrics.js';
import { isDraining } from '../lib/readiness.js';
import { keys, redis } from '../lib/redis.js';

/**
 * `GET /api/health` is nginx's upstream check and k6's warm-up probe, so it reports the
 * two dependencies individually rather than a bare 200.
 *
 * `GET /metrics` refreshes `analytics_stream_backlog` before rendering: the drain runs
 * in the background process, so the API replica has to read the stream length itself.
 */
export const router = Router();

const requireJson = createRequire(import.meta.url);
const { version: VERSION } = requireJson('../../package.json') as { version: string };

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
    } catch {
      // A Redis blip must not blank the whole scrape.
    }
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  } catch (err) {
    next(err);
  }
});
