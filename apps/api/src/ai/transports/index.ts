import type { AiProductCard } from '@shop/shared';

import type { ConversationRecord } from '../conversations.js';
import { agoraConvoAiTransport } from './agoraConvoai.js';
import { textTransport } from './text.js';

/**
 * The transport seam.
 *
 * `agora-convoai` is the real voice pipeline; `text` is the explicitly-labelled
 * degraded transport the client falls back to when admission control refuses a slot,
 * and the one a PSTN gateway or a browser-side STT/LLM/TTS pipeline would sit beside
 * as a third implementation. Conversation lifecycle, the tool surface, transcript
 * persistence and analytics are shared — both implementations drive the single model
 * round engine in `ai/executor.ts` (`runConversationTurn`) and the single lifecycle in
 * `ai/conversations.ts`, so a new transport is a new inbound/outbound edge and nothing
 * else.
 */

export type TransportId = 'agora-convoai' | 'text';

export type TextTurnResult = {
  reply: string;
  language: string;
  toolCalls: { name: string; outcome: string }[];
  /** Cards for the products the turn's catalog tools surfaced; possibly empty. */
  products: AiProductCard[];
};
export type TextTurnHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export interface VoiceTransport {
  readonly id: TransportId;
  /** True for a transport that must never be presented as proof of voice. */
  readonly degraded: boolean;
  start(conversation: ConversationRecord): Promise<{ agentId: string | null }>;
  stop(
    conversationId: string,
    opts?: { status?: 'stopped' | 'failed'; reason?: string },
  ): Promise<void>;
  heartbeat(conversation: ConversationRecord): Promise<{ refreshed: boolean }>;
  interrupt(conversation: ConversationRecord): Promise<void>;
  /** Only a text-driven transport accepts an inbound turn as a request body. */
  sendUserTurn?(
    conversation: ConversationRecord,
    text: string,
    history?: TextTurnHistoryMessage[],
  ): Promise<TextTurnResult>;
}

const TRANSPORTS: Record<TransportId, VoiceTransport> = {
  'agora-convoai': agoraConvoAiTransport,
  text: textTransport,
};

export const getTransport = (id: TransportId): VoiceTransport => TRANSPORTS[id];

/** The transport a conversation row's `transport` column selects. */
export const transportForConversation = (conversation: ConversationRecord): VoiceTransport =>
  TRANSPORTS[conversation.transport === 'text' ? 'text' : 'agora-convoai'];
