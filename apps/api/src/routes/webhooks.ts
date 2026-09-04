import { createHmac, timingSafeEqual } from 'node:crypto';

import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { onRecordingWebhook } from '../agora/recording.js';
import { stopConversation } from '../ai/conversations.js';
import { db } from '../db/client.js';
import { aiConversations } from '../db/schema.js';
import { env } from '../env.js';
import { track } from '../lib/analytics.js';
import { logger } from '../lib/logger.js';

/**
 * Agora Notification Center (NCS) receiver.
 *
 * `app.ts` installs `express.raw` on this path, because the signature is an HMAC over
 * the RAW body — re-serialising parsed JSON would not reproduce the bytes Agora signed.
 *
 * Agora requires a 200 within 10 s, retries three times, then drops the event.
 * **NCS delivery is therefore not guaranteed**, which is exactly why nothing here is a
 * primary mechanism: the ConvoAI lease sweeper and the Cloud Recording `query` poll in
 * `background.ts` stay authoritative, and these events only make convergence faster.
 * We acknowledge first and process on the next tick, so a slow database write can never
 * turn into an Agora retry.
 */
export const router = Router();

/** ConvoAI: 101 joined, 102 left, 103 dialogue history, 110 error, 111 metrics. */
const CONVOAI_AGENT_LEFT = 102;
const CONVOAI_AGENT_ERROR = 110;
const CONVOAI_METRICS = 111;
/** Cloud Recording: 31 uploaded, 1 error, 11 session_exit. */
const RECORDING_UPLOADED = 31;
const RECORDING_ERROR = 1;
const RECORDING_SESSION_EXIT = 11;

type NcsEvent = {
  noticeId?: string;
  productId?: number;
  eventType?: number;
  notifyMs?: number;
  sid?: string;
  payload?: Record<string, unknown>;
};

const verifySignature = (raw: Buffer, header: unknown): boolean => {
  if (typeof header !== 'string' || header.length === 0) return false;
  const expected = createHmac('sha256', env.AGORA_WEBHOOK_SECRET).update(raw).digest('hex');
  const given = Buffer.from(header.trim().toLowerCase(), 'utf8');
  const mine = Buffer.from(expected, 'utf8');
  return given.length === mine.length && timingSafeEqual(given, mine);
};

/**
 * ConvoAI events name the channel, not our conversation id. The channel is
 * `ai-<conversationId>` by construction (decision 1), with `agent_id` as the fallback
 * for any payload that omits the channel.
 */
const resolveConversationId = async (payload: Record<string, unknown>): Promise<string | null> => {
  const channel = typeof payload.channel_name === 'string' ? payload.channel_name : null;
  if (channel && channel.startsWith('ai-')) return channel.slice(3);

  const agentId = typeof payload.agent_id === 'string' ? payload.agent_id : null;
  if (!agentId) return null;
  const [row] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(eq(aiConversations.agoraAgentId, agentId));
  return row?.id ?? null;
};

const handleConvoAi = async (
  eventType: number,
  payload: Record<string, unknown>,
): Promise<void> => {
  if (eventType === CONVOAI_METRICS) {
    track({ type: 'ai_agent_metrics', payload: { ...payload, source: 'ncs' } });
    return;
  }

  const conversationId = await resolveConversationId(payload);
  if (!conversationId) {
    logger.warn({ eventType }, 'convoai webhook could not be mapped to a conversation');
    return;
  }

  if (eventType === CONVOAI_AGENT_LEFT) {
    // Releases the admission lease and marks the row stopped; idempotent.
    await stopConversation(conversationId, { status: 'stopped', reason: 'agora_agent_left' });
    return;
  }

  await stopConversation(conversationId, { status: 'failed', reason: 'agora_error' });
  track({
    type: 'ai_error',
    payload: { conversationId, stage: 'agent', source: 'ncs', detail: payload },
  });
};

const handleEvent = async (event: NcsEvent): Promise<void> => {
  const payload = event.payload ?? {};
  const eventType = event.eventType;
  if (typeof eventType !== 'number') {
    logger.warn({ noticeId: event.noticeId }, 'agora webhook carried no eventType');
    return;
  }

  if (
    eventType === CONVOAI_AGENT_LEFT ||
    eventType === CONVOAI_AGENT_ERROR ||
    eventType === CONVOAI_METRICS
  ) {
    await handleConvoAi(eventType, payload);
    return;
  }

  if (
    eventType === RECORDING_UPLOADED ||
    eventType === RECORDING_ERROR ||
    eventType === RECORDING_SESSION_EXIT
  ) {
    const sid = event.sid ?? (typeof payload.sid === 'string' ? payload.sid : '');
    if (!sid) {
      logger.warn({ eventType }, 'recording webhook carried no sid');
      return;
    }
    await onRecordingWebhook({ sid, eventType, payload });
    return;
  }

  logger.debug({ eventType }, 'agora webhook event ignored');
};

router.post('/api/webhooks/agora', (req, res, next) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    if (env.AGORA_WEBHOOK_SECRET.length === 0) {
      // Verification is impossible without the secret, and silently accepting unsigned
      // callbacks would be worse than refusing them. The sweeper and the `query` poll
      // already keep state converging, so refusing costs correctness nothing.
      logger.warn('agora webhook received but AGORA_WEBHOOK_SECRET is unset; refusing');
      res.status(503).json({ error: { code: 'webhook_not_configured', requestId: req.requestId } });
      return;
    }

    if (!verifySignature(raw, req.header('agora-signature-v2'))) {
      res.status(401).json({ error: { code: 'invalid_signature', requestId: req.requestId } });
      return;
    }

    let event: NcsEvent;
    try {
      event = JSON.parse(raw.toString('utf8')) as NcsEvent;
    } catch {
      res.status(400).json({ error: { code: 'invalid_body', requestId: req.requestId } });
      return;
    }

    // Acknowledge well inside Agora's 10 s window, then do the work.
    res.status(200).json({ ok: true });
    logger.info({ eventType: event.eventType, noticeId: event.noticeId }, 'agora webhook accepted');

    setImmediate(() => {
      void handleEvent(event).catch((err) =>
        logger.error(
          { err, eventType: event.eventType, noticeId: event.noticeId },
          'agora webhook processing failed',
        ),
      );
    });
  } catch (err) {
    next(err);
  }
});
