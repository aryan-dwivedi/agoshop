import { and, desc, eq } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { chatMessages, sessionTranscripts, users } from '@shop/db/schema.js';
import { logger } from '@shop/platform/lib/logger.js';

const TRANSCRIPT_LINES = 14;
const CHAT_LINES = 16;
const MAX_LINE_CHARS = 220;
const clamp = (text: string): string => {
    const flat = text.replace(/\s+/gu, ' ').trim();
    return flat.length > MAX_LINE_CHARS ? `${flat.slice(0, MAX_LINE_CHARS - 1)}…` : flat;
};
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
