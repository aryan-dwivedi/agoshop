import type { ConversationRecord } from '../conversations.js';
import type { IncomingHttpHeaders } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

import { env } from '@shop/platform/env.js';
import { unauthorized } from '@shop/platform/lib/errors.js';
import { keys, redis } from '@shop/platform/lib/redis.js';

import { callbackConversationId, verifyCallback } from '../callbackAuth.js';
import {
    loadConversation,
    loadConversationByAgoraAgentId,
    loadSingletonRunningConversation,
} from '../conversations.js';
import { isMcpProbeMethod } from './request.js';

export type McpAuthContext = {
    conversation: ConversationRecord;
    turnId: number;
    probe?: boolean;
};
export type McpAuthRequest = {
    httpMethod?: string;
    rpcMethod?: string | null;
};
const PROBE_CONVERSATION_ID = '00000000-0000-4000-8000-000000000099';
const probeConversation = (): ConversationRecord => ({
    id: PROBE_CONVERSATION_ID,
    userId: PROBE_CONVERSATION_ID,
    liveSessionId: null,
    contextProductId: null,
    surface: 'browse',
    transport: 'voice',
    language: 'en-US',
    provider: 'agora',
    rtcChannel: `ai-${PROBE_CONVERSATION_ID}`,
    viewerUid: 0,
    agentUid: 0,
    agoraAgentId: null,
    callbackExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    status: 'running',
});
const header = (headers: IncomingHttpHeaders, name: string): string | undefined => {
    const raw = headers[name.toLowerCase()];
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw[0];
    return undefined;
};
export const matchesStaticMcpKey = (headers: IncomingHttpHeaders): boolean => {
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
        const cached = await redis.get(keys.mcpAgentConversation(agentId));
        if (cached) {
            const parsed = callbackConversationId(cached);
            if (parsed) return parsed;
        }
        const conversation = await loadConversationByAgoraAgentId(agentId);
        if (conversation) return conversation.id;
    }
    const channel = header(headers, 'x-rtc-channel') ?? header(headers, 'x-agora-channel');
    if (channel) return conversationIdFromRtcChannel(channel);
    return null;
};
const resolveStaticSessionConversation = async (): Promise<ConversationRecord | null> => {
    const singleton = await loadSingletonRunningConversation();
    if (singleton) return singleton;
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
const allowsStaticProbe = (request?: McpAuthRequest): boolean => {
    if (request?.httpMethod === 'GET') return true;
    return isMcpProbeMethod(request?.rpcMethod);
};
export const authenticateMcpRequest = async (
    headers: IncomingHttpHeaders,
    request?: McpAuthRequest,
): Promise<McpAuthContext> => {
    if (matchesStaticMcpKey(headers)) {
        const conversationId = await resolveConversationId(headers);
        if (conversationId) {
            const conversation = await loadConversation(conversationId);
            if (!conversation) throw unauthorized('conversation_not_found');
            assertActiveConversation(conversation);
            return { conversation, turnId: parseTurnId(headers) };
        }
        if (allowsStaticProbe(request)) {
            return { conversation: probeConversation(), turnId: 0, probe: true };
        }
        const sessionConversation = await resolveStaticSessionConversation();
        if (sessionConversation) {
            assertActiveConversation(sessionConversation);
            return { conversation: sessionConversation, turnId: parseTurnId(headers) };
        }
        throw unauthorized('missing_conversation_id');
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
