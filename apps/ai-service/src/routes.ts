import { Router } from 'express';
import { completionsHandler } from '@shop/api/ai/completionsRoute.js';
import { router as ttsRouter } from '@shop/api/ai/ttsRoute.js';
import { handleMcpRequest } from '@shop/api/mcp/server.js';
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
