import { buildLiveContextMessage, buildSystemPrompt } from '../systemPrompt.js';
import type { ConversationRecord } from '../conversations.js';
export const getConversationContext = async (conversation: ConversationRecord): Promise<Record<string, unknown>> => {
    const [systemPrompt, liveContext] = await Promise.all([
        buildSystemPrompt(conversation),
        buildLiveContextMessage(conversation),
    ]);
    return {
        system_prompt: systemPrompt,
        live_context: liveContext.content,
        conversation_id: conversation.id,
        surface: conversation.surface,
        language: conversation.language,
    };
};
