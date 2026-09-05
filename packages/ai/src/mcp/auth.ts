import type { ConversationRecord } from '../conversations.js';
import type { IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { unauthorized } from '@shop/platform/lib/errors.js';
import { env } from '@shop/platform/env.js';
import { callbackConversationId, verifyCallback } from '../callbackAuth.js';
import { loadConversation, loadConversationByAgoraAgentId } from '../conversations.js';

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
const matchesStaticKey = (headers: IncomingHttpHeaders): boolean => {
    const configured = env.MCP_STATIC_API_KEY.trim();
    if (configured.length === 0) return false;
    const authorization = header(headers, 'authorization');
    const apiKey = header(headers, 'x-mcp-api-key');
    const presented =
        authorization?.startsWith('Bearer ') === true
            ? authorization.slice('Bearer '.length)
            : apiKey;
    if (!presented) return false;
    const expected = Buffer.from(configured, 'utf8');
    const given = Buffer.from(presented, 'utf8');
    return expected.length === given.length && timingSafeEqual(expected, given);
};
const conversationIdFromRtcChannel = (channel: string): string | null => {
    if (!channel.startsWith('ai-')) return null;
    return callbackConversationId(channel.slice(3));
};
const resolveConversationId = async (headers: IncomingHttpHeaders): Promise<string | null> => {
    const direct = header(headers, 'x-convo-id');
    if (direct) return callbackConversationId(direct);
    const agentId = header(headers, 'x-agora-agent-id') ?? header(headers, 'x-agent-id');
    if (agentId) {
        const conversation = await loadConversationByAgoraAgentId(agentId);
        if (conversation) return conversation.id;
    }
    const channel = header(headers, 'x-rtc-channel') ?? header(headers, 'x-agora-channel');
    if (channel) return conversationIdFromRtcChannel(channel);
    return null;
};
const assertActiveConversation = (conversation: ConversationRecord): void => {
    if (conversation.status !== 'created' && conversation.status !== 'running') {
        throw unauthorized('conversation_not_active');
    }
    if (conversation.callbackExpiresAt.getTime() <= Date.now()) {
        throw unauthorized('conversation_expired');
    }
};
const parseTurnId = (headers: IncomingHttpHeaders): number => {
    const turnRaw = header(headers, 'x-convo-turn-id');
    const turnId = turnRaw ? Number.parseInt(turnRaw, 10) : 0;
    return Number.isFinite(turnId) ? turnId : 0;
};
export const authenticateMcpRequest = async (
    headers: IncomingHttpHeaders,
): Promise<McpAuthContext> => {
    if (matchesStaticKey(headers)) {
        const conversationId = await resolveConversationId(headers);
        if (!conversationId) throw unauthorized('missing_conversation_id');
        const conversation = await loadConversation(conversationId);
        if (!conversation) throw unauthorized('conversation_not_found');
        assertActiveConversation(conversation);
        return { conversation, turnId: parseTurnId(headers) };
    }
    const conversationId = header(headers, 'x-convo-id');
    const expires = header(headers, 'x-convo-expires');
    const signature = header(headers, 'x-convo-signature');
    if (!conversationId) throw unauthorized('missing_conversation_id');
    const auth = verifyCallback(conversationId, expires, signature);
    if (!auth.ok) throw unauthorized('invalid_mcp_signature');
    const conversation = await loadConversation(conversationId);
    if (!conversation) throw unauthorized('conversation_not_found');
    assertActiveConversation(conversation);
    return { conversation, turnId: parseTurnId(headers) };
};
