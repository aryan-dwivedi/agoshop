import { logger } from '../../lib/logger.js';
import { env } from '../../env.js';
import { LlmProviderError, type LlmChunk, type LlmProvider, type LlmRequest, type LlmToolCallDelta, } from './index.js';
type RawToolCall = {
    index?: number;
    id?: string;
    function?: {
        name?: string;
        arguments?: string;
    };
};
type RawChunk = {
    choices?: {
        index?: number;
        delta?: {
            content?: string | null;
            tool_calls?: RawToolCall[];
        };
        finish_reason?: string | null;
    }[];
    usage?: unknown;
    error?: {
        message?: string;
        code?: string | number;
    } | string;
};
export type SseStreamOptions = {
    providerId: string;
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    signal: AbortSignal;
    ignoreTrailingUsageFinish: boolean;
};
const FINISH_REASONS: Record<string, LlmChunk['finishReason']> = {
    stop: 'stop',
    tool_calls: 'tool_calls',
    length: 'length',
    error: 'error',
    function_call: 'tool_calls',
    content_filter: 'stop',
};
const errorText = (error: NonNullable<RawChunk['error']>): string => typeof error === 'string' ? error : (error.message ?? String(error.code ?? 'provider error'));
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.search(/\r?\n\r?\n/);
            while (boundary !== -1) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + (/\r\n\r\n/.test(buffer.slice(boundary, boundary + 4)) ? 4 : 2));
                const data = rawEvent
                    .split(/\r?\n/)
                    .filter((line) => !line.startsWith(':'))
                    .filter((line) => line.startsWith('data:'))
                    .map((line) => line.slice(5).trim())
                    .join('\n');
                if (data.length > 0)
                    yield data;
                boundary = buffer.search(/\r?\n\r?\n/);
            }
        }
        const tail = buffer
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('\n');
        if (tail.length > 0)
            yield tail;
    }
    finally {
        reader.releaseLock();
    }
}
const toolCallDeltas = (raw: RawToolCall[]): LlmToolCallDelta[] => raw.map((call, position) => ({
    index: call.index ?? position,
    ...(call.id === undefined ? {} : { id: call.id }),
    ...(call.function?.name === undefined ? {} : { name: call.function.name }),
    ...(call.function?.arguments === undefined ? {} : { argumentsDelta: call.function.arguments }),
}));
export async function* streamOpenAiSse(opts: SseStreamOptions): AsyncGenerator<LlmChunk> {
    const response = await fetch(opts.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...opts.headers },
        body: JSON.stringify(opts.body),
        signal: opts.signal,
    });
    if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => '');
        throw new LlmProviderError(opts.providerId, `HTTP ${response.status} ${response.statusText}: ${detail.slice(0, 500)}`);
    }
    let finished = false;
    for await (const data of sseData(response.body)) {
        if (data === '[DONE]')
            break;
        let chunk: RawChunk;
        try {
            chunk = JSON.parse(data) as RawChunk;
        }
        catch {
            logger.warn({ provider: opts.providerId }, 'unparseable SSE frame; skipping');
            continue;
        }
        if (chunk.error)
            throw new LlmProviderError(opts.providerId, errorText(chunk.error));
        const choice = chunk.choices?.[0];
        if (!choice)
            continue;
        const contentDelta = choice.delta?.content ?? undefined;
        const toolCalls = choice.delta?.tool_calls
            ? toolCallDeltas(choice.delta.tool_calls)
            : undefined;
        const rawFinish = choice.finish_reason ?? null;
        const isUsageTail = opts.ignoreTrailingUsageFinish &&
            chunk.usage != null &&
            contentDelta === undefined &&
            toolCalls === undefined;
        const finishReason = rawFinish && !(finished && isUsageTail) ? (FINISH_REASONS[rawFinish] ?? 'stop') : undefined;
        if (contentDelta === undefined && toolCalls === undefined && finishReason === undefined) {
            continue;
        }
        if (finishReason)
            finished = true;
        yield {
            ...(contentDelta === undefined ? {} : { contentDelta }),
            ...(toolCalls === undefined ? {} : { toolCalls }),
            ...(finishReason === undefined ? {} : { finishReason }),
        };
    }
}
export const chatCompletionsBody = (req: LlmRequest): Record<string, unknown> => ({
    model: req.model,
    messages: req.messages,
    stream: true,
    ...(req.tools && req.tools.length > 0
        ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto', parallel_tool_calls: true }
        : {}),
});
export const createOpenAiCompatibleProvider = (): LlmProvider => ({
    id: 'openai-compatible',
    streamChat(req: LlmRequest): AsyncIterable<LlmChunk> {
        return streamOpenAiSse({
            providerId: 'openai-compatible',
            url: `${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
            headers: env.LLM_API_KEY ? { authorization: `Bearer ${env.LLM_API_KEY}` } : {},
            body: chatCompletionsBody(req),
            signal: req.signal,
            ignoreTrailingUsageFinish: false,
        });
    },
});
