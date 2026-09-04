import type { IncomingHttpHeaders } from 'node:http';

import { verifyCallback } from '../ai/callbackAuth.js';
import { loadConversation, type ConversationRecord } from '../ai/conversations.js';
import { unauthorized } from '../lib/errors.js';

export type McpAuthContext = {
  conversation: ConversationRecord;
  turnId: number;
};

const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
  const raw = headers[name.toLowerCase()];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw[0];
  return undefined;
};

/**
 * Agora forwards the per-conversation HMAC headers minted in the ConvoAI join body.
 * `X-Convo-Id` may appear in headers even though the signature is scoped to that id.
 */
export const authenticateMcpRequest = async (
  headers: IncomingHttpHeaders,
): Promise<McpAuthContext> => {
  const conversationId = header(headers, 'x-convo-id');
  const expires = header(headers, 'x-convo-expires');
  const signature = header(headers, 'x-convo-signature');
  const turnRaw = header(headers, 'x-convo-turn-id');

  if (!conversationId) throw unauthorized('missing_conversation_id');

  const auth = verifyCallback(conversationId, expires, signature);
  if (!auth.ok) throw unauthorized('invalid_mcp_signature');

  const conversation = await loadConversation(conversationId);
  if (!conversation) throw unauthorized('conversation_not_found');
  if (conversation.callbackExpiresAt.getTime() <= Date.now()) {
    throw unauthorized('conversation_expired');
  }

  const turnId = turnRaw ? Number.parseInt(turnRaw, 10) : 0;
  return { conversation, turnId: Number.isFinite(turnId) ? turnId : 0 };
};
