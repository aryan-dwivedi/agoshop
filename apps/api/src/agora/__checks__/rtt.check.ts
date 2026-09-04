/**
 * Real-credential smoke for Agora Real-Time Speech-to-Text v7 — the caption half of
 * plan check S8. Requires Real-Time Speech-to-Text enabled in the Agora Console
 * and the shipped `TRANSCRIPTION_PROVIDER=agora` default:
 *
 *   node --env-file=.env --import tsx apps/api/src/agora/__checks__/rtt.check.ts
 *
 * It drives the seeded `headphones-live` session, then always leaves, so the project's
 * 10 PCW quota is never left holding a worker.
 */
import { eq } from 'drizzle-orm';

import { db, pool } from '../../db/client.js';
import { liveSessions } from '../../db/schema.js';
import { env } from '../../env.js';
import { closeRedis } from '../../lib/redis.js';
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

  const [session] = await db
    .select({ id: liveSessions.id, rtcChannel: liveSessions.rtcChannel, slug: liveSessions.slug })
    .from(liveSessions)
    .where(eq(liveSessions.slug, 'headphones-live'));

  if (!session) {
    check('seeded headphones-live session exists (run npm run db:seed)', false);
    return;
  }
  console.log(`session ${session.slug} (${session.id})  channel ${session.rtcChannel}`);
  console.log(`languages ${env.TRANSCRIPTION_LANGUAGES.join(', ')}\n`);

  try {
    await startRtt({ id: session.id, rtcChannel: session.rtcChannel });
    const after = await statusOf(session.id);
    check('RTT task id persisted on the session', Boolean(after?.taskId), after?.taskId ?? 'none');
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
