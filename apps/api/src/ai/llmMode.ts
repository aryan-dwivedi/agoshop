import { env } from '../env.js';
import { keys, redis } from '../lib/redis.js';
export type LlmMode = 'mcp' | 'custom';
export const CONVOAI_FAILURE_MESSAGE = "I couldn't reach the catalog just now. Please try again.";
export const getConversationLlmMode = async (conversationId: string): Promise<LlmMode> => {
    if (env.CONVOAI_LLM_MODE === 'custom')
        return 'custom';
    const override = await redis.get(keys.convoLlmMode(conversationId));
    if (override === 'custom' || override === 'mcp')
        return override;
    return 'mcp';
};
export const setConversationLlmMode = async (conversationId: string, mode: LlmMode): Promise<void> => {
    await redis.set(keys.convoLlmMode(conversationId), mode, 'EX', env.CONVO_CALLBACK_TTL_SECONDS);
};
export const clearConversationLlmMode = async (conversationId: string): Promise<void> => {
    await redis.del(keys.convoLlmMode(conversationId));
};
