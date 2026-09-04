import { LlmProviderError, type ChatMessage, type LlmChunk, type LlmProvider, type LlmRequest, } from './index.js';
export const mockStats = { streams: 0, aborted: 0, completed: 0 };
let callSeq = 0;
const DIRECTIVE = /\[\[mock:([a-z_]+)(?::([a-z_]+))?(?::([0-9a-fA-F-]{36}))?]]/;
type Script = {
    kind: 'text';
} | {
    kind: 'streaming';
} | {
    kind: 'deferred';
} | {
    kind: 'history';
} | {
    kind: 'references';
} | {
    kind: 'slow';
} | {
    kind: 'error';
} | {
    kind: 'text_tool';
} | {
    kind: 'tool';
    tool: 'add_to_cart' | 'get_product_details';
    productId: string;
};
const lastUserText = (messages: ChatMessage[]): string => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]!;
        if (message.role === 'user' && typeof message.content === 'string')
            return message.content;
    }
    return '';
};
const chooseScript = (messages: ChatMessage[]): Script => {
    if (messages.some((m) => m.role === 'tool'))
        return { kind: 'text' };
    const match = DIRECTIVE.exec(lastUserText(messages));
    if (!match)
        return { kind: 'text' };
    const [, kind, tool, productId] = match;
    if (kind === 'slow')
        return { kind: 'slow' };
    if (kind === 'streaming')
        return { kind: 'streaming' };
    if (kind === 'deferred')
        return { kind: 'deferred' };
    if (kind === 'text_tool')
        return { kind: 'text_tool' };
    if (kind === 'references')
        return { kind: 'references' };
    if (kind === 'history')
        return { kind: 'history' };
    if (kind === 'error')
        return { kind: 'error' };
    if (kind === 'tool' && productId) {
        return {
            kind: 'tool',
            tool: tool === 'details' ? 'get_product_details' : 'add_to_cart',
            productId,
        };
    }
    return { kind: 'text' };
};
const abortError = (): Error => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return err;
};
const blockUntilAborted = (signal: AbortSignal): Promise<never> => new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
        reject(abortError());
        return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
});
const CLOSING = [
    'Done — ',
    'that is in your cart ',
    'with the live discount applied. ',
    'Anything else?',
];
const OPENING = ['Sure. ', 'Looking at the catalog ', 'for you ', 'right now.'];
async function* run(req: LlmRequest): AsyncGenerator<LlmChunk> {
    mockStats.streams += 1;
    const script = chooseScript(req.messages);
    const closing = req.messages.some((m) => m.role === 'tool');
    const closingTool = [...req.messages].reverse().find((message) => message.role === 'tool')?.name;
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
            const answer = req.toolChoice === 'none'
                ? ["I'm doing well ", 'and ready to help. ', 'What are you shopping for?']
                : ['Give me one second, ', "I'm checking that."];
            for (const delta of answer)
                yield { contentDelta: delta };
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
            const references = req.messages.find((message) => message.role === 'system' &&
                typeof message.content === 'string' &&
                message.content.startsWith('Canonical catalog references'));
            yield {
                contentDelta: typeof references?.content === 'string'
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
        if (script.kind === 'text') {
            const answer = closing && closingTool === 'check_delivery'
                ? ['Yes — ', 'delivery is available to 560001.']
                : closing
                    ? CLOSING
                    : OPENING;
            for (const delta of answer) {
                if (req.signal.aborted)
                    throw abortError();
                yield { contentDelta: delta };
            }
            yield { finishReason: 'stop' };
            mockStats.completed += 1;
            return;
        }
        const id = `call_mock_${(callSeq += 1)}`;
        const args = script.tool === 'add_to_cart'
            ? `{"product_id":"${script.productId}","quantity":1}`
            : `{"product_id":"${script.productId}"}`;
        const split = Math.floor(args.length / 3);
        yield { contentDelta: 'Let me ' };
        yield { contentDelta: 'take care of that.' };
        yield { toolCalls: [{ index: 0, id, name: script.tool, argumentsDelta: '' }] };
        yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(0, split) }] };
        yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(split, split * 2) }] };
        yield { toolCalls: [{ index: 0, argumentsDelta: args.slice(split * 2) }] };
        yield { finishReason: 'tool_calls' };
        mockStats.completed += 1;
    }
    catch (err) {
        if (err instanceof Error && err.name === 'AbortError')
            mockStats.aborted += 1;
        throw err;
    }
}
export const createMockProvider = (): LlmProvider => ({
    id: 'mock',
    streamChat(req: LlmRequest): AsyncIterable<LlmChunk> {
        return run(req);
    },
});
