/**
 * Tool execution — the AI↔commerce boundary.
 *
 * Three properties this module exists to guarantee:
 *
 * 1. **Nothing the model says is trusted.** Every argument object is validated with the
 *    shared zod schema from `@shop/shared` before it reaches a domain function, and a
 *    failure comes back as `{error:{code,message}}` so the model recovers verbally
 *    instead of the callback 500-ing mid-speech.
 * 2. **A retried callback cannot duplicate a cart mutation.** Mutating results are
 *    written to `aiToolCalls` keyed `(conversationId, turnId, name, argsHash)` where
 *    `argsHash = sha256(canonical JSON of the VALIDATED args)`. The key deliberately
 *    excludes `toolCallId`: Agora retrying a callback re-runs the model, which mints a
 *    fresh `call_…` id, so keying on that id would dedupe nothing. On a hit the stored
 *    result is replayed and the domain is never touched again.
 * 3. **Concurrency follows mutability.** Read-only tools run in parallel; `add_to_cart`
 *    and `add_to_wishlist` run serially in model order, because two adds racing would
 *    interleave against the same cart row.
 */

export type { ConversationTurnInput, ConversationTurnResult } from './conversationTurn.js';
export { MAX_ROUNDS, runConversationTurn } from './conversationTurn.js';

export type { AiToolExecutedEvent } from './speakable.js';

export { SurfacedProducts } from './surfacedProducts.js';

export type { ExecutedToolCall, PendingToolCall, ToolOutcome } from './toolExecutor.js';
export { executeToolCalls, hashArgs } from './toolExecutor.js';
