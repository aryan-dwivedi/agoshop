import type { Router } from 'express';
import { eq } from 'drizzle-orm';
import { requireMediaGateway, rtmpServerUrl } from '../../agora/ingress.js';
import { ensureGatewayUid, mintObsIngest } from '../../agora/mediagateway.js';
import { db } from '../../db/client.js';
import { liveSessions } from '../../db/schema.js';
import { env } from '../../env.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requireSessionHost } from '../../middleware/session.js';
import { idParam } from './schemas.js';
export const registerObsRoutes = (router: Router): void => {
    router.post('/api/sessions/:id/obs-ingest', requireSessionHost, async (req, res, next) => {
        try {
            requireMediaGateway(env.MEDIA_GATEWAY_ENABLED);
            const id = idParam.safeParse(req.params.id);
            if (!id.success)
                throw badRequest('invalid_session_id');
            const sessionId = id.data;
            const [row] = await db
                .select({ id: liveSessions.id, rtcChannel: liveSessions.rtcChannel, status: liveSessions.status })
                .from(liveSessions)
                .where(eq(liveSessions.id, sessionId));
            if (!row)
                throw notFound('session_not_found');
            const credentials = await mintObsIngest({ id: row.id, rtcChannel: row.rtcChannel });
            res.json(credentials);
        }
        catch (err) {
            next(err);
        }
    });
    router.get('/api/sessions/:id/obs-ingest', requireSessionHost, async (req, res, next) => {
        try {
            requireMediaGateway(env.MEDIA_GATEWAY_ENABLED);
            const id = idParam.safeParse(req.params.id);
            if (!id.success)
                throw badRequest('invalid_session_id');
            const sessionId = id.data;
            const [row] = await db
                .select({
                id: liveSessions.id,
                rtcChannel: liveSessions.rtcChannel,
                status: liveSessions.status,
                mediaGatewayUid: liveSessions.mediaGatewayUid,
            })
                .from(liveSessions)
                .where(eq(liveSessions.id, sessionId));
            if (!row)
                throw notFound('session_not_found');
            const uid = row.mediaGatewayUid ?? (await ensureGatewayUid(sessionId));
            const base = {
                rtmpServer: rtmpServerUrl(env.MEDIA_GATEWAY_REGION),
                uid,
                channel: row.rtcChannel,
                expiresAfter: env.MEDIA_GATEWAY_KEY_TTL_SECONDS,
            };
            if (row.status !== 'live') {
                res.json({ ...base, streamKey: null });
                return;
            }
            const credentials = await mintObsIngest({ id: row.id, rtcChannel: row.rtcChannel });
            res.json(credentials);
        }
        catch (err) {
            next(err);
        }
    });
};
