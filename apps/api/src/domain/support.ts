import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';

import { EVENTS } from '@shop/shared';

import { loadConversation, stopConversation } from '../ai/conversations.js';
import { mintRtcToken, nextAgoraUid } from '../agora/tokens.js';
import { db } from '../db/client.js';
import { aiMessages, supportTickets } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { publishToUser } from '../lib/sse.js';

export type SupportTicketDto = {
  id: string;
  conversationId: string;
  userId: string;
  status: string;
  reason: string;
  orderId: string | null;
  preference: string | null;
  phoneE164: string | null;
  rtcChannel: string | null;
  viewerUid: number | null;
  assignedAgentId: string | null;
  supportRtcUid: number | null;
  createdAt: string;
  acceptedAt: string | null;
  transcript: { role: string; text: string; at: string }[];
};

const loadTranscript = async (
  conversationId: string,
): Promise<{ role: string; text: string; at: string }[]> => {
  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content, createdAt: aiMessages.createdAt })
    .from(aiMessages)
    .where(
      and(
        eq(aiMessages.conversationId, conversationId),
        inArray(aiMessages.role, ['user', 'assistant']),
      ),
    )
    .orderBy(asc(aiMessages.id))
    .limit(40);

  return rows.flatMap((r) =>
    r.content ? [{ role: r.role, text: r.content, at: r.createdAt.toISOString() }] : [],
  );
};

export const escalateToHuman = async (input: {
  conversationId: string;
  userId: string;
  reason: string;
  orderId?: string | null;
  preference?: 'voice' | 'callback';
  phoneE164?: string | null;
}): Promise<{
  ticket_id: string;
  status: string;
  estimated_wait_seconds: number;
  message: string;
}> => {
  const existing = await db
    .select({ id: supportTickets.id, status: supportTickets.status })
    .from(supportTickets)
    .where(
      and(
        eq(supportTickets.conversationId, input.conversationId),
        inArray(supportTickets.status, ['queued', 'assigned', 'active']),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return {
      ticket_id: existing[0].id,
      status: existing[0].status,
      estimated_wait_seconds: 60,
      message: 'You are already in the support queue. A human agent will join shortly.',
    };
  }

  const transcript = await loadTranscript(input.conversationId);

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      conversationId: input.conversationId,
      userId: input.userId,
      reason: input.reason,
      orderId: input.orderId ?? null,
      preference: input.preference ?? 'voice',
      phoneE164: input.phoneE164 ?? null,
      transcriptSnapshot: transcript,
      status: 'queued',
    })
    .returning({ id: supportTickets.id });

  await stopConversation(input.conversationId, { status: 'stopped', reason: 'escalated' });

  await publishToUser(input.userId, EVENTS.supportEscalated, {
    ticketId: ticket!.id,
    conversationId: input.conversationId,
    preference: input.preference ?? 'voice',
  });

  return {
    ticket_id: ticket!.id,
    status: 'queued',
    estimated_wait_seconds: 90,
    message:
      input.preference === 'callback'
        ? 'A support agent will call you back shortly.'
        : 'Connecting you to a support agent. Please stay on the line.',
  };
};

export const listSupportQueue = async (): Promise<SupportTicketDto[]> => {
  const rows = await db
    .select()
    .from(supportTickets)
    .where(inArray(supportTickets.status, ['queued', 'assigned', 'active']))
    .orderBy(asc(supportTickets.createdAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    userId: r.userId,
    status: r.status,
    reason: r.reason,
    orderId: r.orderId,
    preference: r.preference,
    phoneE164: r.phoneE164,
    rtcChannel: null,
    viewerUid: null,
    assignedAgentId: r.assignedAgentId,
    supportRtcUid: r.supportRtcUid,
    createdAt: r.createdAt.toISOString(),
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
    transcript: r.transcriptSnapshot ?? [],
  }));
};

export const acceptSupportTicket = async (
  ticketId: string,
  agentUserId: string,
): Promise<{ ticket: SupportTicketDto; rtcToken: string; channel: string; supportUid: number }> => {
  const [row] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) throw notFound('ticket_not_found');
  if (row.status === 'closed' || row.status === 'cancelled') {
    throw conflict('ticket_closed');
  }
  if (row.assignedAgentId && row.assignedAgentId !== agentUserId) {
    throw forbidden('ticket_assigned_elsewhere');
  }

  const supportUid = row.supportRtcUid ?? (await nextAgoraUid());

  const conversation = await loadConversation(row.conversationId);
  if (!conversation) throw notFound('conversation_not_found');

  const acceptedAt = row.acceptedAt ?? new Date();
  const [claimed] = await db
    .update(supportTickets)
    .set({
      status: 'assigned',
      assignedAgentId: agentUserId,
      supportRtcUid: supportUid,
      acceptedAt,
    })
    .where(
      and(
        eq(supportTickets.id, ticketId),
        or(eq(supportTickets.status, 'queued'), eq(supportTickets.assignedAgentId, agentUserId)),
      ),
    )
    .returning();
  if (!claimed || (claimed.assignedAgentId && claimed.assignedAgentId !== agentUserId)) {
    throw forbidden('ticket_assigned_elsewhere');
  }

  const rtcToken = mintRtcToken(conversation.rtcChannel, supportUid, 'publisher');

  return {
    ticket: {
      id: claimed.id,
      conversationId: claimed.conversationId,
      userId: claimed.userId,
      status: claimed.status,
      reason: claimed.reason,
      orderId: claimed.orderId,
      preference: claimed.preference,
      phoneE164: claimed.phoneE164,
      rtcChannel: conversation.rtcChannel,
      viewerUid: conversation.viewerUid,
      assignedAgentId: claimed.assignedAgentId,
      supportRtcUid: supportUid,
      createdAt: claimed.createdAt.toISOString(),
      acceptedAt: claimed.acceptedAt?.toISOString() ?? null,
      transcript: claimed.transcriptSnapshot ?? [],
    },
    rtcToken,
    channel: conversation.rtcChannel,
    supportUid,
  };
};

export const activateSupportTicket = async (
  ticketId: string,
  agentUserId: string,
): Promise<void> => {
  const [row] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) throw notFound('ticket_not_found');
  if (row.assignedAgentId !== agentUserId) throw forbidden('not_your_ticket');
  if (row.status === 'closed' || row.status === 'cancelled') throw conflict('ticket_closed');
  if (row.status === 'active') return;
  if (row.status !== 'assigned') throw conflict('ticket_not_assigned');

  const [activated] = await db
    .update(supportTickets)
    .set({ status: 'active' })
    .where(and(eq(supportTickets.id, ticketId), eq(supportTickets.status, 'assigned')))
    .returning({ id: supportTickets.id });
  if (!activated) return;

  await publishToUser(row.userId, EVENTS.supportAgentJoined, {
    ticketId,
    conversationId: row.conversationId,
    supportUid: row.supportRtcUid,
  });
};

export const closeSupportTicket = async (ticketId: string, agentUserId: string): Promise<void> => {
  const [row] = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) throw notFound('ticket_not_found');
  if (row.assignedAgentId && row.assignedAgentId !== agentUserId) {
    throw forbidden('not_your_ticket');
  }
  const [closed] = await db
    .update(supportTickets)
    .set({ status: 'closed', closedAt: new Date() })
    .where(
      and(
        eq(supportTickets.id, ticketId),
        inArray(supportTickets.status, ['queued', 'assigned', 'active']),
      ),
    )
    .returning({ userId: supportTickets.userId, conversationId: supportTickets.conversationId });
  if (!closed) return;
  await publishToUser(closed.userId, EVENTS.supportCallEnded, {
    ticketId,
    conversationId: closed.conversationId,
  });
};

export const getTicketForShopper = async (
  userId: string,
  conversationId: string,
): Promise<SupportTicketDto | null> => {
  const [row] = await db
    .select()
    .from(supportTickets)
    .where(
      and(eq(supportTickets.conversationId, conversationId), eq(supportTickets.userId, userId)),
    )
    .orderBy(desc(supportTickets.createdAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    userId: row.userId,
    status: row.status,
    reason: row.reason,
    orderId: row.orderId,
    preference: row.preference,
    phoneE164: row.phoneE164,
    rtcChannel: null,
    viewerUid: null,
    assignedAgentId: row.assignedAgentId,
    supportRtcUid: row.supportRtcUid,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    transcript: row.transcriptSnapshot ?? [],
  };
};
