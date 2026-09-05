import type { ToolName } from '@shop/shared';
import type { Request, Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { logger } from '@shop/platform/lib/logger.js';
import { toolSchemas } from '@shop/shared';

import { loadConversation } from '../conversations.js';
import { authenticateMcpRequest } from './auth.js';
import { executeNamedTool } from './executeTool.js';
import { isMcpProbeMethod, parseMcpRpcMethod } from './request.js';

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
    get_conversation_context:
        'Live commerce context: session, offers, product in context, promotion rules.',
    search_products: 'Search the catalog by keyword.',
    get_product_details: 'Full product details by product_id.',
    compare_products: 'Compare two to four products.',
    check_delivery: 'Check pincode serviceability.',
    get_payment_options: 'Payment methods for checkout.',
    get_live_offer: 'Active live-session discount for this conversation.',
    get_personalized_offers: 'Offers this shopper is eligible for.',
    recommend_products: 'Recommend products from wishlist or similar items.',
    get_cart: 'Current cart contents and totals.',
    add_to_cart: 'Add a product variant to the cart.',
    add_to_wishlist: 'Save a product to the wishlist.',
    list_my_orders: 'Recent paid orders with fulfilment status.',
    get_order_status: 'Tracking and delivery status; omit order_id for the latest order.',
    escalate_to_human: 'Connect shopper to a human support agent.',
};
const formatToolResult = (result: Record<string, unknown>) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    structuredContent: result,
});
const coerceArgs = (args: unknown): Record<string, unknown> => {
    if (typeof args === 'string') {
        try {
            const parsed: unknown = JSON.parse(args);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>;
            }
        } catch {
            return {};
        }
    }
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        return args as Record<string, unknown>;
    }
    return {};
};
const createShopMcpServer = (conversationId: string, turnId: number): McpServer => {
    const server = new McpServer({ name: 'shop', version: '1.0.0' });
    for (const name of Object.keys(toolSchemas) as ToolName[]) {
        const schema = toolSchemas[name];
        server.registerTool(
            name,
            {
                description: TOOL_DESCRIPTIONS[name],
                inputSchema: schema.shape,
            },
            (async (args: Record<string, unknown>, extra: { requestId: string | number }) => {
                const conversation = await loadConversation(conversationId);
                if (!conversation) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({ error: { code: 'not_found' } }),
                            },
                        ],
                        isError: true,
                    };
                }
                const validated = schema.safeParse(coerceArgs(args));
                if (!validated.success) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify({
                                    error: {
                                        code: 'invalid_arguments',
                                        message: validated.error.message,
                                    },
                                }),
                            },
                        ],
                        isError: true,
                    };
                }
                const result = await executeNamedTool(
                    conversation,
                    turnId,
                    `mcp_${String(extra.requestId)}`,
                    name,
                    validated.data,
                );
                const isError = 'error' in result;
                return { ...formatToolResult(result), isError };
            }) as never,
        );
    }
    return server;
};
export const handleMcpRequest = async (req: Request, res: Response): Promise<void> => {
    const rpcMethod = parseMcpRpcMethod(req.body);
    let auth;
    try {
        auth = await authenticateMcpRequest(req.headers, {
            httpMethod: req.method,
            rpcMethod,
        });
    } catch (err) {
        logger.warn({ err, rpcMethod }, 'mcp auth rejected');
        if (!res.headersSent) {
            res.status(401).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'Unauthorized' },
                id: null,
            });
        }
        return;
    }
    if (auth.probe && rpcMethod !== null && !isMcpProbeMethod(rpcMethod)) {
        if (!res.headersSent) {
            res.status(401).json({
                jsonrpc: '2.0',
                error: { code: -32001, message: 'missing_conversation_id' },
                id: null,
            });
        }
        return;
    }
    const server = createShopMcpServer(auth.conversation.id, auth.turnId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on('close', () => {
            void transport.close();
            void server.close();
        });
    } catch (err) {
        logger.error({ err, conversationId: auth.conversation.id }, 'mcp request failed');
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
    }
};
export const MCP_ALLOWED_TOOLS: ToolName[] = Object.keys(toolSchemas) as ToolName[];
