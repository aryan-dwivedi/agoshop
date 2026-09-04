import { env } from '../../env.js';
import { chatCompletionsBody, streamOpenAiSse } from './openaiCompatible.js';
import type { LlmChunk, LlmProvider, LlmRequest } from './index.js';

/**
 * OpenRouter — the default provider, and the only one exercised against real
 * credentials in this project.
 *
 * It is the OpenAI-compatible reader with OpenRouter's documented deviations handled:
 *  - `: OPENROUTER PROCESSING` comment keepalives are skipped (in the shared framer);
 *  - the trailing usage chunk REPEATS `finish_reason` in a choice with an empty delta,
 *    which must not be forwarded as a second end-of-round (`ignoreTrailingUsageFinish`);
 *  - a mid-stream failure arrives as an HTTP-200 data event carrying a top-level
 *    `error`, which the shared reader raises as a provider failure rather than
 *    silently ending the stream.
 * `HTTP-Referer` / `X-OpenRouter-Title` are optional attribution headers and are only
 * sent when there is a public origin to attribute to.
 */
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
