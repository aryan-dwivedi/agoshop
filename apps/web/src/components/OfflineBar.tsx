import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const OfflineBar = (): JSX.Element | null => {
    const queryClient = useQueryClient();
    const [offline, setOffline] = useState(
        () => typeof navigator !== 'undefined' && !navigator.onLine,
    );
    useEffect(() => {
        const sync = (): void => setOffline(!navigator.onLine);
        window.addEventListener('online', sync);
        window.addEventListener('offline', sync);
        sync();
        return () => {
            window.removeEventListener('online', sync);
            window.removeEventListener('offline', sync);
        };
    }, []);
    if (!offline) return null;
    return (
        <div
            role="status"
            className="border-b border-line bg-surface"
        >
            <div className="mx-auto flex max-w-page items-center gap-2 px-3 py-1.5 text-14 text-t2 md:px-5">
                You&rsquo;re offline.
                <button
                    type="button"
                    className="btn-quiet btn-sm"
                    onClick={() => void queryClient.invalidateQueries()}
                >
                    Retry
                </button>
            </div>
        </div>
    );
};
