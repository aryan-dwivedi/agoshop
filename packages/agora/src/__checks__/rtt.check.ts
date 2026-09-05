import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { db, pool } from '@shop/db/client.js';
import { liveSessions, sellers, users } from '@shop/db/schema.js';
import { env } from '@shop/platform/env.js';
import { closeRedis } from '@shop/platform/lib/redis.js';

import { queryRtt, startRtt, stopRtt } from '../rtt.js';

const results: string[] = [];
let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
    if (!ok) failures += 1;
    results.push(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const statusOf = async (sessionId: string) => {
    const [row] = await db
        .select({ status: liveSessions.rttStatus, taskId: liveSessions.rttTaskId })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    return row;
};
const run = async (): Promise<void> => {
    check(
        'TRANSCRIPTION_PROVIDER is agora (otherwise startRtt is a documented no-op)',
        env.TRANSCRIPTION_PROVIDER === 'agora',
        env.TRANSCRIPTION_PROVIDER,
    );
    const [seller] = await db
        .select({
            id: sellers.id,
            ownerUserId: sellers.ownerUserId,
            hostName: users.displayName,
        })
        .from(sellers)
        .innerJoin(users, eq(users.id, sellers.ownerUserId))
        .where(eq(sellers.slug, 'pulse-audio'))
        .limit(1);
    if (!seller) {
        check('pulse-audio seller exists in seed data (run npm run db:seed)', false);
        return;
    }
    const hostUserId = seller.ownerUserId;
    const sessionId = randomUUID();
    const slug = `rtt-check-${sessionId.slice(0, 8)}`;
    const rtcChannel = `live-${slug}`;
    await db.insert(liveSessions).values({
        id: sessionId,
        slug,
        sellerId: seller.id,
        title: 'RTT check fixture',
        hostName: seller.hostName,
        hostUserId: hostUserId,
        status: 'scheduled',
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
        rtcChannel,
        language: 'en-US',
        expectedPeakViewers: 4,
        chatShardCount: 1,
        deliveryTier: 'rtc',
    });
    const session = { id: sessionId, rtcChannel, slug };
    console.log(`session ${session.slug} (${session.id})  channel ${session.rtcChannel}`);
    console.log(`languages ${env.TRANSCRIPTION_LANGUAGES.join(', ')}\n`);
    try {
        await startRtt({ id: session.id, rtcChannel: session.rtcChannel });
        const after = await statusOf(session.id);
        check(
            'RTT task id persisted on the session',
            Boolean(after?.taskId),
            after?.taskId ?? 'none',
        );
        check(
            'rttStatus reflects a live worker rather than a failure',
            after?.status === 'running' || after?.status === 'connecting',
            after?.status ?? 'unknown',
        );
        if (after?.taskId) {
            const queried = await queryRtt(session.id);
            check('RTT query resolves the task', queried !== null, JSON.stringify(queried));
        }
    } catch (err) {
        check('startRtt succeeded', false, err instanceof Error ? err.message : String(err));
    } finally {
        try {
            await stopRtt(session.id);
            const ended = await statusOf(session.id);
            check(
                'RTT leave released the worker',
                ended?.status !== 'running',
                ended?.status ?? 'unknown',
            );
        } catch (err) {
            check(
                'RTT leave released the worker',
                false,
                err instanceof Error ? err.message : String(err),
            );
        } finally {
            await db.delete(liveSessions).where(eq(liveSessions.id, session.id));
        }
    }
};
run()
    .then(async () => {
        console.log(results.join('\n'));
        console.log(`\n${results.length - failures}/${results.length} checks passed`);
        await closeRedis();
        await pool.end();
        process.exit(failures === 0 ? 0 : 1);
    })
    .catch(async (err) => {
        console.error(err);
        await closeRedis();
        await pool.end();
        process.exit(1);
    });
