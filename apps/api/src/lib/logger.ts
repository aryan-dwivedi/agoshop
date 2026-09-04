import pino from 'pino';
import { env } from '../env.js';
export const logger = pino({
    level: env.NODE_ENV === 'test' ? 'silent' : 'info',
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-convo-signature"]',
            'headers.authorization',
            'headers.cookie',
            '*.api_key',
            '*.secretKey',
            '*.accessKey',
            'passwordHash',
            'password',
        ],
        censor: '[redacted]',
    },
    transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
});
export type Logger = typeof logger;
