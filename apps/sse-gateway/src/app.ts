import type { Express } from 'express';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from '@shop/platform/env.js';
import { requestContext } from '@shop/platform/middleware/context.js';
import { errorHandler, notFoundHandler } from '@shop/platform/middleware/errorHandler.js';
import { loadSession } from '@shop/platform/middleware/session.js';

import { router as eventsRouter } from './routes/events.js';
import { router as metricsRouter } from './routes/metrics.js';

export const createApp = (): Express => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', true);
    app.use(requestContext);
    app.use(
        cors({
            origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
            credentials: true,
            exposedHeaders: ['x-request-id'],
        }),
    );
    app.use(cookieParser(env.SESSION_COOKIE_SECRET));
    app.use(loadSession);
    app.use(eventsRouter);
    app.use(metricsRouter);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
};
