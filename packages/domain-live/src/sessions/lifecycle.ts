import type { Tx } from '@shop/db/client.js';

import { and, eq, isNotNull, lte, sql } from 'drizzle-orm';

import { revokeObsIngest } from '@shop/agora/mediagateway.js';
import { createConverter, deleteConverter } from '@shop/agora/mediapush.js';
import { startRecording, stopRecording } from '@shop/agora/recording.js';
import { startRtt, stopRtt } from '@shop/agora/rtt.js';
import { db } from '@shop/db/client.js';
import { cartItems, carts, liveSessions } from '@shop/db/schema.js';
import { getCart } from '@shop/domain-commerce/cart.js';
import { env } from '@shop/platform/env.js';
import { track } from '@shop/platform/lib/analytics.js';
import { conflict, notFound } from '@shop/platform/lib/errors.js';
import { logger } from '@shop/platform/lib/logger.js';
import { keys, redis } from '@shop/platform/lib/redis.js';
import { publishToSession, publishToUser } from '@shop/platform/lib/sse.js';
import { EVENTS, MAX_CHAT_SHARDS } from '@shop/shared';

import { getSessionById } from './queries.js';

export const frozenShardCount = (expectedPeakViewers: number): number =>
    Math.min(
        MAX_CHAT_SHARDS,
        Math.max(1, Math.ceil(expectedPeakViewers / env.RTM_CHAT_SHARD_TARGET)),
    );
const publishStatus = async (row: typeof liveSessions.$inferSelect): Promise<void> => {
    await publishToSession(row.id, EVENTS.sessionStatusChanged, {
        sessionId: row.id,
        slug: row.slug,
        status: row.status,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        chatShardCount: row.chatShardCount,
        deliveryTier: row.deliveryTier,
    });
};
const withLifecycleLock = async (
    kind: 'start' | 'end',
    sessionId: string,
    work: (tx: Tx) => Promise<void>,
): Promise<void> => {
    await db.transaction(async (tx) => {
        await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${kind}:${sessionId}`}, 0))`,
        );
        await work(tx);
    });
};
const logSettledFailures = (
    message: string,
    sessionId: string,
    results: PromiseSettledResult<void>[],
): void => {
    for (const result of results) {
        if (result.status === 'rejected') {
            logger.error({ err: result.reason, sessionId }, message);
        }
    }
};
const repairSessionStart = async (
    sessionId: string,
    attemptSideServices: boolean,
): Promise<void> => {
    let sideSession: { id: string; slug: string; rtcChannel: string } | null = null;
    await withLifecycleLock('start', sessionId, async (tx) => {
        const [row] = await tx.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
        if (!row) throw notFound('session_not_found');
        if (row.status !== 'live') throw conflict('session_not_startable');
        sideSession = { id: row.id, slug: row.slug, rtcChannel: row.rtcChannel };
        if (row.startEffectsCompletedAt) return;
        await redis
            .pipeline()
            .set(keys.sessionStatus(sessionId), 'live')
            .set(keys.sessionTier(sessionId), row.deliveryTier)
            .del(keys.sessionViewers(sessionId))
            .exec();
        await publishStatus(row);
        await tx
            .update(liveSessions)
            .set({ startEffectsCompletedAt: new Date() })
            .where(eq(liveSessions.id, sessionId));
        track({ type: 'session_started', sessionId });
    });
    if (!attemptSideServices || sideSession === null) return;
    const current = sideSession as { id: string; slug: string; rtcChannel: string };
    const results = await Promise.allSettled([
        startRecording({ id: current.id, rtcChannel: current.rtcChannel }),
        startRtt({ id: current.id, rtcChannel: current.rtcChannel }),
        createConverter({
            id: current.id,
            slug: current.slug,
            rtcChannel: current.rtcChannel,
        }),
    ]);
    logSettledFailures('session side service start failed', sessionId, results);
};
const repairSessionEnd = async (sessionId: string, attemptSideServices: boolean): Promise<void> => {
    await withLifecycleLock('end', sessionId, async (tx) => {
        const [row] = await tx.select().from(liveSessions).where(eq(liveSessions.id, sessionId));
        if (!row) throw notFound('session_not_found');
        if (row.status !== 'ended') throw conflict('session_not_live');
        if (row.endEffectsCompletedAt) return;
        await redis
            .pipeline()
            .set(keys.sessionStatus(sessionId), 'ended')
            .del(keys.sessionViewers(sessionId))
            .exec();
        await publishStatus(row);
        const holders = await db
            .selectDistinct({ userId: carts.userId })
            .from(cartItems)
            .innerJoin(carts, eq(carts.id, cartItems.cartId))
            .where(eq(cartItems.liveSessionId, sessionId));
        await Promise.all(
            holders.map(async (holder) => {
                const cart = await getCart(holder.userId);
                await publishToUser(holder.userId, EVENTS.cartUpdated, cart);
            }),
        );
        await redis.xadd(keys.summaryStream, '*', 'sessionId', sessionId);
        await tx
            .update(liveSessions)
            .set({ endEffectsCompletedAt: new Date() })
            .where(eq(liveSessions.id, sessionId));
        track({ type: 'session_ended', sessionId });
    });
    if (!attemptSideServices) return;
    const results = await Promise.allSettled([
        stopRecording(sessionId),
        stopRtt(sessionId),
        deleteConverter(sessionId),
        revokeObsIngest(sessionId),
    ]);
    logSettledFailures('session side service cleanup failed', sessionId, results);
};
export const startSession = async (
    sessionId: string,
    options: {
        consentAcknowledged?: boolean;
        actorUserId?: string;
    } = {},
) => {
    const [current] = await db
        .select({
            status: liveSessions.status,
            expectedPeakViewers: liveSessions.expectedPeakViewers,
        })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    if (!current) throw notFound('session_not_found');
    if (current.status === 'ended') throw conflict('session_already_ended');
    const shardCount = frozenShardCount(current.expectedPeakViewers);
    const won = await db
        .update(liveSessions)
        .set({
            status: 'live',
            startedAt: new Date(),
            chatShardCount: shardCount,
            deliveryTier: 'rtc',
            deliveryTierPublishedAt: null,
            ...(options.consentAcknowledged ? { recordingConsentAt: new Date() } : {}),
        })
        .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.status, 'scheduled')))
        .returning({ id: liveSessions.id });
    const transitioned = won.length > 0;
    if (!transitioned) {
        const dto = await getSessionById(sessionId);
        if (!dto) throw notFound('session_not_found');
        if (dto.status !== 'live') throw conflict('session_not_startable');
    }
    await repairSessionStart(sessionId, transitioned);
    if (transitioned && options.consentAcknowledged) {
        track({
            type: 'recording_consent',
            sessionId,
            userId: options.actorUserId ?? null,
        });
    }
    const dto = await getSessionById(sessionId);
    if (!dto) throw notFound('session_not_found');
    return { session: dto, transitioned };
};
export const endSession = async (sessionId: string) => {
    const won = await db
        .update(liveSessions)
        .set({ status: 'ended', endedAt: new Date(), endEffectsCompletedAt: null })
        .where(and(eq(liveSessions.id, sessionId), eq(liveSessions.status, 'live')))
        .returning({ id: liveSessions.id });
    const transitioned = won.length > 0;
    if (!transitioned) {
        const dto = await getSessionById(sessionId);
        if (!dto) throw notFound('session_not_found');
        if (dto.status !== 'ended') throw conflict('session_not_live');
    }
    await repairSessionEnd(sessionId, transitioned);
    const dto = await getSessionById(sessionId);
    if (!dto) throw notFound('session_not_found');
    return { session: dto, transitioned };
};
export const reconcileSessionEffects = async (): Promise<number> => {
    const rows = await db
        .select({ id: liveSessions.id, status: liveSessions.status })
        .from(liveSessions)
        .where(isNotNull(liveSessions.startedAt))
        .limit(100);
    let repaired = 0;
    for (const row of rows) {
        try {
            if (row.status === 'live') {
                await repairSessionStart(row.id, true);
                repaired += 1;
            } else if (row.status === 'ended') {
                await repairSessionEnd(row.id, true);
                repaired += 1;
            }
        } catch (err) {
            logger.warn(
                { err, sessionId: row.id, status: row.status },
                'session lifecycle repair deferred',
            );
        }
    }
    return repaired;
};
export const startDuePremieres = async (): Promise<number> => {
    const due = await db
        .select({ id: liveSessions.id })
        .from(liveSessions)
        .where(
            and(
                eq(liveSessions.status, 'scheduled'),
                eq(liveSessions.autoStart, true),
                isNotNull(liveSessions.scheduledFor),
                lte(liveSessions.scheduledFor, new Date()),
            ),
        );
    if (due.length === 0) return 0;
    const results = await Promise.allSettled(due.map((row) => startSession(row.id)));
    let started = 0;
    results.forEach((result, index) => {
        const sessionId = due[index]?.id;
        if (result.status === 'rejected') {
            logger.error({ err: result.reason, sessionId }, 'premiere auto-start failed');
            return;
        }
        if (result.value.transitioned) {
            started += 1;
            logger.info({ sessionId }, 'premiere auto-started');
        }
    });
    return started;
};
