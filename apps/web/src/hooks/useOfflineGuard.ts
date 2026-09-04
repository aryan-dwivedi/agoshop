import { useEffect, useState } from 'react';

/**
 * The one state the app never had: the stream keeps its last frame and the room goes
 * read-only rather than silently freezing a viewer count and accepting messages that
 * will never send.
 */
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
