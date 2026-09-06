import type { Router } from 'express';

import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@shop/db/client.js';
import { sessionTranscripts, users } from '@shop/db/schema.js';
import { postChatMessage } from '@shop/domain-live/chat.js';
import { applyModeration } from '@shop/domain-live/moderation.js';
import { createPoll } from '@shop/domain-live/polls.js';
import { addReaction } from '@shop/domain-live/reactions.js';
import { badRequest, unauthorized } from '@shop/platform/lib/errors.js';
import { persistBodies, redact } from '@shop/platform/lib/pii.js';
import { BUDGETS, rateLimit } from '@shop/platform/lib/ratelimit.js';
import { publishToSession } from '@shop/platform/lib/sse.js';
import { ensureIdentity, requireSessionHost } from '@shop/platform/middleware/session.js';
import { EVENTS } from '@shop/shared';

import { chatBody, idParam, moderationBody, pollBody, transcriptBody } from './schemas.js';

export const registerEngagementRoutes = (router: Router): void => {
    router.post(
        '/api/sessions/:id/chat',
        ensureIdentity,
        rateLimit('chat', BUDGETS.chat),
        async (req, res, next) => {
            try {
                const session = req.session;
                if (!session) throw unauthorized();
                const id = idParam.safeParse(req.params.id);
                if (!id.success) throw badRequest('invalid_session_id');
                const parsed = chatBody.safeParse(req.body);
                if (!parsed.success)
                    throw badRequest('invalid_body', parsed.error.issues[0]?.message);
                const [actor] = await db
                    .select({ displayName: users.displayName })
                    .from(users)
                    .where(eq(users.id, session.userId));
                res.json(
                    await postChatMessage({
                        sessionId: id.data,
                        actor: {
                            id: session.userId,
                            displayName: actor?.displayName ?? 'Shopper',
                            role: session.role,
                        },
                        clientMessageId: parsed.data.messageId,
                        text: parsed.data.text,
                        productId: parsed.data.productId,
                    }),
                );
            } catch (err) {
                next(err);
            }
        },
    );
    router.post('/api/sessions/:id/moderation', requireSessionHost, async (req, res, next) => {
        try {
            const session = req.session;
            if (!session) throw unauthorized();
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const parsed = moderationBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            res.json(
                await applyModeration({
                    sessionId: id.data,
                    actor: { userId: session.userId, role: session.role },
                    action: parsed.data.action,
                    targetUserId: parsed.data.targetUserId ?? null,
                    targetMessageId: parsed.data.targetMessageId ?? null,
                }),
            );
        } catch (err) {
            next(err);
        }
    });
    router.post(
        '/api/sessions/:id/reactions',
        ensureIdentity,
        rateLimit('reactions', BUDGETS.reactions),
        async (req, res, next) => {
            try {
                const session = req.session;
                if (!session) throw unauthorized();
                const id = idParam.safeParse(req.params.id);
                if (!id.success) throw badRequest('invalid_session_id');
                const parsed = z.object({ emoji: z.string().min(1).max(16) }).safeParse(req.body);
                if (!parsed.success)
                    throw badRequest('invalid_body', parsed.error.issues[0]?.message);
                res.json({
                    counts: await addReaction(id.data, session.userId, parsed.data.emoji),
                });
            } catch (err) {
                next(err);
            }
        },
    );
    router.post('/api/sessions/:id/polls', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const parsed = pollBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            res.status(201).json({
                poll: await createPoll({
                    sessionId: id.data,
                    question: parsed.data.question,
                    options: parsed.data.options,
                }),
            });
        } catch (err) {
            next(err);
        }
    });
    router.post('/api/sessions/:id/transcript', requireSessionHost, async (req, res, next) => {
        try {
            const id = idParam.safeParse(req.params.id);
            if (!id.success) throw badRequest('invalid_session_id');
            const parsed = transcriptBody.safeParse(req.body);
            if (!parsed.success) throw badRequest('invalid_body', parsed.error.issues[0]?.message);
            const sessionId = id.data;
            const lines = parsed.data.lines.map((line) => ({
                captionId: line.captionId,
                sessionId,
                speaker: line.speaker ?? 'host',
                language: line.language,
                text: redact(line.text),
                translatedText: line.translatedText ?? {},
                startMs: line.startMs,
                finalized: line.finalized,
            }));
            const finalizedLines = lines
                .filter((line) => line.finalized)
                .map((line) => ({
                    sessionId: line.sessionId,
                    speaker: line.speaker,
                    language: line.language,
                    text: line.text,
                    translatedText: line.translatedText,
                    startMs: line.startMs,
                }));
            if (persistBodies && finalizedLines.length > 0) {
                await db.insert(sessionTranscripts).values(finalizedLines);
            }
            for (const line of lines) {
                await publishToSession(sessionId, EVENTS.sessionCaption, {
                    sessionId,
                    captionId: line.captionId,
                    text: line.text,
                    language: line.language,
                    startMs: line.startMs,
                    speaker: line.speaker,
                    finalized: line.finalized,
                    ...(Object.keys(line.translatedText).length > 0
                        ? { translatedText: line.translatedText }
                        : {}),
                });
            }
            res.json({
                accepted: lines.length,
                persisted: persistBodies ? finalizedLines.length : 0,
            });
        } catch (err) {
            next(err);
        }
    });
};
