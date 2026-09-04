import type { ConversationRecord } from '../conversations.js';
import type { VoiceTransport } from './index.js';

import {
    heartbeatConversation,
    interruptConversation,
    startConversation,
    stopConversation,
} from '../conversations.js';

export const agoraConvoAiTransport: VoiceTransport = {
    id: 'agora-convoai',
    degraded: false,
    async start(conversation: ConversationRecord): Promise<{
        agentId: string | null;
    }> {
        const { agentId } = await startConversation(conversation);
        return { agentId };
    },
    stop(conversationId, opts): Promise<void> {
        return stopConversation(conversationId, opts);
    },
    heartbeat(conversation): Promise<{
        refreshed: boolean;
    }> {
        return heartbeatConversation(conversation);
    },
    interrupt(conversation): Promise<void> {
        return interruptConversation(conversation);
    },
};
