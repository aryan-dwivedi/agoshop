import { Redis } from 'ioredis';

import { env } from '../env.js';
import { logger } from './logger.js';

/** Command connection — sessions, leases, streams, and SSE publish. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });

redis.on('error', (err) => logger.error({ err, conn: 'redis' }, 'redis connection error'));

export const keys = {
  session: (id: string) => `sess:${id}`,
  sessionStatus: (id: string) => `session:${id}:status`,
  sessionTier: (id: string) => `session:${id}:deliveryTier`,
  sessionViewers: (id: string) => `session:${id}:viewers`,
  sessionReactions: (id: string) => `session:${id}:reactions`,
  sessionBans: (id: string) => `session:${id}:bans`,
  sessionMutes: (id: string) => `session:${id}:mutes`,
  pollVotes: (pollId: string) => `poll:${pollId}:votes`,
  aiAgents: 'ai:agents',
  idempotency: (userId: string, key: string) => `idem:${userId}:${key}`,
  analyticsStream: 'analytics:events',
  summaryStream: 'jobs:session-summary',
  orderCaptureStream: 'jobs:order-capture',
  searchIndexStream: 'jobs:search-index',
  promotionsCache: 'promo:v1:active',
  checkoutPolicyCache: 'policy:v1:active',
  /** Per-conversation LLM mode override (`mcp` | `custom`) when MCP join/tools fail. */
  convoLlmMode: (conversationId: string) => `convo:${conversationId}:llm_mode`,
  /** Ephemeral OBS stream key for best-effort revoke on session end. */
  obsStreamKey: (sessionId: string) => `session:${sessionId}:obsStreamKey`,
} as const;

export const closeRedis = async (): Promise<void> => {
  await redis.quit();
};
