import { Router } from 'express';

import { ensureIdentity } from '../middleware/session.js';

/**
 * Minimal SSE route for integration checks. Production traffic uses sse-gateway;
 * this stub avoids pulling the gateway's Redis subscriber into the API test app.
 */
export const router = Router();

router.get('/api/events', ensureIdentity, (req, res) => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');
  req.on('close', () => res.end());
});
