import { Router } from 'express';
import { handleMcpRequest } from '../mcp/server.js';
export const mcpRouter = Router();
mcpRouter.post('/mcp', (req, res) => {
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
});
mcpRouter.get('/mcp', (_req, res) => {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
    });
});
