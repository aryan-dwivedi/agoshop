import type { OpenAiToolSchema } from '@shop/shared';

import { LLM_PROVIDER_IDS, env } from '@shop/platform/env.js';
import { llmLatencySeconds } from '@shop/platform/lib/metrics.js';

import { createMockProvider } from './mock.js';
import { createOpenAiCompatibleProvider } from './openaiCompatible.js';
import { createOpenRouterProvider } from './openrouter.js';

export type ToolSchema = OpenAiToolSchema;
export type ChatMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    name?: string;
    tool_call_id?: string;
    tool_calls?: {
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }[];
};
export type LlmToolCallDelta = {
    index: number;
    id?: string;
    name?: string;
    argumentsDelta?: string;
};
export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';
export type LlmChunk = {
    contentDelta?: string;
    toolCalls?: LlmToolCallDelta[];
    finishReason?: LlmFinishReason;
};
export type LlmRequest = {
    model: string;
    messages: ChatMessage[];
    tools?: ToolSchema[];
    toolChoice?: 'auto' | 'none';
    signal: AbortSignal;
};
export interface LlmProvider {
    readonly id: string;
    streamChat(req: LlmRequest): AsyncIterable<LlmChunk>;
}
export class LlmProviderError extends Error {
    readonly provider: string;
    constructor(provider: string, message: string) {
        super(message);
        this.name = 'LlmProviderError';
        this.provider = provider;
    }
}
const factories: Record<(typeof LLM_PROVIDER_IDS)[number], () => LlmProvider> = {
    openrouter: createOpenRouterProvider,
    'openai-compatible': createOpenAiCompatibleProvider,
    mock: createMockProvider,
};
const instances = new Map<string, LlmProvider>();
const instrument = (provider: LlmProvider): LlmProvider => ({
    id: provider.id,
    async *streamChat(req: LlmRequest): AsyncIterable<LlmChunk> {
        const done = llmLatencySeconds.startTimer({ provider: provider.id });
        try {
            yield* provider.streamChat(req);
        } finally {
            done();
        }
    },
});
export const getProvider = (id: string = env.LLM_PROVIDER): LlmProvider => {
    const existing = instances.get(id);
    if (existing) return existing;
    const factory = factories[id as (typeof LLM_PROVIDER_IDS)[number]];
    if (!factory) {
        throw new Error(`unknown LLM provider "${id}"; registered: ${LLM_PROVIDER_IDS.join(', ')}`);
    }
    const provider = instrument(factory());
    instances.set(id, provider);
    return provider;
};
export { LLM_PROVIDER_IDS };
