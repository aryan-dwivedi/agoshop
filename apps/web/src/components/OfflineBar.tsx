import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * §4.7: a state is a sentence about what is true, plus at most one action.
 *
 * This state did not exist anywhere in the app before — every query simply failed
 * quietly and the numbers on screen froze at whatever they last were, which reads as
 * a broken page rather than a broken connection. `Retry` invalidates everything so
 * the shell refetches the moment the shopper says the network is back, instead of
 * waiting for a stale timer.
 */
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
    <div role="status" className="border-b border-line bg-surface">
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
