import { Router } from 'express';
import { ensureIdentity } from '../../../api/src/middleware/session.js';
import { addSseClient } from '../lib/sse.js';
export const router = Router();
router.get('/api/events', ensureIdentity, (req, res, next) => {
    try {
        const raw = req.query.sessionId;
        const sessionIds = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
            .map((v) => String(v))
            .filter((v) => /^[0-9a-fA-F-]{36}$/.test(v));
        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();
        res.write(': connected\n\n');
        addSseClient(res, req.session!.userId, sessionIds);
    }
    catch (err) {
        next(err);
    }
});
