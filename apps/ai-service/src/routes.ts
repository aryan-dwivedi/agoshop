import { Router } from 'express';

import { handleMcpRequest } from '@shop/ai/mcp/server.js';

export const mcpRouter = Router();
const forwardMcp = (req: Parameters<typeof handleMcpRequest>[0], res: Parameters<typeof handleMcpRequest>[1], next: (err?: unknown) => void): void => {
    handleMcpRequest(req, res).catch(next);
};
mcpRouter.post('/mcp', forwardMcp);
mcpRouter.get('/mcp', forwardMcp);
export const aiServiceRouters = [mcpRouter];
