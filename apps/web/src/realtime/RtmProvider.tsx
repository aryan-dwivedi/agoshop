import AgoraRTM, { type RTMClient, type RTMEvents } from 'agora-rtm';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, } from 'react';
import { rtmAccountForUser } from '@shop/shared';
import { api } from '../lib/api';
type MessageHandler = (event: RTMEvents.MessageEvent) => void;
type RtmTokenResponse = {
    account: string;
    rtmToken: string;
};
type RtmContextValue = {
    client: RTMClient | null;
    loggedIn: boolean;
    error: string | null;
    subscribe: (channel: string, handler: MessageHandler) => Promise<() => void>;
};
const RtmContext = createContext<RtmContextValue | null>(null);
type Subscription = {
    refs: number;
    handlers: Set<MessageHandler>;
};
export const RtmProvider = ({ appId, userId, children, }: {
    appId: string | null;
    userId: string | null;
    children: ReactNode;
}): JSX.Element => {
    const clientRef = useRef<RTMClient | null>(null);
    const subscriptionsRef = useRef(new Map<string, Subscription>());
    const loginPromiseRef = useRef<Promise<RTMClient> | null>(null);
    const [loggedIn, setLoggedIn] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const ensureLogin = useCallback(async (): Promise<RTMClient> => {
        if (clientRef.current && loggedIn)
            return clientRef.current;
        if (loginPromiseRef.current)
            return loginPromiseRef.current;
        if (!appId || !userId)
            throw new Error('rtm_not_configured');
        loginPromiseRef.current = (async () => {
            const client = new AgoraRTM.RTM(appId, rtmAccountForUser(userId));
            clientRef.current = client;
            client.addEventListener('message', (event) => {
                const sub = subscriptionsRef.current.get(event.channelName);
                if (!sub)
                    return;
                for (const handler of sub.handlers)
                    handler(event);
            });
            client.addEventListener('tokenPrivilegeWillExpire', () => {
                void (async () => {
                    try {
                        const { rtmToken } = await api.post<RtmTokenResponse>('/api/rtm/token', {});
                        await client.renewToken(rtmToken);
                    }
                    catch (err) {
                        setError(err instanceof Error ? err.message : 'rtm_token_renewal_failed');
                    }
                })();
            });
            const { rtmToken } = await api.post<RtmTokenResponse>('/api/rtm/token', {});
            await client.login({ token: rtmToken });
            setLoggedIn(true);
            setError(null);
            return client;
        })();
        try {
            return await loginPromiseRef.current;
        }
        catch (err) {
            loginPromiseRef.current = null;
            clientRef.current = null;
            setLoggedIn(false);
            setError(err instanceof Error ? err.message : 'rtm_login_failed');
            throw err;
        }
    }, [appId, userId, loggedIn]);
    const subscribe = useCallback(async (channel: string, handler: MessageHandler): Promise<() => void> => {
        const client = await ensureLogin();
        const existing = subscriptionsRef.current.get(channel);
        if (existing) {
            existing.refs += 1;
            existing.handlers.add(handler);
        }
        else {
            const sub: Subscription = { refs: 1, handlers: new Set([handler]) };
            subscriptionsRef.current.set(channel, sub);
            await client.subscribe(channel, { withMessage: true, withPresence: true });
        }
        let released = false;
        return () => {
            if (released)
                return;
            released = true;
            const sub = subscriptionsRef.current.get(channel);
            if (!sub)
                return;
            sub.handlers.delete(handler);
            sub.refs -= 1;
            if (sub.refs <= 0) {
                subscriptionsRef.current.delete(channel);
                void client.unsubscribe(channel).catch(() => undefined);
            }
        };
    }, [ensureLogin]);
    useEffect(() => {
        if (!appId || !userId)
            return;
        void ensureLogin().catch(() => undefined);
    }, [appId, userId, ensureLogin]);
    useEffect(() => {
        return () => {
            const client = clientRef.current;
            clientRef.current = null;
            loginPromiseRef.current = null;
            subscriptionsRef.current.clear();
            if (client)
                void client.logout().catch(() => undefined);
        };
    }, []);
    const value = useMemo<RtmContextValue>(() => ({ client: clientRef.current, loggedIn, error, subscribe }), [loggedIn, error, subscribe]);
    return <RtmContext.Provider value={value}>{children}</RtmContext.Provider>;
};
export const useRtm = (): RtmContextValue => {
    const ctx = useContext(RtmContext);
    if (!ctx)
        throw new Error('useRtm must be used inside RtmProvider');
    return ctx;
};
