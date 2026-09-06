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
            try {
                return await api.get<{
                    user: PublicUser;
                }>('/api/auth/me');
            } catch (err) {
                if (!(err instanceof ApiError && err.status === 401)) throw err;
            }
            const cached = queryClient.getQueryData<{ user: PublicUser | null }>(['me']);
            if (cached?.user && !cached.user.isGuest) {
                return { user: null };
            }
            try {
                return await api.post<{
                    user: PublicUser;
                }>('/api/auth/guest');
            } catch {
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
            applyUser: (user: PublicUser) => {
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
