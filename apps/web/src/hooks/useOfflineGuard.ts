import { useEffect, useState } from 'react';
export const useOfflineGuard = (): boolean => {
    const [offline, setOffline] = useState(() => !window.navigator.onLine);
    useEffect(() => {
        setOffline(!window.navigator.onLine);
        const goOnline = (): void => setOffline(false);
        const goOffline = (): void => setOffline(true);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
        };
    }, []);
    return offline;
};
