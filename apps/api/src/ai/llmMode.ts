import { env } from '../env.js';
import { keys, redis } from '../lib/redis.js';

export type LlmMode = 'mcp' | 'custom';

/** Agora speaks this when managed LLM / MCP / TTS fails mid-session. */
export const CONVOAI_FAILURE_MESSAGE = "I couldn't reach the catalog just now. Please try again.";

/**
 * Per-conversation LLM/tool path. Redis override is set when MCP join or tool transport
 * fails so the rest of the session (voice rejoin + text turns) stays on custom.
 */
export const getConversationLlmMode = async (conversationId: string): Promise<LlmMode> => {
  if (env.CONVOAI_LLM_MODE === 'custom') return 'custom';
  const override = await redis.get(keys.convoLlmMode(conversationId));
  if (override === 'custom' || override === 'mcp') return override;
  return 'mcp';
};

export const setConversationLlmMode = async (
  conversationId: string,
  mode: LlmMode,
): Promise<void> => {
  await redis.set(keys.convoLlmMode(conversationId), mode, 'EX', env.CONVO_CALLBACK_TTL_SECONDS);
};

export const clearConversationLlmMode = async (conversationId: string): Promise<void> => {
  await redis.del(keys.convoLlmMode(conversationId));
};
