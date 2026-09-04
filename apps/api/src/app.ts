import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import { env } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/context.js';
import { loadSession } from './middleware/session.js';
const STREAMING_PATHS = ['/api/events', '/api/ai/', '/mcp'];
export const createApp = (routers: Router[]): Express => {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
    app.use(requestContext);
    app.use(cors({
        origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
        credentials: true,
        exposedHeaders: ['x-request-id', 'Idempotent-Replay', 'Retry-After'],
    }));
    app.use(compression({
        filter: (req, res) => {
            if (STREAMING_PATHS.some((p) => req.path.startsWith(p)))
                return false;
            return compression.filter(req, res);
        },
    }));
    app.use('/api/webhooks/agora', express.raw({ type: '*/*', limit: '1mb' }));
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser(env.SESSION_COOKIE_SECRET));
    app.use('/media/recordings', express.static(env.RECORDING_LOCAL_DIR, {
        fallthrough: true,
        index: false,
        maxAge: '60s',
    }));
    app.use(loadSession);
    for (const router of routers)
        app.use(router);
    app.use(notFoundHandler);
    app.use(errorHandler);
    return app;
};
