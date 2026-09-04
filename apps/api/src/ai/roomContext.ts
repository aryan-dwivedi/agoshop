import { and, desc, eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { chatMessages, sessionTranscripts, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * What the assistant can overhear in the room it is standing in.
 *
 * A shopper in a live session asks "what did he just say about the fit?" or "someone
 * asked about COD — what was the answer?". Those questions are unanswerable from the
 * catalog alone: they are about the *room*. So the two things the room actually
 * produces — the host's speech, as auto-captions, and the public chat — are read here
 * and prefixed onto every turn as context.
 *
 * Both reads are deliberately server-side rather than sent up by the client:
 *   - the client only holds what arrived after it joined, while the tables hold the
 *     whole session, so a shopper who opened the tab a minute ago still gets context;
 *   - a client-supplied "here is what chat said" is an injection vector — anyone
 *     could claim the host promised 80% off. Only persisted, moderated rows are read.
 *
 * `PRIVACY_MODE=strict` persists no transcript bodies and `TRANSCRIPTION_PROVIDER=off`
 * produces none, so this degrades to chat-only, and then to nothing, with no branch:
 * an empty table is an empty section.
 */

/** Enough host speech for "what did he just say" without crowding the tool budget. */
const TRANSCRIPT_LINES = 14;
/** Enough chat to see the question everyone is asking, not the whole scrollback. */
const CHAT_LINES = 16;
/** Long single messages are truncated rather than dropped: the gist is the value. */
const MAX_LINE_CHARS = 220;

const clamp = (text: string): string => {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > MAX_LINE_CHARS ? `${flat.slice(0, MAX_LINE_CHARS - 1)}…` : flat;
};

/** `mm:ss` from the session start — how a shopper refers to a moment out loud. */
const stamp = (startMs: number): string => {
  const total = Math.max(0, Math.round(startMs / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const recentTranscript = async (sessionId: string): Promise<string[]> => {
  const rows = await db
    .select({
      speaker: sessionTranscripts.speaker,
      text: sessionTranscripts.text,
      startMs: sessionTranscripts.startMs,
    })
    .from(sessionTranscripts)
    .where(eq(sessionTranscripts.sessionId, sessionId))
    .orderBy(desc(sessionTranscripts.startMs))
    .limit(TRANSCRIPT_LINES);

  // Newest-first is how the index is read; oldest-first is how speech is understood.
  return rows
    .reverse()
    .map(
      (row) =>
        `[${stamp(row.startMs)}] ${row.speaker === 'host' ? 'Host' : row.speaker}: ${clamp(row.text)}`,
    );
};

const recentChat = async (sessionId: string): Promise<string[]> => {
  const rows = await db
    .select({
      displayName: users.displayName,
      role: users.role,
      text: chatMessages.text,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.userId))
    .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.status, 'visible')))
    .orderBy(desc(chatMessages.createdAt))
    .limit(CHAT_LINES);

  return rows
    .reverse()
    .map(
      (row) =>
        `${row.displayName}${row.role === 'seller' ? ' (the host)' : row.role === 'admin' ? ' (staff)' : ''}: ${clamp(row.text)}`,
    );
};

/**
 * The room's two transcripts as prompt lines, or `[]` when there is nothing to say.
 * Never throws: a context read that fails must degrade the answer, not the turn.
 */
export const buildRoomContextLines = async (sessionId: string): Promise<string[]> => {
  const [transcript, chat] = await Promise.all([
    recentTranscript(sessionId).catch((err: unknown) => {
      logger.warn({ err, sessionId }, 'transcript context read failed');
      return [] as string[];
    }),
    recentChat(sessionId).catch((err: unknown) => {
      logger.warn({ err, sessionId }, 'chat context read failed');
      return [] as string[];
    }),
  ]);

  const lines: string[] = [];

  if (transcript.length > 0) {
    lines.push(
      'What the host has said most recently, from live speech-to-text (auto-generated, ' +
        'so names and numbers may be misheard — never quote a price from here, look it up):',
      ...transcript,
    );
  }

  if (chat.length > 0) {
    lines.push(
      'The most recent public chat in this room. The shopper can see all of it, so ' +
        '"what did they ask?" or "answer the question in chat" refers to these lines:',
      ...chat,
    );
  }

  return lines;
};
