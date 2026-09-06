import type { ChatMessage, LlmChunk, LlmProvider, LlmRequest } from './index.js';

import { LlmProviderError } from './index.js';
import { extractShoppingSearchQuery, isOffTopicShoppingMessage, OFF_TOPIC_REPLY } from '../offTopic.js';

export const mockStats = { streams: 0, aborted: 0, completed: 0 };
let callSeq = 0;
const DIRECTIVE = /\[\[mock:([a-z_]+)(?::([a-z_]+))?(?::([0-9a-fA-F-]{36}|\d{6}))?]]/;
type Script =
    | {
          kind: 'text';
      }
    | {
          kind: 'streaming';
      }
    | {
          kind: 'deferred';
      }
    | {
          kind: 'history';
      }
    | {
          kind: 'references';
      }
    | {
          kind: 'slow';
      }
    | {
          kind: 'error';
      }
    | {
          kind: 'text_tool';
      }
    | {
          kind: 'tool';
          tool: 'add_to_cart' | 'get_product_details';
          productId: string;
      }
    | {
          kind: 'tool';
          tool: 'check_delivery' | 'get_payment_options';
          pincode: string;
      }
    | {
          kind: 'search';
          query: string;
      }
    | {
          kind: 'greeting';
      }
    | {
          kind: 'off_topic';
      };
const GREETING = /^[\s!.,]*(?:hi|hey|hello|hiya|namaste|ji|yo|sup|good\s+(?:morning|afternoon|evening))[\s!.,]*$/iu;
const PINCODE_IN_TEXT = /\b(\d{6})\b/;
const DELIVERY_INTENT =
    /\b(?:deliver(?:y|ies)?|ship(?:ping)?|pin\s*code|pincode|serviceable|serviceability)\b/iu;
const PAYMENT_INTENT =
    /\b(?:pay(?:ment)?|upi|cod|cash(?:\s+on\s+delivery)?|credit\s+card|debit\s+card|card|emi|net\s*banking)\b/iu;
const lastUserText = (messages: ChatMessage[]): string => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!;
        if (message.role === 'user' && typeof message.content === 'string') return message.content;
    }
    return '';
};
const lastToolResult = (messages: ChatMessage[]): ChatMessage | undefined =>
    [...messages].reverse().find((message) => message.role === 'tool');
const summarizeSearchResults = (messages: ChatMessage[]): string[] => {
    const tool = lastToolResult(messages);
    if (!tool?.content) return ['I could not find anything matching that. What else can I help with?'];
    try {
        const data = JSON.parse(tool.content) as {
            total?: number;
            results?: Array<{ title?: string }>;
        };
        const results = data.results ?? [];
        if (results.length === 0) {
            return ['I did not find anything matching that in the catalog. What else can I help with?'];
        }
        const names = results
            .map((item) => item.title?.trim())
            .filter((title): title is string => Boolean(title))
            .slice(0, 3);
        if (names.length === 0) {
            return ['I found a few options — tap a product card to see details.'];
        }
        if (names.length === 1) {
            return [`I found ${names[0]}. Want details or should I add it to your cart?`];
        }
        return ['I found a few options. Which one interests you?'];
    } catch {
        return ['I found a few options — tap a product card to see details.'];
    }
};
const summarizeDeliveryResult = (messages: ChatMessage[]): string[] => {
    const tool = lastToolResult(messages);
    if (!tool?.content) return ['I could not verify delivery for that PIN code.'];
    try {
        const data = JSON.parse(tool.content) as { summary?: string; serviceable?: boolean };
        if (typeof data.summary === 'string' && data.summary.length > 0) return [data.summary];
        return data.serviceable
            ? ['Yes, we can deliver to that PIN code.']
            : ['Sorry, we do not deliver to that PIN code.'];
    } catch {
        return ['I could not verify delivery for that PIN code.'];
    }
};
const summarizePaymentResult = (messages: ChatMessage[]): string[] => {
    const tool = lastToolResult(messages);
    if (!tool?.content) return ['I could not load payment options right now.'];
    try {
        const data = JSON.parse(tool.content) as { summary?: string; methodLabels?: string[] };
        if (typeof data.summary === 'string' && data.summary.length > 0) return [data.summary];
        if (data.methodLabels && data.methodLabels.length > 0) {
            return [`You can pay with ${data.methodLabels.join(', ')}.`];
        }
        return ['No payment methods are available for that PIN code right now.'];
    } catch {
        return ['I could not load payment options right now.'];
    }
};
const chooseScript = (messages: ChatMessage[]): Script => {
    if (messages.some((m) => m.role === 'tool')) return { kind: 'text' };
    const text = lastUserText(messages);
    const match = DIRECTIVE.exec(text);
    if (!match) {
        if (GREETING.test(text.trim())) return { kind: 'greeting' };
        if (isOffTopicShoppingMessage(text)) return { kind: 'off_topic' };
        const pinMatch = PINCODE_IN_TEXT.exec(text);
        if (pinMatch) {
            const pincode = pinMatch[1]!;
            if (PAYMENT_INTENT.test(text)) {
                return { kind: 'tool', tool: 'get_payment_options', pincode };
            }
            if (DELIVERY_INTENT.test(text)) {
                return { kind: 'tool', tool: 'check_delivery', pincode };
            }
        }
        const query = extractShoppingSearchQuery(text);
        if (query) return { kind: 'search', query };
        return { kind: 'greeting' };
    }
    const [, kind, tool, third] = match;
    if (kind === 'slow') return { kind: 'slow' };
    if (kind === 'streaming') return { kind: 'streaming' };
    if (kind === 'deferred') return { kind: 'deferred' };
    if (kind === 'text_tool') return { kind: 'text_tool' };
    if (kind === 'references') return { kind: 'references' };
    if (kind === 'history') return { kind: 'history' };
    if (kind === 'error') return { kind: 'error' };
    if (kind === 'delivery' && third) {
        return { kind: 'tool', tool: 'check_delivery', pincode: third };
    }
    if (kind === 'payment' && third) {
        return { kind: 'tool', tool: 'get_payment_options', pincode: third };
    }
    if (kind === 'tool' && third) {
        if (tool === 'check_delivery' || tool === 'delivery') {
            return { kind: 'tool', tool: 'check_delivery', pincode: third };
        }
        if (tool === 'get_payment_options' || tool === 'payment') {
            return { kind: 'tool', tool: 'get_payment_options', pincode: third };
        }
        return {
            kind: 'tool',
            tool: tool === 'details' ? 'get_product_details' : 'add_to_cart',
            productId: third,
        };
    }
    return { kind: 'text' };
};
const abortError = (): Error => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return err;
};
const blockUntilAborted = (signal: AbortSignal): Promise<never> =>
    new Promise<never>((_resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        signal.addEventListener('abort', () => reject(abortError()), {
            once: true,
        });
    });
const CLOSING = [
    'Done — ',
    'that is in your cart ',
    'with the live discount applied. ',
    'Anything else?',
];
const GREETING_REPLY = [
    'Hi! ',
    'Tell me what you are shopping for ',
    'and I will help you find it.',
];
const emitToolCall = function* (
    name: string,
    args: string,
    signal: AbortSignal,
): Generator<LlmChunk> {
    const id = `call_mock_${(callSeq += 1)}`;
    const split = Math.max(1, Math.floor(args.length / 3));
    if (signal.aborted) throw abortError();
    yield {
        toolCalls: [{ index: 0, id, name, argumentsDelta: '' }],
    };
    yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(0, split) }] };
    yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(split, split * 2) }] };
    yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(split * 2) }] };
    yield { finishReason: 'tool_calls' };
};
async function* run(req: LlmRequest): AsyncGenerator<LlmChunk> {
    mockStats.streams += 1;
    const script = chooseScript(req.messages);
    const closing = req.messages.some((m) => m.role === 'tool');
    const closingTool = [...req.messages]
        .reverse()
        .find((message) => message.role === 'tool')?.name;
    try {
        if (script.kind === 'error') {
            yield { contentDelta: 'One moment' };
            throw new LlmProviderError('mock', 'scripted provider failure');
        }
        if (script.kind === 'slow') {
            yield { contentDelta: 'Checking' };
            await blockUntilAborted(req.signal);
            return;
        }
        if (script.kind === 'streaming') {
            yield { contentDelta: 'The first words should be spoken ' };
            await new Promise<void>((resolve) => setTimeout(resolve, 750));
            yield { contentDelta: 'while the rest is still generating.' };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'deferred') {
            const answer =
                req.toolChoice === 'none'
                    ? ["I'm doing well ", 'and ready to help. ', 'What are you shopping for?']
                    : ['Give me one second, ', "I'm checking that."];
            for (const delta of answer) yield { contentDelta: delta };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'history') {
            const previousUser = [...req.messages]
                .slice(0, -1)
                .reverse()
                .find((message) => message.role === 'user' && typeof message.content === 'string');
            yield {
                contentDelta: previousUser?.content
                    ? `I remember: ${previousUser.content}`
                    : "I don't have the earlier turn.",
            };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'references') {
            const references = req.messages.find(
                (message) =>
                    message.role === 'system' &&
                    typeof message.content === 'string' &&
                    message.content.startsWith('Canonical catalog references'),
            );
            yield {
                contentDelta:
                    typeof references?.content === 'string'
                        ? references.content
                        : 'No canonical product references were provided.',
            };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'text_tool') {
            yield { contentDelta: '<tool_' };
            yield { contentDelta: 'call>check_delivery\n' };
            yield { contentDelta: '{{"product_id":"1","pincode":"560001"}}' };
            yield { contentDelta: '\n</tool_call>' };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'greeting') {
            for (const delta of GREETING_REPLY) {
                if (req.signal.aborted) throw abortError();
                yield { contentDelta: delta };
            }
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'off_topic') {
            yield { contentDelta: OFF_TOPIC_REPLY };
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'search') {
            const args = JSON.stringify({ query: script.query, limit: 5 });
            yield* emitToolCall('search_products', args, req.signal);
            mockStats.completed += 1;
            return;
        }
        if (script.kind === 'text') {
            const answer =
                closing && closingTool === 'check_delivery'
                    ? summarizeDeliveryResult(req.messages)
                    : closing && closingTool === 'get_payment_options'
                      ? summarizePaymentResult(req.messages)
                      : closing && closingTool === 'search_products'
                        ? summarizeSearchResults(req.messages)
                        : closing
                          ? CLOSING
                          : GREETING_REPLY;
            for (const delta of answer) {
                if (req.signal.aborted) throw abortError();
                yield { contentDelta: delta };
            }
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        if (script.tool === 'check_delivery') {
            const args = JSON.stringify({ pincode: script.pincode });
            yield* emitToolCall('check_delivery', args, req.signal);
            mockStats.completed += 1;
            return;
        }
        if (script.tool === 'get_payment_options') {
            const args = JSON.stringify({ pincode: script.pincode });
            yield* emitToolCall('get_payment_options', args, req.signal);
            mockStats.completed += 1;
            return;
        }
        const catalogTool = script as Extract<Script, { productId: string }>;
        const args =
            catalogTool.tool === 'add_to_cart'
                ? `{"product_id":"${catalogTool.productId}","quantity":1}`
                : `{"product_id":"${catalogTool.productId}"}`;
        yield { contentDelta: 'Let me ' };
        yield { contentDelta: 'take care of that.' };
        yield* emitToolCall(catalogTool.tool, args, req.signal);
        mockStats.completed += 1;
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') mockStats.aborted += 1;
        throw err;
    }
}
export const createMockProvider = (): LlmProvider => ({
    id: 'mock',
    streamChat(req: LlmRequest): AsyncIterable<LlmChunk> {
        return run(req);
    },
});
