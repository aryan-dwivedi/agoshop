import type { ToolName } from '@shop/shared';
import { signCallback } from '../ai/callbackAuth.js';
import type { ConversationRecord } from '../ai/conversations.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
const mcpLoopbackUrl = (): string => {
    const configured = env.MCP_ENDPOINT_URL.replace(/\/$/, '');
    if (configured.length > 0 && configured.includes('127.0.0.1'))
        return `${configured}/mcp`;
    if (configured.length > 0 && configured.includes('localhost'))
        return `${configured}/mcp`;
    return `http://127.0.0.1:${env.PORT}/mcp`;
};
const signedHeaders = (conversation: ConversationRecord, turnId: number): Record<string, string> => {
    const expires = Math.floor(conversation.callbackExpiresAt.getTime() / 1000);
    return {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'X-Convo-Id': conversation.id,
        'X-Convo-Expires': String(expires),
        'X-Convo-Signature': signCallback(conversation.id, expires),
        'X-Convo-Turn-Id': String(turnId),
    };
};
const parseMcpToolResult = (body: string): Record<string, unknown> => {
    try {
        const json = JSON.parse(body) as {
            result?: {
                structuredContent?: Record<string, unknown>;
                content?: Array<{
                    type?: string;
                    text?: string;
                }>;
                isError?: boolean;
            };
            error?: {
                message?: string;
            };
        };
        if (json.error) {
            throw new Error(json.error.message ?? 'mcp_tool_error');
        }
        const structured = json.result?.structuredContent;
        if (structured && typeof structured === 'object')
            return structured;
        const text = json.result?.content?.[0]?.text;
        if (typeof text === 'string' && text.length > 0) {
            try {
                const parsed: unknown = JSON.parse(text);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, unknown>;
                }
            }
            catch {
                return { message: text };
            }
        }
        return { error: { code: 'mcp_empty_result', message: 'MCP returned no tool payload' } };
    }
    catch (err) {
        if (err instanceof Error && err.message !== 'mcp_tool_error') {
            throw err;
        }
        throw new Error('mcp_tool_response_invalid');
    }
};
export const callMcpTool = async (conversation: ConversationRecord, turnId: number, name: ToolName, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const url = mcpLoopbackUrl();
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: signedHeaders(conversation, turnId),
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name, arguments: args },
            }),
            signal: AbortSignal.timeout(15000),
        });
    }
    catch (err) {
        logger.warn({ err, conversationId: conversation.id, tool: name, url }, 'mcp loopback unreachable');
        throw err;
    }
    const body = await response.text();
    if (!response.ok) {
        logger.warn({ conversationId: conversation.id, tool: name, status: response.status, body: body.slice(0, 200) }, 'mcp loopback rejected tool call');
        throw new Error(`mcp_http_${response.status}`);
    }
    return parseMcpToolResult(body);
};
