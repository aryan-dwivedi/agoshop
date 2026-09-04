import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import { sql } from 'drizzle-orm';

import type { PublicUser } from '@shop/shared';

import { createApp } from '../../app.js';
import { db, pool } from '../../db/client.js';
import { closeRedis } from '../../lib/redis.js';
import { router as authRouter } from '../../routes/auth.js';
import { router as healthRouter } from '../../routes/health.js';
import { router as supportRouter } from '../../routes/support.js';

/**
 * HTTP contract check for the two-phase support handoff. Accepting reserves the ticket;
 * only an agent that has joined RTC and published a microphone may mark it active.
 *
 *   node --env-file=.env --import tsx apps/api/src/domain/__checks__/support.check.ts
 */

const PASSWORD = 'demo1234';
const SHOPPER_EMAIL = 'shopper@demo.test';
const SUPPORT_EMAIL = 'support@demo.test';
const conversationId = randomUUID();
const ticketId = randomUUID();
const channel = `ai-${conversationId}`;

type ApiResponse<T> = { status: number; body: T };
type Client = {
  cookie: string | null;
  request: <T>(method: string, path: string, body?: unknown) => Promise<ApiResponse<T>>;
};
type UserBody = { user: PublicUser };
type AcceptBody = {
  ticket: { id: string; status: string; assignedAgentId: string | null };
  rtcToken: string;
  channel: string;
  supportUid: number;
};

const makeClient = (base: string): Client => {
  const client: Client = {
    cookie: null,
    request: async <T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(client.cookie ? { cookie: client.cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0)
        client.cookie = cookies.map((value) => value.split(';')[0]).join('; ');
      const text = await response.text();
      return {
        status: response.status,
        body: (text ? JSON.parse(text) : null) as T,
      };
    },
  };
  return client;
};

const login = async (client: Client, email: string): Promise<PublicUser> => {
  const response = await client.request<UserBody>('POST', '/api/auth/login', {
    email,
    password: PASSWORD,
  });
  assert.equal(response.status, 200, `login ${email}: ${JSON.stringify(response.body)}`);
  return response.body.user;
};

const ticketStatus = async (): Promise<{ status: string; assignedAgentId: string | null }> => {
  const { rows } = await db.execute<{ status: string; assigned_agent_id: string | null }>(sql`
    select status::text, assigned_agent_id
    from support_tickets
    where id = cast(${ticketId} as uuid)
  `);
  const row = rows[0];
  assert.ok(row, 'support ticket fixture disappeared');
  return { status: row.status, assignedAgentId: row.assigned_agent_id };
};

const cleanup = async (): Promise<void> => {
  await db.execute(sql`delete from support_tickets where id = cast(${ticketId} as uuid)`);
  await db.execute(sql`delete from ai_conversations where id = cast(${conversationId} as uuid)`);
};

const run = async (): Promise<void> => {
  const { rows } = await db.execute<{ id: string }>(sql`
    select id from users where email = ${SHOPPER_EMAIL} limit 1
  `);
  const shopperId = rows[0]?.id;
  assert.ok(shopperId, `seeded shopper ${SHOPPER_EMAIL} not found`);

  await db.execute(sql`
    insert into ai_conversations
      (id, user_id, surface, transport, language, provider, rtc_channel, viewer_uid,
       agent_uid, callback_expires_at, status, ended_at)
    values
      (cast(${conversationId} as uuid), cast(${shopperId} as uuid), 'browse', 'voice',
       'en-US', 'mock', ${channel}, 980001, 980002, now() + interval '1 hour',
       'stopped', now())
  `);
  await db.execute(sql`
    insert into support_tickets
      (id, conversation_id, user_id, status, reason, preference, support_rtc_uid)
    values
      (cast(${ticketId} as uuid), cast(${conversationId} as uuid), cast(${shopperId} as uuid),
       'queued', 'support lifecycle contract check', 'voice', 980003)
  `);

  const app = createApp([healthRouter, authRouter, supportRouter]);
  const listening = Promise.withResolvers<Server>();
  const server: Server = app.listen(0, () => listening.resolve(server));
  await listening.promise;
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const base = `http://127.0.0.1:${port}`;

  try {
    const shopper = makeClient(base);
    await login(shopper, SHOPPER_EMAIL);
    const support = makeClient(base);
    const supportUser = await login(support, SUPPORT_EMAIL);

    const accepted = await support.request<AcceptBody>(
      'POST',
      `/api/support/tickets/${ticketId}/accept`,
    );
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.ticket.status, 'assigned');
    assert.equal(accepted.body.ticket.assignedAgentId, supportUser.id);
    assert.equal(accepted.body.channel, channel);
    assert.ok(accepted.body.rtcToken.length > 20);
    assert.equal(accepted.body.supportUid, 980003);
    assert.deepEqual(await ticketStatus(), {
      status: 'assigned',
      assignedAgentId: supportUser.id,
    });
    console.log('  ok  accept reserves ticket without claiming RTC is active');

    const shopperCannotActivate = await shopper.request(
      'POST',
      `/api/support/tickets/${ticketId}/connected`,
    );
    assert.equal(shopperCannotActivate.status, 403);
    assert.equal((await ticketStatus()).status, 'assigned');
    console.log('  ok  shopper cannot activate an assigned support ticket');

    const connected = await support.request('POST', `/api/support/tickets/${ticketId}/connected`);
    assert.equal(connected.status, 204);
    assert.equal((await ticketStatus()).status, 'active');
    console.log('  ok  RTC-ready agent transitions assigned ticket to active');

    const duplicateConnected = await support.request(
      'POST',
      `/api/support/tickets/${ticketId}/connected`,
    );
    assert.equal(duplicateConnected.status, 204);
    console.log('  ok  connected confirmation is idempotent');

    const closed = await support.request('POST', `/api/support/tickets/${ticketId}/close`);
    assert.equal(closed.status, 204);
    assert.equal((await ticketStatus()).status, 'closed');
    console.log('  ok  closing the call closes the ticket');

    console.log('\nsupport.check PASSED');
  } finally {
    server.close();
    await cleanup();
  }
};

const shutdown = async (): Promise<void> => {
  await closeRedis();
  await pool.end();
};

run()
  .then(shutdown)
  .catch(async (error) => {
    console.error('\nsupport.check FAILED');
    console.error(error);
    await cleanup().catch(() => undefined);
    await shutdown();
    process.exit(1);
  });
