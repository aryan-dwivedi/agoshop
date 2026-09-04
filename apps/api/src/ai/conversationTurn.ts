import { and, eq } from 'drizzle-orm';

import { SHOPPING_TOOLS, toolSchemas, type AiProductCard, type ToolName } from '@shop/shared';

import { db } from '../db/client.js';
import { aiMessages } from '../db/schema.js';
import { env } from '../env.js';
import { logger } from '../lib/logger.js';
import { persistBodies, redact } from '../lib/pii.js';
import type { ConversationRecord } from './conversations.js';
import { getProvider, type ChatMessage, type LlmProvider } from './providers/index.js';
import { SurfacedProducts } from './surfacedProducts.js';
import { executeToolCalls, type ExecutedToolCall, type PendingToolCall } from './toolExecutor.js';

/** Agora's tool-round budget for this proxy: three rounds, then answer. */
export const MAX_ROUNDS = 3;

type AccumulatedToolCall = { id: string; name: string; arguments: string };

/**
 * Accumulates streamed `delta.tool_calls` fragments BY `index`. The first fragment for
 * an index carries `id` and `function.name`; later fragments only append to
 * `function.arguments`, so anything keyed differently produces invalid JSON.
 */
class ToolCallAccumulator {
  private readonly byIndex = new Map<number, AccumulatedToolCall>();

  private readonly order: number[] = [];

  add(index: number, id?: string, name?: string, argumentsDelta?: string): void {
    let call = this.byIndex.get(index);
    if (!call) {
      call = { id: id ?? '', name: name ?? '', arguments: '' };
      this.byIndex.set(index, call);
      this.order.push(index);
    }
    if (id) call.id = id;
    if (name) call.name = name;
    if (argumentsDelta) call.arguments += argumentsDelta;
  }

  get size(): number {
    return this.byIndex.size;
  }

  /** Model order — the order the tool result messages must be appended in. */
  drain(): PendingToolCall[] {
    const calls = this.order.map((index) => this.byIndex.get(index)!);
    this.byIndex.clear();
    this.order.length = 0;
    return calls;
  }
}

const persistAssistantText = async (
  conversation: ConversationRecord,
  turnId: number,
  text: string,
): Promise<void> => {
  if (text.trim().length === 0) return;
  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'assistant',
    content: persistBodies ? redact(text) : null,
    turnId,
  });
};

/**
 * The inbound user turn. Agora replays its whole bounded history on every callback, so
 * the row is written only when this turn has not been recorded yet — otherwise a
 * retried callback would duplicate the transcript line.
 */
const persistUserText = async (
  conversation: ConversationRecord,
  turnId: number,
  messages: ChatMessage[],
): Promise<void> => {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser || typeof lastUser.content !== 'string') return;

  const [existing] = await db
    .select({ id: aiMessages.id })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.conversationId, conversation.id),
        eq(aiMessages.turnId, turnId),
        eq(aiMessages.role, 'user'),
      ),
    )
    .limit(1);
  if (existing) return;

  await db.insert(aiMessages).values({
    conversationId: conversation.id,
    role: 'user',
    content: persistBodies ? redact(lastUser.content) : null,
    turnId,
  });
};

export type ConversationTurnInput = {
  conversation: ConversationRecord;
  /** Provider-facing history, already prefixed with the fresh live-context message. */
  messages: ChatMessage[];
  turnId: number;
  signal: AbortSignal;
  /** Assistant text as it arrives; the SSE transport forwards each delta immediately. */
  onText: (delta: string) => void;
};

export type ConversationTurnResult = {
  text: string;
  rounds: number;
  executed: ExecutedToolCall[];
  capped: boolean;
  /** Products the turn's catalog tools surfaced, for the panel to render as cards. */
  products: AiProductCard[];
};

/** Last resort only: the forced closing round produced nothing at all. */
const CAPPED_SENTENCE = "I couldn't finish that check just now. Please try the question once more.";

/**
 * A completed model stream is not necessarily a completed answer. These deliberately
 * narrow patterns catch turns that only ask the shopper to wait — the failure mode that
 * otherwise looks like a hung chat — without rejecting a real answer that happens to
 * explain that a check was performed.
 */
const DEFERRED_ONLY_REPLY = [
  /^\s*(?:give me (?:one|a) (?:second|moment)|(?:just )?(?:one|a) moment|hang on|please wait)(?:[,;—-]\s*(?:i(?:'m| am)|let me|i(?:'ll| will))\s+(?:check(?:ing)?|look(?:ing)?(?: into)?|find(?:ing)? out)\b[^.!?]*)?[.!?]?\s*$/i,
  /^\s*(?:i(?:'m| am)|let me|i(?:'ll| will))\s+(?:check(?:ing)?|look(?:ing)?(?: into)?|find(?:ing)? out)\b[^.!?]*[.!?]?\s*$/i,
];

const isDeferredOnlyReply = (text: string): boolean =>
  DEFERRED_ONLY_REPLY.some((pattern) => pattern.test(text));

/**
 * Some OpenAI-compatible models occasionally print their tool protocol as assistant
 * text instead of emitting `delta.tool_calls`. Recover the two formats observed in
 * production, then send them through the same validator and executor as native calls.
 */
const parseTextualToolCalls = (text: string, idPrefix: string): PendingToolCall[] | null => {
  const trimmed = text.trim();
  if (!trimmed.toLowerCase().startsWith('<tool_call>')) return null;

  const bodies = [...trimmed.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/giu)].map(
    (match) => match[1]?.trim() ?? '',
  );
  if (
    bodies.length === 0 ||
    trimmed.replace(/<tool_call>\s*[\s\S]*?\s*<\/tool_call>/giu, '').trim().length > 0
  ) {
    return null;
  }

  const calls: PendingToolCall[] = [];
  for (const [index, body] of bodies.entries()) {
    const direct = /^([a-z_][a-z0-9_]*)\s*([\s\S]*)$/iu.exec(body);
    let name: string | null = direct?.[1] ?? null;
    let jsonText = (direct?.[2] ?? body).trim();
    // Models sometimes wrap an already-braced object in one extra pair: `{{...}}`.
    if (jsonText.startsWith('{{') && jsonText.endsWith('}}')) {
      jsonText = jsonText.slice(1, -1);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(jsonText);
    } catch {
      return null;
    }

    if (name === null) {
      if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
      const envelope = decoded as Record<string, unknown>;
      const nested =
        envelope.function !== null &&
        typeof envelope.function === 'object' &&
        !Array.isArray(envelope.function)
          ? (envelope.function as Record<string, unknown>)
          : null;
      name =
        typeof envelope.name === 'string'
          ? envelope.name
          : typeof nested?.name === 'string'
            ? nested.name
            : null;
      decoded = envelope.arguments ?? envelope.parameters ?? nested?.arguments ?? {};
      if (typeof decoded === 'string') {
        try {
          decoded = JSON.parse(decoded);
        } catch {
          return null;
        }
      }
    }

    if (
      name === null ||
      !(name in toolSchemas) ||
      decoded === null ||
      typeof decoded !== 'object' ||
      Array.isArray(decoded)
    ) {
      return null;
    }
    calls.push({
      id: `textual_${idPrefix}_${index}`,
      name: name as ToolName,
      arguments: JSON.stringify(decoded),
    });
  }
  return calls;
};

const DEFERRED_REPAIR_INSTRUCTION: ChatMessage = {
  role: 'system',
  content:
    'Your prior draft only asked the shopper to wait and did not answer them. Replace it now ' +
    'with a complete, direct answer. Do not mention waiting, checking, delays, or this correction. ' +
    'Tools are disabled; if a fact is unavailable, say so plainly and give one useful next step.',
};

/**
 * `tool_choice:'none'` alone leaves some models returning an empty completion where
 * they wanted a tool call, so the closing round also SAYS what is being asked of it.
 */
const CLOSING_INSTRUCTION: ChatMessage = {
  role: 'system',
  content:
    'Tool calls are disabled for this reply. Answer the shopper now, in their language, ' +
    'using only the tool results already in this conversation. If the results contain ' +
    'nothing that matches what they asked for, say so plainly and offer the closest ' +
    'product you did find. Do not promise to check again.',
};

/**
 * The turn's last word, for the two ways a turn can otherwise end in silence: the model
 * spent every tool round without answering, or it closed the turn with an empty
 * completion. One more round with the tools switched OFF — it cannot call another tool,
 * so it must answer from the results already in the transcript, and "nothing in the
 * catalog matches that" is a real answer. Only if this also comes back empty does the
 * shopper get the canned line.
 */
const forceClosingAnswer = async (
  provider: LlmProvider,
  input: ConversationTurnInput,
): Promise<string> => {
  const { conversation, messages, turnId, signal, onText } = input;
  let closing = '';
  try {
    for await (const chunk of provider.streamChat({
      model: env.LLM_MODEL,
      messages: [...messages, CLOSING_INSTRUCTION],
      tools: SHOPPING_TOOLS,
      toolChoice: 'none',
      signal,
    })) {
      if (chunk.contentDelta) closing += chunk.contentDelta;
    }
  } catch (err) {
    logger.warn(
      { err, conversationId: conversation.id, turnId },
      'forced closing round failed; falling back to the canned sentence',
    );
  }

  if (closing.trim().length === 0 || isDeferredOnlyReply(closing)) {
    closing = CAPPED_SENTENCE;
  }
  onText(closing);
  await persistAssistantText(conversation, turnId, closing);
  return closing;
};

/**
 * One user turn, up to `MAX_ROUNDS` model rounds. Both transports drive this, which is
 * what makes the degraded text path genuinely the same assistant.
 *
 * The message-ordering contract is enforced here and nowhere else: on
 * `finish_reason:'tool_calls'` the COMPLETE assistant message (its `content` plus the
 * ordered `tool_calls`) is appended FIRST, then the tools run, then one
 * `{role:'tool', tool_call_id, content}` message per result is appended in the same
 * order. Appending tool results without that preceding assistant message is a protocol
 * violation providers reject or mis-handle.
 */
export const runConversationTurn = async (
  input: ConversationTurnInput,
): Promise<ConversationTurnResult> => {
  const { conversation, messages, turnId, signal, onText } = input;
  const provider = getProvider(conversation.provider);

  await persistUserText(conversation, turnId, messages).catch((err: unknown) =>
    logger.warn({ err, conversationId: conversation.id }, 'user turn persist failed'),
  );

  const executed: ExecutedToolCall[] = [];
  const surfaced = new SurfacedProducts();
  let fullText = '';
  let rounds = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    rounds = round + 1;
    const accumulator = new ToolCallAccumulator();
    let roundText = '';
    let finishReason: string | undefined;
    // Hold only a possible `<tool_call>` prefix. Normal speech still streams as soon
    // as its first non-whitespace characters prove it is conversational text.
    let withholdingProtocol = true;

    for await (const chunk of provider.streamChat({
      model: env.LLM_MODEL,
      messages,
      tools: SHOPPING_TOOLS,
      toolChoice: 'auto',
      signal,
    })) {
      if (chunk.contentDelta) {
        roundText += chunk.contentDelta;
        if (withholdingProtocol) {
          const candidate = roundText.trimStart().toLowerCase();
          if (
            candidate.length > 0 &&
            !'<tool_call>'.startsWith(candidate) &&
            !candidate.startsWith('<tool_call>')
          ) {
            withholdingProtocol = false;
            onText(roundText);
          }
        } else {
          onText(chunk.contentDelta);
        }
      }
      for (const call of chunk.toolCalls ?? []) {
        accumulator.add(call.index, call.id, call.name, call.argumentsDelta);
      }
      if (chunk.finishReason) finishReason = chunk.finishReason;
    }

    const textualCalls =
      accumulator.size === 0 ? parseTextualToolCalls(roundText, `${turnId}_${round}`) : null;
    const malformedProtocol =
      textualCalls === null &&
      withholdingProtocol &&
      roundText.trimStart().toLowerCase().startsWith('<tool_call');
    const answerText = textualCalls !== null || malformedProtocol ? '' : roundText;
    const terminalWithoutTools =
      textualCalls === null && (finishReason !== 'tool_calls' || accumulator.size === 0);
    const deferredOnly = terminalWithoutTools && isDeferredOnlyReply(answerText);

    // Tool protocol is never speech or conversation history. Whitespace and a
    // wait-only draft are not answers either.
    if (answerText.trim().length > 0 && !deferredOnly) {
      fullText += answerText;
      await persistAssistantText(conversation, turnId, answerText);
    }

    if (terminalWithoutTools) {
      if (deferredOnly) {
        rounds += 1;
        const repair = await forceClosingAnswer(provider, {
          ...input,
          messages: [
            ...messages,
            { role: 'assistant', content: answerText },
            DEFERRED_REPAIR_INSTRUCTION,
          ],
        });
        return {
          text: repair,
          rounds,
          executed,
          capped: false,
          products: surfaced.cards(repair),
        };
      }
      if (fullText.trim().length > 0) {
        return {
          text: fullText,
          rounds,
          executed,
          capped: false,
          products: surfaced.cards(fullText),
        };
      }
      // The model ended the turn saying nothing at all. An empty bubble is the worst
      // possible answer, so make it answer with what the tools already returned.
      rounds += 1;
      const closing = await forceClosingAnswer(provider, input);
      return {
        text: closing,
        rounds,
        executed,
        capped: false,
        products: surfaced.cards(closing),
      };
    }

    const calls = textualCalls ?? accumulator.drain();

    // 1. The assistant message, complete and FIRST.
    messages.push({
      role: 'assistant',
      content: answerText.length > 0 ? answerText : null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    // 2. Execute: read-only in parallel, mutating serially in model order.
    const results = await executeToolCalls(conversation, turnId, calls, surfaced);
    executed.push(...results);

    // 3. One tool message per result, in the same order.
    for (const result of results) {
      messages.push({
        role: 'tool',
        tool_call_id: result.id,
        name: result.name,
        content: JSON.stringify(result.result),
      });
    }
  }

  // The tool budget is spent; close the turn with an answer rather than another search.
  rounds += 1;
  fullText += await forceClosingAnswer(provider, input);
  return { text: fullText, rounds, executed, capped: true, products: surfaced.cards(fullText) };
};
