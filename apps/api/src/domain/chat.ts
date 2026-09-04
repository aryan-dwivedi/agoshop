import { createHash } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import { EVENTS, chatShardChannel } from '@shop/shared';
import type { ChatEnvelope, Role } from '@shop/shared';

import { db } from '../db/client.js';
import { chatMessages, chatModeration, liveSessions, users } from '../db/schema.js';
import { publishAsChatService, publishToShards } from '../agora/signaling.js';
import type { PublishOutcome } from '../agora/signaling.js';
import { track } from '../lib/analytics.js';
import { AppError, notFound } from '../lib/errors.js';
import { chatMessagesTotal } from '../lib/metrics.js';
import { redact } from '../lib/pii.js';
import { keys, redis } from '../lib/redis.js';
import { publishToSession } from '../lib/sse.js';
import { listSessionProducts } from './sessions.js';

/**
 * Server-mediated chat (decision 11). Viewers never publish to RTM: they POST here,
 * the server authorizes, persists, and publishes the canonical envelope as the fixed
 * account `CHAT_SERVICE_RTM_USER`. Clients render a chat event only when its publisher
 * is that account, and user RTM tokens are bound to `user-<id>`, so impersonating the
 * publisher is impossible. The cost is one network hop before a message appears —
 * accepted deliberately, because a mirror-after-publish design cannot enforce a ban
 * until the next token refresh.
 */

/**
 * A viewer's shard is fixed for the life of the session (decision 12). The modulus is
 * the FROZEN `chatShardCount`, never a live viewer count, so nobody is silently
 * re-routed mid-session. The full sha256 digest is read as one big integer; the seed
 * and the server must agree on this exact expression or seeded history lands on a
 * shard nobody is subscribed to.
 */
export const shardIndexFor = (userId: string, chatShardCount: number): number => {
  const digest = createHash('sha256').update(userId).digest('hex');
  return Number(BigInt(`0x${digest}`) % BigInt(Math.max(1, chatShardCount)));
};

/** Host, viewer and backend all derive the full channel set from slug + frozen count. */
export const chatChannelsFor = (slug: string, chatShardCount: number): string[] =>
  Array.from({ length: Math.max(1, chatShardCount) }, (_, i) => chatShardChannel(slug, i));

/**
 * Deliberately small, deliberately labelled: a demo-grade profanity score, not a
 * moderation product. It normalizes common letter substitutions so `sh1t` scores like
 * `shit`, and only sets the `flagged` column — an accepted message is still delivered,
 * because silently dropping text a host cannot see would make the moderation log lie.
 */
const PROFANITY = ['fuck', 'shit', 'bitch', 'bastard', 'asshole', 'cunt', 'dick', 'slut'];

export const profanityScore = (text: string): number => {
  const normalized = text
    .toLowerCase()
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/\$/g, 's')
    .replace(/[^a-z]+/g, ' ');
  let score = 0;
  for (const word of PROFANITY) {
    if (normalized.includes(word)) score += 1;
  }
  return score;
};

/**
 * Ban/mute state lives in Redis because `POST /chat` consults it on every message,
 * which is what makes a ban take effect on the NEXT message rather than the next token
 * refresh. Postgres remains the source of truth: after a Redis flush or a cold replica
 * the sets are rebuilt from `chatModeration` before the first decision is made.
 */
export const ensureChatModerationState = async (sessionId: string): Promise<void> => {
  const bansKey = keys.sessionBans(sessionId);
  const mutesKey = keys.sessionMutes(sessionId);
  const [bansExist, mutesExist] = await Promise.all([
    redis.exists(bansKey),
    redis.exists(mutesKey),
  ]);
  if (bansExist === 1 || mutesExist === 1) return;

  const rows = await db
    .select({ action: chatModeration.action, targetUserId: chatModeration.targetUserId })
    .from(chatModeration)
    .where(eq(chatModeration.sessionId, sessionId))
    .orderBy(asc(chatModeration.createdAt));

  const bans = new Set<string>();
  const mutes = new Set<string>();
  for (const row of rows) {
    if (!row.targetUserId) continue;
    if (row.action === 'ban') bans.add(row.targetUserId);
    if (row.action === 'mute') mutes.add(row.targetUserId);
    if (row.action === 'unmute') {
      mutes.delete(row.targetUserId);
      bans.delete(row.targetUserId);
    }
  }
  const pipeline = redis.pipeline();
  // Sentinel members keep an empty set materialized, so an empty ban list is not
  // mistaken for "never loaded" and re-queried on every single message.
  pipeline.sadd(bansKey, '-', ...bans);
  pipeline.sadd(mutesKey, '-', ...mutes);
  await pipeline.exec();
};

export const chatBlockReason = async (
  sessionId: string,
  userId: string,
): Promise<'banned' | 'muted' | null> => {
  await ensureChatModerationState(sessionId);
  const [banned, muted] = await Promise.all([
    redis.sismember(keys.sessionBans(sessionId), userId),
    redis.sismember(keys.sessionMutes(sessionId), userId),
  ]);
  if (banned === 1) return 'banned';
  if (muted === 1) return 'muted';
  return null;
};

type ChatActor = { id: string; displayName: string; role: Role };

export type PostChatResult = {
  message: ChatEnvelope;
  /** Which transport actually carried the envelope — asserted by tests and the UI. */
  transport: 'rtm-rest' | 'sse-degraded';
  /** True when this exact (session, user, clientMessageId) had already been accepted. */
  replayed: boolean;
  fanOutShards: number;
};

/**
 * The one write path for chat. Order matters and is fixed:
 * authorize -> (route-level rate limit already applied) -> score -> persist -> publish.
 * A blocked user is refused BEFORE anything is published or persisted.
 */
export const postChatMessage = async (a: {
  sessionId: string;
  actor: ChatActor;
  clientMessageId: string;
  text: string;
  productId?: string;
}): Promise<PostChatResult> => {
  const [session] = await db
    .select({
      id: liveSessions.id,
      slug: liveSessions.slug,
      status: liveSessions.status,
      chatShardCount: liveSessions.chatShardCount,
      hostUserId: liveSessions.hostUserId,
    })
    .from(liveSessions)
    .where(eq(liveSessions.id, a.sessionId));
  if (!session) throw notFound('session_not_found');
  if (session.status !== 'live') {
    chatMessagesTotal.inc({ action: 'rejected' });
    throw new AppError(409, 'session_not_live');
  }

  const blocked = await chatBlockReason(session.id, a.actor.id);
  if (blocked) {
    chatMessagesTotal.inc({ action: 'rejected' });
    throw new AppError(403, 'chat_blocked', `you are ${blocked} in this session`);
  }

  const text = redact(a.text.trim());
  if (text.length === 0) throw new AppError(400, 'empty_message');
  let acceptedText = text;

  const isHost = session.hostUserId === a.actor.id || a.actor.role === 'admin';
  let sharedProduct: ChatEnvelope['product'];
  if (a.productId !== undefined) {
    if (!isHost) throw new AppError(403, 'not_session_host');
    sharedProduct = (await listSessionProducts(session.id)).find(
      (product) => product.productId === a.productId,
    );
    if (sharedProduct === undefined) throw notFound('session_product_not_found');
  }

  const shardIndex = shardIndexFor(a.actor.id, session.chatShardCount);
  const flagged = profanityScore(text) > 0;

  const inserted = await db
    .insert(chatMessages)
    .values({
      sessionId: session.id,
      userId: a.actor.id,
      shardIndex,
      clientMessageId: a.clientMessageId,
      text,
      productId: sharedProduct?.productId,
      flagged,
    })
    .onConflictDoNothing({
      target: [chatMessages.sessionId, chatMessages.userId, chatMessages.clientMessageId],
    })
    .returning({ id: chatMessages.id, createdAt: chatMessages.createdAt });

  const row = inserted[0];
  const replayed = row === undefined;
  let createdAt = row?.createdAt ?? new Date();
  if (replayed) {
    // A retried send replays the accepted envelope instead of persisting and
    // re-publishing a duplicate (UNIQUE (sessionId, userId, clientMessageId)).
    const [existing] = await db
      .select({
        text: chatMessages.text,
        productId: chatMessages.productId,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, session.id),
          eq(chatMessages.userId, a.actor.id),
          eq(chatMessages.clientMessageId, a.clientMessageId),
        ),
      );
    if (existing) {
      createdAt = existing.createdAt;
      acceptedText = existing.text;
      if (existing.productId !== sharedProduct?.productId) {
        sharedProduct =
          existing.productId === null
            ? undefined
            : (await listSessionProducts(session.id)).find(
                (product) => product.productId === existing.productId,
              );
      }
    }
  }

  const envelope: ChatEnvelope = {
    v: 1,
    type: 'chat',
    messageId: a.clientMessageId,
    sessionId: session.id,
    shardIndex,
    userId: a.actor.id,
    displayName: a.actor.displayName,
    role: a.actor.role,
    text: acceptedText,
    ...(sharedProduct === undefined ? {} : { product: sharedProduct }),
    ts: createdAt.getTime(),
  };

  // The host subscribes to every shard, so a viewer publishing on its own shard already
  // reaches the host. A host message has to reach every viewer, so the BACKEND fans it
  // out to all shards in bounded batches — never the host client, which is capped at
  // 20 API calls/s.
  const channels = isHost
    ? chatChannelsFor(session.slug, session.chatShardCount)
    : [chatShardChannel(session.slug, shardIndex)];

  const outcome: PublishOutcome =
    channels.length === 1 && channels[0] !== undefined
      ? await publishAsChatService(channels[0], envelope)
      : await publishToShards(channels, envelope);

  let transport: PostChatResult['transport'] = 'rtm-rest';
  if (!outcome.ok) {
    // Signaling REST is unavailable (S5 not yet confirmed, or credentials absent).
    // The message is already persisted and already authoritative, so it is delivered
    // over SSE as an explicitly labelled degraded transport rather than being lost.
    transport = 'sse-degraded';
    await publishToSession(session.id, EVENTS.chatModerated, {
      sessionId: session.id,
      action: 'degraded_chat',
      reason: outcome.reason,
      envelope,
    });
  }

  if (!replayed) {
    chatMessagesTotal.inc({ action: flagged ? 'flagged' : 'accepted' });
    track({ type: 'chat_message', userId: a.actor.id, sessionId: session.id });
  }

  return { message: envelope, transport, replayed, fanOutShards: channels.length };
};

/** Late-join backlog and replay. Live delivery stays RTM-only. */
export const listChatMessages = async (
  sessionId: string,
  limit: number,
): Promise<ChatEnvelope[]> => {
  const rows = await db
    .select({
      clientMessageId: chatMessages.clientMessageId,
      shardIndex: chatMessages.shardIndex,
      userId: chatMessages.userId,
      text: chatMessages.text,
      createdAt: chatMessages.createdAt,
      productId: chatMessages.productId,
      displayName: users.displayName,
      role: users.role,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.status, 'visible')))
    .orderBy(asc(chatMessages.createdAt))
    .limit(Math.min(Math.max(limit, 1), 500));

  const productsById = new Map(
    (rows.some((row) => row.productId !== null) ? await listSessionProducts(sessionId) : []).map(
      (product) => [product.productId, product],
    ),
  );

  return rows.map((row) => ({
    v: 1,
    type: 'chat',
    messageId: row.clientMessageId,
    sessionId,
    shardIndex: row.shardIndex,
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    text: row.text,
    ...(row.productId === null || productsById.get(row.productId) === undefined
      ? {}
      : { product: productsById.get(row.productId)! }),
    ts: row.createdAt.getTime(),
  }));
};
