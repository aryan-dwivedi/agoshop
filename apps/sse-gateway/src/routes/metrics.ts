import { Router } from 'express';

import { registry } from '@shop/platform/lib/metrics.js';

export const router = Router();
router.get('/metrics', async (_req, res, next) => {
    try {
        res.setHeader('Content-Type', registry.contentType);
        res.send(await registry.metrics());
    } catch (err) {
        next(err);
    }
});
