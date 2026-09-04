import { Router } from 'express';

import { handleMcpRequest } from '@shop/ai/mcp/server.js';

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
export const aiServiceRouters = [mcpRouter];
