import type { NextFunction, Request, Response } from 'express';

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

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const log = req.log ?? logger;
  if (err instanceof AppError) {
    if (err.status >= 500) log.error({ err }, 'request failed');
    else log.warn({ code: err.code, status: err.status }, 'request rejected');
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
  log.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'internal_error', message: 'unexpected server error', requestId: req.requestId },
  });
};
