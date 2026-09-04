import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVENTS, type ChatEnvelope, type DeliveryTier, type JoinSessionDto, type LiveSessionDto, type ServerEvent, type SessionStatus, } from '@shop/shared';
import { api, ApiError } from '../lib/api';
import { useServerEvents } from '../lib/useServerEvents';
export type PollOption = {
    id: string;
    label: string;
    votes: number;
};
export type PollDto = {
    id: string;
    question: string;
    status: 'open' | 'closed';
    options: PollOption[];
    totalVotes: number;
    myOptionId: string | null;
};
export type CaptionLine = {
    id: string;
    text: string;
    language: string;
    startMs: number;
    speaker: string;
};
export type ReactionState = {
    counts: Record<string, number>;
    deltas: Record<string, number>;
    tick: number;
};
export type ModerationNotice = {
    action: string;
    targetUserId?: string;
    targetMessageId?: string;
    ts: number;
};
export type HlsOrigin = {
    url: string;
    originKind: 'media-push' | 'simulated-origin';
};
type StatusChangedData = {
    sessionId: string;
    status: SessionStatus;
};
type TierChangedData = {
    sessionId: string;
    deliveryTier: DeliveryTier;
    hlsUrl: string | null;
    hlsOriginKind: 'media-push' | 'simulated-origin' | null;
};
type ViewersData = {
    sessionId: string;
    viewerCount: number;
};
type PinnedData = {
    sessionId: string;
    productId: string | null;
};
type ReactionsData = {
    sessionId: string;
    counts: Record<string, number>;
    deltas: Record<string, number>;
};
type CaptionData = {
    captionId: string;
    sessionId: string;
    text: string;
    language: string;
    startMs: number;
    speaker: string;
    finalized: boolean;
};
type PollOpenedData = {
    sessionId: string;
    poll: PollDto;
};
type PollResultsData = {
    sessionId: string;
    pollId: string;
    options: PollOption[];
    totalVotes: number;
};
type PollClosedData = {
    sessionId: string;
    pollId: string;
};
type ModeratedData = {
    sessionId: string;
    action: string;
    targetUserId?: string;
    targetMessageId?: string;
    envelope?: ChatEnvelope;
};
const MAX_CAPTIONS = 40;
export type LiveSessionState = {
    query: UseQueryResult<LiveSessionDto, Error>;
    session: LiveSessionDto | null;
    join: JoinSessionDto | null;
    joinError: ApiError | null;
    joining: boolean;
    deliveryTier: DeliveryTier;
    hls: HlsOrigin | null;
    liveClock: {
        startedAtMs: number;
        skewMs: number;
    } | null;
    serverSkewMs: number;
    viewerCount: number;
    captions: CaptionLine[];
    reactions: ReactionState;
    poll: PollDto | null;
    applyPoll: (poll: PollDto | null) => void;
    pinnedProductId: string | null;
    moderation: ModerationNotice | null;
    degradedChat: ChatEnvelope[];
};
export const useLiveSession = (slug: string | undefined, opts: {
    role: 'viewer' | 'host';
}): LiveSessionState => {
    const { role } = opts;
    const skewRef = useRef(0);
    const [serverSkewMs, setServerSkewMs] = useState(0);
    const query = useQuery<LiveSessionDto, Error>({
        queryKey: ['session', slug],
        queryFn: async () => {
            const { session: snapshot } = await api.get<{
                session: LiveSessionDto;
            }>(`/api/sessions/${slug}`);
            skewRef.current = snapshot.serverNowMs - Date.now();
            return snapshot;
        },
        enabled: Boolean(slug),
        staleTime: 10000,
    });
    const session = query.data ?? null;
    const sessionId = session?.id ?? null;
    const [join, setJoin] = useState<JoinSessionDto | null>(null);
    const [joinError, setJoinError] = useState<ApiError | null>(null);
    const [joining, setJoining] = useState(false);
    const [deliveryTier, setDeliveryTier] = useState<DeliveryTier>('rtc');
    const [hls, setHls] = useState<HlsOrigin | null>(null);
    const [viewerCount, setViewerCount] = useState(0);
    const [captions, setCaptions] = useState<CaptionLine[]>([]);
    const [reactions, setReactions] = useState<ReactionState>({ counts: {}, deltas: {}, tick: 0 });
    const [poll, setPoll] = useState<PollDto | null>(null);
    const [pinnedProductId, setPinnedProductId] = useState<string | null>(null);
    const [moderation, setModeration] = useState<ModerationNotice | null>(null);
    const [degradedChat, setDegradedChat] = useState<ChatEnvelope[]>([]);
    const cdnLatchedRef = useRef(false);
    const joinedForRef = useRef<string | null>(null);
    const liveViewerCountRef = useRef(false);
    const latchCdn = useCallback((origin: HlsOrigin | null) => {
        cdnLatchedRef.current = true;
        setDeliveryTier('cdn');
        if (origin)
            setHls(origin);
    }, []);
    useEffect(() => {
        if (!session)
            return;
        if (!liveViewerCountRef.current)
            setViewerCount(session.viewerCount);
        setServerSkewMs(skewRef.current);
        const featured = session.products.find((p) => p.isFeatured || p.pinnedAt !== null);
        setPinnedProductId(featured?.productId ?? null);
        if (session.deliveryTier === 'cdn' && session.hlsUrl) {
            latchCdn({ url: session.hlsUrl, originKind: session.hlsOriginKind ?? 'simulated-origin' });
        }
    }, [session, latchCdn]);
    useEffect(() => {
        if (!sessionId || session?.status !== 'live')
            return;
        if (joinedForRef.current === sessionId)
            return;
        joinedForRef.current = sessionId;
        setJoining(true);
        void (async () => {
            try {
                const result = await api.post<JoinSessionDto>(`/api/sessions/${sessionId}/join`);
                setJoin(result);
                setJoinError(null);
                if (result.deliveryTier === 'cdn' && result.hlsUrl) {
                    latchCdn({ url: result.hlsUrl, originKind: result.hlsOriginKind ?? 'simulated-origin' });
                }
            }
            catch (err) {
                joinedForRef.current = null;
                setJoinError(err instanceof ApiError ? err : new ApiError(0, 'join_failed', String(err), null));
            }
            finally {
                setJoining(false);
            }
        })();
    }, [sessionId, session?.status, latchCdn]);
    useEffect(() => {
        if (role !== 'viewer' || !sessionId || !join)
            return;
        const beat = (): void => {
            void api.post(`/api/sessions/${sessionId}/heartbeat`).catch(() => undefined);
        };
        beat();
        const timer = window.setInterval(beat, 10000);
        return () => window.clearInterval(timer);
    }, [role, sessionId, join]);
    const pollsQuery = useQuery<PollDto[], Error>({
        queryKey: ['session-polls', sessionId],
        queryFn: async () => (await api.get<{
            polls: PollDto[];
        }>(`/api/sessions/${sessionId}/polls`)).polls,
        enabled: Boolean(sessionId),
        staleTime: 30000,
    });
    useEffect(() => {
        const open = pollsQuery.data?.find((p) => p.status === 'open') ?? null;
        if (open)
            setPoll((current) => current ?? open);
    }, [pollsQuery.data]);
    const onEvent = useCallback((event: ServerEvent) => {
        switch (event.event) {
            case EVENTS.sessionStatusChanged: {
                if ((event.data as StatusChangedData).status === 'ended')
                    setJoin(null);
                break;
            }
            case EVENTS.sessionDeliveryTierChanged: {
                const data = event.data as TierChangedData;
                if (cdnLatchedRef.current || data.deliveryTier !== 'cdn')
                    break;
                latchCdn(data.hlsUrl
                    ? { url: data.hlsUrl, originKind: data.hlsOriginKind ?? 'simulated-origin' }
                    : null);
                break;
            }
            case EVENTS.sessionViewersChanged:
                liveViewerCountRef.current = true;
                setViewerCount((event.data as ViewersData).viewerCount);
                break;
            case EVENTS.sessionProductPinned:
                setPinnedProductId((event.data as PinnedData).productId);
                break;
            case EVENTS.sessionReactions: {
                const data = event.data as ReactionsData;
                setReactions((current) => ({
                    counts: data.counts,
                    deltas: data.deltas,
                    tick: current.tick + 1,
                }));
                break;
            }
            case EVENTS.sessionCaption: {
                const data = event.data as CaptionData;
                const line: CaptionLine = {
                    id: data.captionId,
                    text: data.text,
                    language: data.language,
                    startMs: data.startMs,
                    speaker: data.speaker,
                };
                setCaptions((current) => {
                    const index = current.findIndex((caption) => caption.id === line.id);
                    if (index < 0)
                        return [...current, line].slice(-MAX_CAPTIONS);
                    const next = current.slice();
                    next[index] = line;
                    return next;
                });
                break;
            }
            case EVENTS.pollOpened:
                setPoll((event.data as PollOpenedData).poll);
                break;
            case EVENTS.pollResults: {
                const data = event.data as PollResultsData;
                setPoll((current) => current && current.id === data.pollId
                    ? { ...current, options: data.options, totalVotes: data.totalVotes }
                    : current);
                break;
            }
            case EVENTS.pollClosed: {
                const data = event.data as PollClosedData;
                setPoll((current) => current && current.id === data.pollId ? { ...current, status: 'closed' } : current);
                break;
            }
            case EVENTS.chatModerated: {
                const data = event.data as ModeratedData;
                if (data.action === 'degraded_chat' && data.envelope) {
                    const envelope = data.envelope;
                    setDegradedChat((current) => [...current, envelope].slice(-200));
                    break;
                }
                setModeration({
                    action: data.action,
                    targetUserId: data.targetUserId,
                    targetMessageId: data.targetMessageId,
                    ts: event.ts,
                });
                break;
            }
            default:
                break;
        }
    }, [latchCdn]);
    useServerEvents({
        enabled: Boolean(sessionId),
        sessionIds: sessionId ? [sessionId] : [],
        onEvent,
    });
    const liveClock = useMemo(() => session?.status === 'live' && session.startedAt !== null
        ? { startedAtMs: new Date(session.startedAt).getTime(), skewMs: serverSkewMs }
        : null, [session?.status, session?.startedAt, serverSkewMs]);
    return {
        query,
        session,
        join,
        joinError,
        joining,
        deliveryTier,
        hls,
        liveClock,
        serverSkewMs,
        viewerCount,
        captions,
        reactions,
        poll,
        applyPoll: setPoll,
        pinnedProductId,
        moderation,
        degradedChat,
    };
};
