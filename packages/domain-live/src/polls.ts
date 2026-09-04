import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { pollOptions, pollVotes, polls } from '@shop/db/schema.js';
import { track } from '@shop/platform/lib/analytics.js';
import { badRequest, conflict, notFound } from '@shop/platform/lib/errors.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { EVENTS } from '@shop/shared';

export type PollOptionDto = {
    id: string;
    label: string;
    votes: number;
};
export type PollDto = {
    id: string;
    question: string;
    status: 'open' | 'closed';
    options: PollOptionDto[];
    totalVotes: number;
    myOptionId: string | null;
};
export type PollResults = {
    pollId: string;
    sessionId: string;
    question: string;
    status: 'open' | 'closed';
    totalVotes: number;
    options: {
        optionId: string;
        label: string;
        votes: number;
    }[];
};
const countsFor = async (pollId: string, optionIds: string[]): Promise<Record<string, number>> => {
    const key = keys.pollVotes(pollId);
    const cached = await redis.hgetall(key);
    if (Object.keys(cached).length > 0) {
        const counts: Record<string, number> = {};
        for (const id of optionIds) counts[id] = Number(cached[id] ?? 0);
        return counts;
    }
    const rows = await db
        .select({ optionId: pollVotes.optionId, votes: sql<number>`count(*)::int` })
        .from(pollVotes)
        .where(eq(pollVotes.pollId, pollId))
        .groupBy(pollVotes.optionId);
    const counts: Record<string, number> = {};
    for (const id of optionIds) counts[id] = 0;
    for (const row of rows) counts[row.optionId] = row.votes;
    if (rows.length > 0) {
        const flat: string[] = [];
        for (const [id, votes] of Object.entries(counts)) flat.push(id, String(votes));
        await redis.hset(key, ...flat);
        await redis.expire(key, 7 * 24 * 60 * 60);
    }
    return counts;
};
const loadPolls = async (
    where: 'session' | 'poll' | 'open',
    value: string,
    userId: string | null,
): Promise<
    {
        dto: PollDto;
        sessionId: string;
    }[]
> => {
    const pollRows =
        where === 'session'
            ? await db
                  .select()
                  .from(polls)
                  .where(eq(polls.sessionId, value))
                  .orderBy(asc(polls.createdAt))
            : where === 'poll'
              ? await db.select().from(polls).where(eq(polls.id, value))
              : await db.select().from(polls).where(eq(polls.status, 'open'));
    if (pollRows.length === 0) return [];
    const ids = pollRows.map((p) => p.id);
    const optionRows = await db
        .select()
        .from(pollOptions)
        .where(inArray(pollOptions.pollId, ids))
        .orderBy(asc(pollOptions.sortOrder));
    const myVotes = new Map<string, string>();
    if (userId) {
        const voteRows = await db
            .select({ pollId: pollVotes.pollId, optionId: pollVotes.optionId })
            .from(pollVotes)
            .where(and(inArray(pollVotes.pollId, ids), eq(pollVotes.userId, userId)));
        for (const vote of voteRows) myVotes.set(vote.pollId, vote.optionId);
    }
    const out: {
        dto: PollDto;
        sessionId: string;
    }[] = [];
    for (const poll of pollRows) {
        const options = optionRows.filter((o) => o.pollId === poll.id);
        const counts = await countsFor(
            poll.id,
            options.map((o) => o.id),
        );
        const withVotes = options.map((o) => ({
            id: o.id,
            label: o.label,
            votes: counts[o.id] ?? 0,
        }));
        out.push({
            sessionId: poll.sessionId,
            dto: {
                id: poll.id,
                question: poll.question,
                status: poll.status,
                options: withVotes,
                totalVotes: withVotes.reduce((sum, o) => sum + o.votes, 0),
                myOptionId: myVotes.get(poll.id) ?? null,
            },
        });
    }
    return out;
};
export const listPolls = async (sessionId: string, userId: string | null): Promise<PollDto[]> =>
    (await loadPolls('session', sessionId, userId)).map((p) => p.dto);
export const createPoll = async (a: {
    sessionId: string;
    question: string;
    options: string[];
}): Promise<PollDto> => {
    const question = a.question.trim();
    if (question.length === 0) throw badRequest('question_required');
    const labels = a.options.map((o) => o.trim()).filter((o) => o.length > 0);
    if (labels.length < 2) throw badRequest('need_two_options');
    if (labels.length > 6) throw badRequest('too_many_options');
    const pollId = await db.transaction(async (tx) => {
        const [poll] = await tx
            .insert(polls)
            .values({ sessionId: a.sessionId, question })
            .returning({ id: polls.id });
        if (!poll) throw conflict('poll_not_created');
        await tx.insert(pollOptions).values(
            labels.map((label, index) => ({
                pollId: poll.id,
                label,
                sortOrder: index,
            })),
        );
        return poll.id;
    });
    const [loaded] = await loadPolls('poll', pollId, null);
    if (!loaded) throw notFound('poll_not_found');
    await publishToSession(a.sessionId, EVENTS.pollOpened, {
        sessionId: a.sessionId,
        poll: loaded.dto,
    });
    track({ type: 'poll_opened', sessionId: a.sessionId, payload: { pollId } });
    return loaded.dto;
};
export const votePoll = async (a: {
    pollId: string;
    optionId: string;
    userId: string;
}): Promise<PollResults> => {
    const [poll] = await db.select().from(polls).where(eq(polls.id, a.pollId));
    if (!poll) throw notFound('poll_not_found');
    if (poll.status !== 'open') throw conflict('poll_closed');
    const [option] = await db
        .select({ id: pollOptions.id })
        .from(pollOptions)
        .where(eq(pollOptions.id, a.optionId));
    if (!option || option.id !== a.optionId) throw badRequest('unknown_option');
    const inserted = await db
        .insert(pollVotes)
        .values({ pollId: a.pollId, optionId: a.optionId, userId: a.userId })
        .onConflictDoNothing({ target: [pollVotes.pollId, pollVotes.userId] })
        .returning({ optionId: pollVotes.optionId });
    if (inserted.length === 0) throw conflict('already_voted');
    await redis.hincrby(keys.pollVotes(a.pollId), a.optionId, 1);
    return pollResults(a.pollId);
};
export const closePoll = async (pollId: string): Promise<PollResults> => {
    const closed = await db
        .update(polls)
        .set({ status: 'closed', closedAt: new Date() })
        .where(eq(polls.id, pollId))
        .returning({ sessionId: polls.sessionId });
    const row = closed[0];
    if (!row) throw notFound('poll_not_found');
    const results = await pollResults(pollId);
    await publishToSession(row.sessionId, EVENTS.pollClosed, {
        sessionId: row.sessionId,
        pollId,
    });
    track({ type: 'poll_closed', sessionId: row.sessionId, payload: { pollId } });
    return results;
};
export const pollResults = async (pollId: string): Promise<PollResults> => {
    const [loaded] = await loadPolls('poll', pollId, null);
    if (!loaded) throw notFound('poll_not_found');
    return {
        pollId: loaded.dto.id,
        sessionId: loaded.sessionId,
        question: loaded.dto.question,
        status: loaded.dto.status,
        totalVotes: loaded.dto.totalVotes,
        options: loaded.dto.options.map((o) => ({
            optionId: o.id,
            label: o.label,
            votes: o.votes,
        })),
    };
};
export const flushOpenPolls = async (): Promise<void> => {
    const open = await loadPolls('open', '', null);
    for (const entry of open) {
        await publishToSession(entry.sessionId, EVENTS.pollResults, {
            sessionId: entry.sessionId,
            pollId: entry.dto.id,
            options: entry.dto.options,
            totalVotes: entry.dto.totalVotes,
        });
    }
};
