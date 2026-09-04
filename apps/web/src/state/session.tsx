import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { AppConfig, PublicUser } from '@shop/shared';

import { api, ApiError } from '../lib/api';

type SessionValue = {
  user: PublicUser | null;
  config: AppConfig | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export const SessionProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ['config'],
    queryFn: () => api.get<AppConfig>('/api/config'),
    staleTime: 5 * 60 * 1000,
  });

  /**
   * A visitor with no cookie is bootstrapped into a real `users` row rather than
   * being modelled as a nullable identity: carts, wishlists, orders, AI
   * conversations and every rate-limit bucket are keyed by a user uuid, so a
   * nullable shopper would fork every one of those code paths. The guest row is a
   * normal shopper row flagged by `isGuest`, and signing in later adopts its cart.
   *
   * The bootstrap lives inside the queryFn so exactly one provisioning POST can be
   * in flight per resolution — a row-creating request must never be fired by a
   * render loop or a refetch storm, which is also why `staleTime` is untouched.
   */
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<{ user: PublicUser | null }> => {
      try {
        return await api.get<{ user: PublicUser }>('/api/auth/me');
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 401)) throw err;
      }
      try {
        return await api.post<{ user: PublicUser }>('/api/auth/guest');
      } catch {
        // Rate limited or the guest route is unavailable: stay anonymous so the
        // sign-in empty states remain an honest fallback instead of a retry loop.
        return { user: null };
      }
    },
    staleTime: 60 * 1000,
  });

  const value = useMemo<SessionValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      config: configQuery.data ?? null,
      loading: meQuery.isLoading || configQuery.isLoading,
      refresh: async () => {
        await queryClient.invalidateQueries({ queryKey: ['me'] });
      },
    }),
    [meQuery.data, meQuery.isLoading, configQuery.data, configQuery.isLoading, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = (): SessionValue => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
};
