import type { OpenAiToolSchema } from '@shop/shared';

import { env, LLM_PROVIDER_IDS } from '../../env.js';
import { llmLatencySeconds } from '../../lib/metrics.js';
import { createMockProvider } from './mock.js';
import { createOpenAiCompatibleProvider } from './openaiCompatible.js';
import { createOpenRouterProvider } from './openrouter.js';

/**
 * The provider seam. Swapping OpenAI direct, Groq, Together, Azure or a self-hosted
 * vLLM for OpenRouter is `LLM_PROVIDER` + `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY`
 * and nothing else: the tool schemas, the executor and the Agora-facing SSE framing
 * are all provider-independent, and every implementation normalizes onto `LlmChunk`.
 */

export type ToolSchema = OpenAiToolSchema;

/** An OpenAI-compatible message. `tool_calls` / `tool_call_id` carry the tool contract. */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
};

export type LlmToolCallDelta = {
  /** Fragments MUST be accumulated by this index; only the first carries id/name. */
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

/** Instantiated lazily so a process that never talks to the model pays nothing. */
const factories: Record<(typeof LLM_PROVIDER_IDS)[number], () => LlmProvider> = {
  openrouter: createOpenRouterProvider,
  'openai-compatible': createOpenAiCompatibleProvider,
  mock: createMockProvider,
};

const instances = new Map<string, LlmProvider>();

/**
 * Wraps the selected provider so `llm_latency_seconds{provider}` is observed once per
 * stream — at the provider boundary, where the measurement means "model round trip"
 * rather than "round trip plus our own tool execution".
 */
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
