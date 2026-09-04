import type { ReactNode } from 'react';

import { Link } from 'react-router-dom';

import { ApiError } from '../lib/api';

export const EmptyState = ({
    title,
    body,
    action,
    children,
}: {
    title: string;
    body: string;
    action?: {
        to: string;
        label: string;
    };
    children?: ReactNode;
}): JSX.Element => (
    <div className="card flex flex-col items-start gap-3 p-6">
        <div>
            <h3 className="text-16 font-semibold text-t1">{title}</h3>
            <p className="mt-1 max-w-prose text-14 text-t2">{body}</p>
        </div>
        {action !== undefined && (
            <Link
                to={action.to}
                className="btn-standard"
            >
                {action.label}
            </Link>
        )}
        {children}
    </div>
);
const humanReason = (error: Error): string => {
    if (!(error instanceof ApiError)) {
        return 'Your connection dropped before this finished loading.';
    }
    if (error.status === 401 || error.status === 403) {
        return 'You need to be signed in to see this.';
    }
    if (error.status === 404) {
        return 'This is no longer available.';
    }
    if (error.status === 429) {
        return 'Too many requests in a row. Wait a few seconds.';
    }
    return 'Something went wrong at our end. Nothing you did caused it.';
};
export const ErrorState = ({
    title,
    error,
    onRetry,
}: {
    title: string;
    error: Error;
    onRetry?: () => void;
}): JSX.Element => (
    <div className="card flex flex-col items-start gap-3 p-6">
        <div>
            <h3 className="text-16 font-semibold text-t1">{title}</h3>
            <p className="mt-1 max-w-prose text-14 text-t2">{humanReason(error)}</p>
        </div>
        {onRetry !== undefined && (
            <button
                type="button"
                className="btn-standard"
                onClick={onRetry}
            >
                Try again
            </button>
        )}
    </div>
);
