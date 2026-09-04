import type { NextFunction, Request, Response } from 'express';
import { LlmProviderError } from '../ai/providers/index.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
export const notFoundHandler = (req: Request, res: Response): void => {
    res.status(404).json({
        error: {
            code: 'route_not_found',
            message: `${req.method} ${req.path}`,
            requestId: req.requestId,
        },
    });
};
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const log = req.log ?? logger;
    if (err instanceof AppError) {
        if (err.status >= 500)
            log.error({ err }, 'request failed');
        else
            log.warn({ code: err.code, status: err.status }, 'request rejected');
        res.status(err.status).json({
            error: {
                code: err.code,
                message: err.message,
                requestId: req.requestId,
                ...(err.details ?? {}),
            },
        });
        return;
    }
    if (err instanceof LlmProviderError) {
        log.error({ err, provider: err.provider }, 'llm provider failed');
        res.status(502).json({
            error: {
                code: 'llm_provider_error',
                message: 'the language model provider rejected the request',
                requestId: req.requestId,
            },
        });
        return;
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
        log.warn({ err }, 'request timed out');
        res.status(504).json({
            error: {
                code: 'turn_timeout',
                message: 'the assistant took too long to respond',
                requestId: req.requestId,
            },
        });
        return;
    }
    log.error({ err }, 'unhandled error');
    res.status(500).json({
        error: { code: 'internal_error', message: 'unexpected server error', requestId: req.requestId },
    });
};
