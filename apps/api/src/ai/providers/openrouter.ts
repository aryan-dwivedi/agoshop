import { env } from '../../env.js';
import { chatCompletionsBody, streamOpenAiSse } from './openaiCompatible.js';
import type { LlmChunk, LlmProvider, LlmRequest } from './index.js';
export const createOpenRouterProvider = (): LlmProvider => ({
    id: 'openrouter',
    streamChat(req: LlmRequest): AsyncIterable<LlmChunk> {
        const headers: Record<string, string> = {
            authorization: `Bearer ${env.LLM_API_KEY}`,
        };
        if (env.WEB_ORIGIN) {
            headers['HTTP-Referer'] = env.WEB_ORIGIN.split(',')[0]!.trim();
            headers['X-OpenRouter-Title'] = 'Live Commerce Shopping Assistant';
        }
        return streamOpenAiSse({
            providerId: 'openrouter',
            url: `${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`,
            headers,
            body: chatCompletionsBody(req),
            signal: req.signal,
            ignoreTrailingUsageFinish: true,
        });
    },
});
