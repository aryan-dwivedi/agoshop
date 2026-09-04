import { Router } from 'express';

import { completionsHandler } from '../ai/completionsRoute.js';

/**
 * Agora custom-LLM callback — also mounted on the main API in dev so ngrok :8787
 * can serve completions without the ai-service replica.
 */
export const completionsRouter = Router();

completionsRouter.post('/api/ai/convo/:conversationId/chat/completions', (req, res, next) => {
  completionsHandler(req, res).catch(next);
});
