/** One error type, one handler, one wire shape: {error:{code,message,requestId}}. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message?: string, details?: Record<string, unknown>) =>
  new AppError(400, code, message, details);
export const unauthorized = (code = 'unauthorized') => new AppError(401, code);
export const forbidden = (code = 'forbidden') => new AppError(403, code);
export const notFound = (code = 'not_found') => new AppError(404, code);
export const conflict = (code: string, message?: string, details?: Record<string, unknown>) =>
  new AppError(409, code, message, details);
export const unavailable = (code: string, message?: string, details?: Record<string, unknown>) =>
  new AppError(503, code, message, details);
