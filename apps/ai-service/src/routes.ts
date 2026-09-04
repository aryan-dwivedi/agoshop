import { Router } from 'express';

import { completionsHandler } from '@shop/api/ai/completionsRoute.js';
import { handleMcpRequest } from '@shop/api/mcp/server.js';
import { router as ttsRouter } from '@shop/api/ai/ttsRoute.js';

/**
 * AI hot-path routes — scaled independently from the main API.
 *
 * Completions (Agora's custom-LLM callback) and TTS are the CPU/latency-sensitive
 * paths nginx routes to `ai_pool`. Conversation admission and lifecycle stay on
 * `@shop/api`.
 */
export const completionsRouter = Router();

completionsRouter.post('/api/ai/convo/:conversationId/chat/completions', (req, res, next) => {
  completionsHandler(req, res).catch(next);
});

export const mcpRouter = Router();
mcpRouter.post('/mcp', (req, res, next) => {
  handleMcpRequest(req, res).catch(next);
});
mcpRouter.get('/mcp', (_req, res) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed' },
    id: null,
  });
});

export const aiServiceRouters = [completionsRouter, mcpRouter, ttsRouter];
