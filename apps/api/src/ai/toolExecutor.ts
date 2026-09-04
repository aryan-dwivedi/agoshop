import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { MUTATING_TOOLS, toolSchemas } from '@shop/shared';
import type { ToolName } from '@shop/shared';
import { db } from '../db/client.js';
import { aiMessages, aiToolCalls } from '../db/schema.js';
import { getConversationLlmMode, setConversationLlmMode } from './llmMode.js';
import { track } from '../lib/analytics.js';
import { logger } from '../lib/logger.js';
import { aiToolCallsTotal, toolLatencySeconds } from '../lib/metrics.js';
import { persistBodies } from '../lib/pii.js';
import { callMcpTool } from '../mcp/client.js';
import type { ConversationRecord } from './conversations.js';
import { toolError } from './speakable.js';
import type { SurfacedProducts } from './surfacedProducts.js';
import { runTool, type ToolInvocation } from './tools/index.js';
export type PendingToolCall = {
    id: string;
    name: string;
    arguments: string;
};
export type ToolOutcome = 'ok' | 'error' | 'replayed';
export type ExecutedToolCall = {
    id: string;
    name: string;
    outcome: ToolOutcome;
    result: Record<string, unknown>;
};
export type ToolExecutionOptions = {
    path?: 'auto' | 'direct';
};
const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value !== null && typeof value === 'object') {
        const source: Record<string, unknown> = { ...value };
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(source).sort())
            out[key] = canonicalize(source[key]);
        return out;
    }
    return value;
};
export const hashArgs = (args: unknown): string => createHash('sha256')
    .update(JSON.stringify(canonicalize(args)))
    .digest('hex');
const persistToolMessage = async (conversation: ConversationRecord, turnId: number, name: ToolName, args: Record<string, unknown>, result: Record<string, unknown>): Promise<void> => {
    await db.insert(aiMessages).values({
        conversationId: conversation.id,
        role: 'tool',
        content: null,
        toolName: name,
        toolArgs: persistBodies ? args : null,
        toolResult: persistBodies ? result : null,
        turnId,
    });
};
const executeOne = async (conversation: ConversationRecord, turnId: number, call: PendingToolCall, surfaced: SurfacedProducts, opts: ToolExecutionOptions = {}): Promise<ExecutedToolCall> => {
    const schema = Object.hasOwn(toolSchemas, call.name)
        ? toolSchemas[call.name as ToolName]
        : undefined;
    if (!schema) {
        aiToolCallsTotal.inc({ tool: call.name, outcome: 'error' });
        return {
            id: call.id,
            name: call.name,
            outcome: 'error',
            result: toolError('unknown_tool', `${call.name} is not a tool this assistant has`),
        };
    }
    const name = call.name as ToolName;
    let parsedArgs: unknown;
    try {
        parsedArgs = call.arguments.trim().length === 0 ? {} : JSON.parse(call.arguments);
    }
    catch {
        aiToolCallsTotal.inc({ tool: name, outcome: 'error' });
        return {
            id: call.id,
            name,
            outcome: 'error',
            result: toolError('malformed_arguments', 'arguments were not valid JSON'),
        };
    }
    const validated = schema.safeParse(parsedArgs);
    if (!validated.success) {
        aiToolCallsTotal.inc({ tool: name, outcome: 'error' });
        return {
            id: call.id,
            name,
            outcome: 'error',
            result: toolError('invalid_arguments', validated.error.issues
                .map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`)
                .join('; ')),
        };
    }
    const invocation = { name, args: validated.data } as ToolInvocation;
    const args: Record<string, unknown> = { ...validated.data };
    const mutating = MUTATING_TOOLS[name];
    const argsHash = hashArgs(args);
    const stopTimer = toolLatencySeconds.startTimer({ tool: name });
    if (mutating) {
        const [existing] = await db
            .select({ result: aiToolCalls.result })
            .from(aiToolCalls)
            .where(and(eq(aiToolCalls.conversationId, conversation.id), eq(aiToolCalls.turnId, turnId), eq(aiToolCalls.name, name), eq(aiToolCalls.argsHash, argsHash)))
            .limit(1);
        if (existing) {
            stopTimer();
            aiToolCallsTotal.inc({ tool: name, outcome: 'replayed' });
            track({
                type: 'ai_tool_call',
                userId: conversation.userId,
                sessionId: conversation.liveSessionId,
                productId: conversation.contextProductId,
                payload: { tool: name, outcome: 'replayed', conversationId: conversation.id, turnId },
            });
            logger.info({ conversationId: conversation.id, turnId, tool: name, argsHash }, 'ai tool call replayed from aiToolCalls; domain untouched');
            return { id: call.id, name, outcome: 'replayed', result: existing.result };
        }
    }
    let result: Record<string, unknown>;
    let outcome: ToolOutcome = 'ok';
    const runDirect = async (): Promise<Record<string, unknown>> => {
        try {
            const direct = await runTool(conversation, invocation, surfaced);
            if ('error' in direct)
                outcome = 'error';
            return direct;
        }
        catch (err) {
            outcome = 'error';
            const message = err instanceof Error ? err.message : 'tool failed';
            logger.error({ err, tool: name, conversationId: conversation.id }, 'ai tool threw');
            return toolError('tool_failed', message);
        }
    };
    const useMcpLoopback = opts.path !== 'direct' && (await getConversationLlmMode(conversation.id)) === 'mcp';
    if (useMcpLoopback) {
        try {
            result = await callMcpTool(conversation, turnId, name, args);
            if ('error' in result)
                outcome = 'error';
        }
        catch (err) {
            logger.warn({ err, conversationId: conversation.id, tool: name }, 'mcp tool loopback failed; falling back to custom tool path');
            await setConversationLlmMode(conversation.id, 'custom');
            result = await runDirect();
        }
    }
    else {
        result = await runDirect();
    }
    const durationMs = Math.round(stopTimer() * 1000);
    if (mutating && outcome === 'ok') {
        await db
            .insert(aiToolCalls)
            .values({
            conversationId: conversation.id,
            turnId,
            name,
            argsHash,
            toolCallId: call.id,
            args,
            result,
        })
            .onConflictDoNothing();
    }
    aiToolCallsTotal.inc({ tool: name, outcome });
    track({
        type: 'ai_tool_call',
        userId: conversation.userId,
        sessionId: conversation.liveSessionId,
        productId: typeof args.product_id === 'string' ? args.product_id : conversation.contextProductId,
        payload: { tool: name, outcome, conversationId: conversation.id, turnId, durationMs },
    });
    await persistToolMessage(conversation, turnId, name, args, result).catch((err: unknown) => logger.warn({ err, conversationId: conversation.id }, 'ai tool message persist failed'));
    return { id: call.id, name, outcome, result };
};
export const executeToolCalls = async (conversation: ConversationRecord, turnId: number, calls: PendingToolCall[], surfaced: SurfacedProducts, opts: ToolExecutionOptions = {}): Promise<ExecutedToolCall[]> => {
    const results = new Array<ExecutedToolCall>(calls.length);
    const readOnly: number[] = [];
    const mutating: number[] = [];
    for (const [index, call] of calls.entries()) {
        if (MUTATING_TOOLS[call.name as ToolName] === true)
            mutating.push(index);
        else
            readOnly.push(index);
    }
    const parallel = Promise.all(readOnly.map(async (index) => {
        results[index] = await executeOne(conversation, turnId, calls[index]!, surfaced, opts);
    }));
    for (const index of mutating) {
        results[index] = await executeOne(conversation, turnId, calls[index]!, surfaced, opts);
    }
    await parallel;
    return results;
};
