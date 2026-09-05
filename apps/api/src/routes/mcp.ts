import { Router } from 'express';

import { handleMcpRequest } from '@shop/ai/mcp/server.js';

export const mcpRouter = Router();
const forwardMcp = (req: Parameters<typeof handleMcpRequest>[0], res: Parameters<typeof handleMcpRequest>[1]): void => {
    handleMcpRequest(req, res).catch((err: unknown) => {
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
        req.log?.error({ err }, 'mcp route error');
    });
};
mcpRouter.post('/mcp', forwardMcp);
mcpRouter.get('/mcp', forwardMcp);
