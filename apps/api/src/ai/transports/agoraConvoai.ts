import type { ConversationRecord } from '../conversations.js';
import {
  heartbeatConversation,
  interruptConversation,
  startConversation,
  stopConversation,
} from '../conversations.js';
import type { VoiceTransport } from './index.js';

/**
 * The real voice transport: Agora Conversational AI Engine drives ASR → our custom LLM
 * proxy → managed TTS inside the conversation's private RTC channel, and publishes
 * transcripts to the RTM message channel named after that channel.
 *
 * Inbound user speech never reaches this process as data — it reaches Agora, which
 * calls `POST /api/ai/convo/:conversationId/chat/completions`. That is why this
 * transport has no `sendUserTurn`: its inbound edge is the signed callback route, and
 * everything after that point (`runConversationTurn`) is shared with the text
 * transport.
 */
export const agoraConvoAiTransport: VoiceTransport = {
  id: 'agora-convoai',
  degraded: false,

  async start(conversation: ConversationRecord): Promise<{ agentId: string | null }> {
    const { agentId } = await startConversation(conversation);
    return { agentId };
  },

  stop(conversationId, opts): Promise<void> {
    return stopConversation(conversationId, opts);
  },

  heartbeat(conversation): Promise<{ refreshed: boolean }> {
    return heartbeatConversation(conversation);
  },

  interrupt(conversation): Promise<void> {
    return interruptConversation(conversation);
  },
};
