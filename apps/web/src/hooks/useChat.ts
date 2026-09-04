import { useQuery } from '@tanstack/react-query';
import { type RTMEvents } from 'agora-rtm';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chatShardChannel, type ChatEnvelope } from '@shop/shared';
import { api, ApiError } from '../lib/api';
import { useRtm } from '../realtime/RtmProvider';
import { useSession } from '../state/session';
export type ChatStatus = 'idle' | 'joining' | 'ready' | 'error';
export type ChatMessage = ChatEnvelope;
const SUBSCRIBE_BATCH = 8;
const SUBSCRIBE_INTERVAL_MS = 500;
const MAX_MESSAGES = 300;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms));
export type UseChatResult = {
    messages: ChatMessage[];
    status: ChatStatus;
    progress: {
        subscribed: number;
        total: number;
    };
    error: string | null;
    blocked: string | null;
    sending: boolean;
    send: (text: string, options?: {
        productId?: string;
    }) => Promise<void>;
    historyLoading: boolean;
};
export const useChat = (opts: {
    sessionId: string | null;
    slug: string | undefined;
    mode: 'viewer' | 'host';
    shardIndex: number | null;
    shardCount: number | null;
    liveDelivery: boolean;
    injected?: ChatEnvelope[];
    historyLimit?: number;
}): UseChatResult => {
    const { sessionId, slug, mode, shardIndex, shardCount, liveDelivery, injected, historyLimit = 200, } = opts;
    const { config } = useSession();
    const rtm = useRtm();
    const [live, setLive] = useState<ChatMessage[]>([]);
    const [status, setStatus] = useState<ChatStatus>('idle');
    const [progress, setProgress] = useState({ subscribed: 0, total: 0 });
    const [error, setError] = useState<string | null>(null);
    const [blocked, setBlocked] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const chatServiceAccount = config?.chatServiceAccount ?? null;
    const subscribeRef = useRef(rtm.subscribe);
    subscribeRef.current = rtm.subscribe;
    const history = useQuery<ChatEnvelope[], Error>({
        queryKey: ['session-chat', sessionId, historyLimit],
        queryFn: async () => (await api.get<{
            messages: ChatEnvelope[];
        }>(`/api/sessions/${sessionId}/chat?limit=${historyLimit}`)).messages,
        enabled: Boolean(sessionId),
        staleTime: 30000,
    });
    const ingest = useCallback((envelope: ChatEnvelope) => {
        setLive((current) => {
            const next = current.filter((m) => m.messageId !== envelope.messageId);
            if (envelope.type === 'moderation' && envelope.moderation?.action === 'delete_message') {
                const targetId = envelope.moderation.targetMessageId;
                return targetId ? next.filter((m) => m.messageId !== targetId) : next;
            }
            return [...next, envelope].slice(-MAX_MESSAGES);
        });
    }, []);
    const handleRtmMessage = useCallback((event: RTMEvents.MessageEvent) => {
        if (!chatServiceAccount || event.publisher !== chatServiceAccount)
            return;
        const raw = typeof event.message === 'string' ? event.message : new TextDecoder().decode(event.message);
        try {
            const envelope = JSON.parse(raw) as ChatEnvelope;
            if (envelope.v !== 1)
                return;
            ingest(envelope);
        }
        catch {
        }
    }, [chatServiceAccount, ingest]);
    const channels = useMemo(() => {
        if (!slug || !liveDelivery)
            return [];
        if (mode === 'host') {
            if (!shardCount)
                return [];
            return Array.from({ length: shardCount }, (_, i) => chatShardChannel(slug, i));
        }
        if (shardIndex === null)
            return [];
        return [chatShardChannel(slug, shardIndex)];
    }, [slug, mode, shardIndex, shardCount, liveDelivery]);
    const channelKey = channels.join('|');
    useEffect(() => {
        if (channels.length === 0) {
            setStatus('idle');
            setProgress({ subscribed: 0, total: 0 });
            return;
        }
        let cancelled = false;
        const releases: (() => void)[] = [];
        setStatus('joining');
        setProgress({ subscribed: 0, total: channels.length });
        void (async () => {
            for (let i = 0; i < channels.length; i += SUBSCRIBE_BATCH) {
                if (cancelled)
                    break;
                const batch = channels.slice(i, i + SUBSCRIBE_BATCH);
                try {
                    const released = await Promise.all(batch.map((channel) => subscribeRef.current(channel, handleRtmMessage)));
                    if (cancelled) {
                        for (const release of released)
                            release();
                        return;
                    }
                    releases.push(...released);
                    setProgress({ subscribed: releases.length, total: channels.length });
                }
                catch (err) {
                    if (!cancelled) {
                        setStatus('error');
                        setError(err instanceof Error ? err.message : 'chat_subscribe_failed');
                    }
                    return;
                }
                if (i + SUBSCRIBE_BATCH < channels.length)
                    await sleep(SUBSCRIBE_INTERVAL_MS);
            }
            if (!cancelled) {
                setStatus('ready');
                setError(null);
            }
        })();
        return () => {
            cancelled = true;
            for (const release of releases)
                release();
        };
    }, [channelKey, handleRtmMessage]);
    useEffect(() => {
        if (!injected || injected.length === 0)
            return;
        for (const envelope of injected)
            ingest(envelope);
    }, [injected, ingest]);
    const send = useCallback(async (text: string, options?: {
        productId?: string;
    }): Promise<void> => {
        const body = text.trim();
        if (!sessionId || body.length === 0)
            return;
        setSending(true);
        try {
            const result = await api.post<{
                message: ChatEnvelope;
                transport: string;
            }>(`/api/sessions/${sessionId}/chat`, { messageId: crypto.randomUUID(), text: body, ...options });
            ingest(result.message);
            setBlocked(null);
            setError(null);
        }
        catch (err) {
            if (err instanceof ApiError && err.status === 403 && err.code === 'chat_blocked') {
                setBlocked('You are muted in this session.');
            }
            else if (err instanceof ApiError && err.status === 429) {
                setError('Slow down — you are sending messages too quickly.');
            }
            else {
                setError(err instanceof Error ? err.message : 'chat_send_failed');
            }
        }
        finally {
            setSending(false);
        }
    }, [sessionId, ingest]);
    const messages = useMemo(() => {
        const merged = new Map<string, ChatMessage>();
        for (const envelope of history.data ?? [])
            merged.set(envelope.messageId, envelope);
        for (const envelope of live)
            merged.set(envelope.messageId, envelope);
        return [...merged.values()]
            .filter((m) => m.type === 'chat')
            .sort((a, b) => a.ts - b.ts)
            .slice(-MAX_MESSAGES);
    }, [history.data, live]);
    return {
        messages,
        status,
        progress,
        error: error ?? (rtm.error && liveDelivery ? rtm.error : null),
        blocked,
        sending,
        send,
        historyLoading: history.isLoading,
    };
};
