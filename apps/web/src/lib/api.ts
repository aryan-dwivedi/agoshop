export class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    readonly body: unknown;
    constructor(status: number, code: string, message: string, body: unknown) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.body = body;
    }
}
const request = async <T>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    signal?: AbortSignal,
): Promise<T> => {
    const res = await fetch(path, {
        method,
        credentials: 'include',
        headers: {
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(headers ?? {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
    });
    const text = await res.text();
    const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
        const err = (
            parsed as {
                error?: {
                    code?: string;
                    message?: string;
                };
            } | null
        )?.error;
        throw new ApiError(
            res.status,
            err?.code ?? 'request_failed',
            err?.message ?? res.statusText,
            parsed,
        );
    }
    return parsed as T;
};
export const api = {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(
        path: string,
        body?: unknown,
        headers?: Record<string, string>,
        signal?: AbortSignal,
    ) => request<T>('POST', path, body ?? {}, headers, signal),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
    del: <T>(path: string) => request<T>('DELETE', path),
};
export const idempotencyKey = (): string => crypto.randomUUID();
