import type { AiProductCard } from '@shop/shared';
import type { ConversationRecord } from '../conversations.js';
import { agoraConvoAiTransport } from './agoraConvoai.js';
import { textTransport } from './text.js';
export type TransportId = 'agora-convoai' | 'text';
export type TextTurnResult = {
    reply: string;
    language: string;
    toolCalls: {
        name: string;
        outcome: string;
    }[];
    products: AiProductCard[];
};
export type TextTurnHistoryMessage = {
    role: 'user' | 'assistant';
    content: string;
};
export interface VoiceTransport {
    readonly id: TransportId;
    readonly degraded: boolean;
    start(conversation: ConversationRecord): Promise<{
        agentId: string | null;
    }>;
    stop(conversationId: string, opts?: {
        status?: 'stopped' | 'failed';
        reason?: string;
    }): Promise<void>;
    heartbeat(conversation: ConversationRecord): Promise<{
        refreshed: boolean;
    }>;
    interrupt(conversation: ConversationRecord): Promise<void>;
    sendUserTurn?(conversation: ConversationRecord, text: string, history?: TextTurnHistoryMessage[]): Promise<TextTurnResult>;
}
const TRANSPORTS: Record<TransportId, VoiceTransport> = {
    'agora-convoai': agoraConvoAiTransport,
    text: textTransport,
};
export const getTransport = (id: TransportId): VoiceTransport => TRANSPORTS[id];
export const transportForConversation = (conversation: ConversationRecord): VoiceTransport => TRANSPORTS[conversation.transport === 'text' ? 'text' : 'agora-convoai'];
