import type { AppConfig, PublicUser } from '@shop/shared';
import type { ReactNode } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo } from 'react';

import { ApiError, api } from '../lib/api';

type SessionValue = {
    user: PublicUser | null;
    config: AppConfig | null;
    loading: boolean;
    applyUser: (user: PublicUser) => void;
    refresh: () => Promise<void>;
};
const SessionContext = createContext<SessionValue | null>(null);

const preferAuthenticated = (
    next: { user: PublicUser | null },
    cached: { user: PublicUser | null } | undefined,
): { user: PublicUser | null } => {
    if (cached?.user && !cached.user.isGuest && (next.user === null || next.user.isGuest)) {
        return cached;
    }
    if (
        cached?.user &&
        !cached.user.isGuest &&
        next.user &&
        !next.user.isGuest &&
        cached.user.id === next.user.id &&
        cached.user.role !== next.user.role
    ) {
        return cached;
    }
    return next;
};

export const SessionProvider = ({ children }: { children: ReactNode }): JSX.Element => {
    const queryClient = useQueryClient();
    const configQuery = useQuery({
        queryKey: ['config'],
        queryFn: () => api.get<AppConfig>('/api/config'),
        staleTime: 5 * 60 * 1000,
    });
    const meQuery = useQuery({
        queryKey: ['me'],
        queryFn: async (): Promise<{
            user: PublicUser | null;
        }> => {
            const cached = queryClient.getQueryData<{ user: PublicUser | null }>(['me']);
            try {
                const result = await api.get<{
                    user: PublicUser;
                }>('/api/auth/me');
                return preferAuthenticated(result, cached);
            } catch (err) {
                if (!(err instanceof ApiError && err.status === 401)) throw err;
            }
            if (cached?.user && !cached.user.isGuest) {
                return cached;
            }
            try {
                const guest = await api.post<{
                    user: PublicUser;
                }>('/api/auth/guest');
                return preferAuthenticated(guest, cached);
            } catch {
                return cached ?? { user: null };
            }
        },
        staleTime: 60 * 1000,
    });
    const value = useMemo<SessionValue>(
        () => ({
            user: meQuery.data?.user ?? null,
            config: configQuery.data ?? null,
            loading: meQuery.isLoading || configQuery.isLoading,
            applyUser: (user: PublicUser) => {
                queryClient.cancelQueries({ queryKey: ['me'] });
                queryClient.setQueryData(['me'], { user });
            },
            refresh: async () => {
                await queryClient.refetchQueries({ queryKey: ['me'] });
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
