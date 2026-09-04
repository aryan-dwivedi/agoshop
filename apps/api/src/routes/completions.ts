import { Router } from 'express';
import { completionsHandler } from '../ai/completionsRoute.js';
export const completionsRouter = Router();
completionsRouter.post('/api/ai/convo/:conversationId/chat/completions', (req, res, next) => {
    completionsHandler(req, res).catch(next);
});
