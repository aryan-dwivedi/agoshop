import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  EVENTS,
  type ChatEnvelope,
  type DeliveryTier,
  type JoinSessionDto,
  type LiveSessionDto,
  type ServerEvent,
  type SessionStatus,
} from '@shop/shared';

import { api, ApiError } from '../lib/api';
import { useServerEvents } from '../lib/useServerEvents';

/**
 * The one place a live page talks to the session API.
 *
 * It owns the session snapshot, the `join` handshake, the 10 s presence heartbeat,
 * the session-scoped SSE stream, and the engagement state that only arrives over SSE
 * (viewers, captions, reactions, polls, pins, moderation).
 *
 * Delivery tier is one-way session state (architecture decision 8): once this hook
 * reports `cdn` it never reports `rtc` again for the life of the session, and the
 * tier-changed event carries the HLS origin so `VideoStage` can start HLS *before*
 * it leaves the RTC channel. Refetches cannot walk the tier backwards either.
 *
 * It also publishes `liveClock`, the room's shared playhead anchor: `startedAt` plus
 * the server/client clock offset measured off `serverNowMs`. Players derive their
 * position from wall time instead of from the asset, so every viewer of a file-backed
 * feed sees the same frame and a late joiner never starts at the beginning.
 */

export type PollOption = { id: string; label: string; votes: number };

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
  /** Per-tick increments; the reaction bar animates exactly these. */
  deltas: Record<string, number>;
  /** Bumped on every tick so a repeated delta still triggers an animation. */
  tick: number;
};

export type ModerationNotice = {
  action: string;
  targetUserId?: string;
  targetMessageId?: string;
  ts: number;
};

export type HlsOrigin = { url: string; originKind: 'media-push' | 'simulated-origin' };

type StatusChangedData = { sessionId: string; status: SessionStatus };
type TierChangedData = {
  sessionId: string;
  deliveryTier: DeliveryTier;
  hlsUrl: string | null;
  hlsOriginKind: 'media-push' | 'simulated-origin' | null;
};
type ViewersData = { sessionId: string; viewerCount: number };
/** `productId: null` is an unpin: the host cleared the highlight. */
type PinnedData = { sessionId: string; productId: string | null };
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
type PollOpenedData = { sessionId: string; poll: PollDto };
type PollResultsData = {
  sessionId: string;
  pollId: string;
  options: PollOption[];
  totalVotes: number;
};
type PollClosedData = { sessionId: string; pollId: string };
type ModeratedData = {
  sessionId: string;
  action: string;
  targetUserId?: string;
  targetMessageId?: string;
  /** Present only when Signaling REST is unavailable and chat degrades to SSE. */
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
  /**
   * The anchor every viewer of this room shares: when the stream went live, plus this
   * client's offset from the server clock. Non-null only for a started live session,
   * because those are the only two facts `syncedPosition` can be resolved from.
   */
  liveClock: { startedAtMs: number; skewMs: number } | null;
  /**
   * This client's offset from the server clock, published on its own because a
   * countdown to a session that has NOT started yet needs the same anchor a playhead
   * does, and `liveClock` is deliberately null until the room is on air.
   */
  serverSkewMs: number;
  viewerCount: number;
  captions: CaptionLine[];
  reactions: ReactionState;
  poll: PollDto | null;
  applyPoll: (poll: PollDto | null) => void;
  pinnedProductId: string | null;
  moderation: ModerationNotice | null;
  /** Chat envelopes that arrived over SSE because the RTM REST publish path was down. */
  degradedChat: ChatEnvelope[];
};

export const useLiveSession = (
  slug: string | undefined,
  opts: { role: 'viewer' | 'host' },
): LiveSessionState => {
  const { role } = opts;

  /**
   * Server clock minus this client's clock, sampled at the instant a snapshot lands.
   * A viewer whose own clock is minutes off must still resolve the same shared live
   * position as everyone else, so playhead maths uses `Date.now() + skewMs`.
   */
  const skewRef = useRef(0);
  const [serverSkewMs, setServerSkewMs] = useState(0);

  const query = useQuery<LiveSessionDto, Error>({
    queryKey: ['session', slug],
    queryFn: async () => {
      const { session: snapshot } = await api.get<{ session: LiveSessionDto }>(
        `/api/sessions/${slug}`,
      );
      // Sampled here rather than in an effect: render latency would otherwise be
      // folded into the offset and every viewer would skew by a different amount.
      skewRef.current = snapshot.serverNowMs - Date.now();
      return snapshot;
    },
    enabled: Boolean(slug),
    staleTime: 10_000,
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

  /** Guards the one-way tier rule against both duplicate events and stale refetches. */
  const cdnLatchedRef = useRef(false);
  const joinedForRef = useRef<string | null>(null);
  /**
   * The snapshot's `viewerCount` is a point-in-time read, while the 1 Hz aggregate is
   * strictly fresher. A refetch triggered by some other session event must therefore
   * not walk the count backwards once live aggregates have started arriving.
   */
  const liveViewerCountRef = useRef(false);

  const latchCdn = useCallback((origin: HlsOrigin | null) => {
    cdnLatchedRef.current = true;
    setDeliveryTier('cdn');
    if (origin) setHls(origin);
  }, []);

  // Session snapshot. `viewerCount` is only a seed (the 1 Hz aggregate is fresher),
  // but the pin IS server truth: `session.product_pinned` — including an unpin, which
  // arrives with `productId: null` — always forces a `['session']` refetch, and the
  // rail carries `isFeatured`/`pinnedAt` precisely so a late joiner or a client that
  // reconnected across a pin renders the current highlight without waiting for an
  // event. Keeping a stale local pin here would survive exactly that reconnect.
  useEffect(() => {
    if (!session) return;
    if (!liveViewerCountRef.current) setViewerCount(session.viewerCount);
    setServerSkewMs(skewRef.current);
    const featured = session.products.find((p) => p.isFeatured || p.pinnedAt !== null);
    setPinnedProductId(featured?.productId ?? null);
    if (session.deliveryTier === 'cdn' && session.hlsUrl) {
      latchCdn({ url: session.hlsUrl, originKind: session.hlsOriginKind ?? 'simulated-origin' });
    }
  }, [session, latchCdn]);

  // The join handshake. A viewer needs the tier, token and its frozen chat shard; a
  // host needs the shard *count* so the console can subscribe to every shard. The
  // server skips the presence ZADD for a host or admin, so a console can never
  // inflate the viewer count or trip the rtc→cdn threshold by watching itself.
  useEffect(() => {
    if (!sessionId || session?.status !== 'live') return;
    if (joinedForRef.current === sessionId) return;
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
      } catch (err) {
        joinedForRef.current = null;
        setJoinError(
          err instanceof ApiError ? err : new ApiError(0, 'join_failed', String(err), null),
        );
      } finally {
        setJoining(false);
      }
    })();
  }, [sessionId, session?.status, latchCdn]);

  // Presence: 10 s heartbeat keeps this viewer in `session:<id>:viewers`.
  useEffect(() => {
    if (role !== 'viewer' || !sessionId || !join) return;
    const beat = (): void => {
      void api.post(`/api/sessions/${sessionId}/heartbeat`).catch(() => undefined);
    };
    beat();
    const timer = window.setInterval(beat, 10_000);
    return () => window.clearInterval(timer);
  }, [role, sessionId, join]);

  // Open poll for late joiners; SSE keeps it current from here on.
  const pollsQuery = useQuery<PollDto[], Error>({
    queryKey: ['session-polls', sessionId],
    queryFn: async () =>
      (await api.get<{ polls: PollDto[] }>(`/api/sessions/${sessionId}/polls`)).polls,
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });

  useEffect(() => {
    const open = pollsQuery.data?.find((p) => p.status === 'open') ?? null;
    if (open) setPoll((current) => current ?? open);
  }, [pollsQuery.data]);

  // `ServerEvent.data` is `unknown` on the wire. Each case asserts the one payload
  // type declared above for that event name — the publish side of this contract is
  // the server's session routes and the background aggregator.
  const onEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.event) {
        case EVENTS.sessionStatusChanged: {
          // ['session'] is already invalidated by `useServerEvents`. Dropping the join
          // handshake is what tears the RTC subscription down when the host ends.
          if ((event.data as StatusChangedData).status === 'ended') setJoin(null);
          break;
        }
        case EVENTS.sessionDeliveryTierChanged: {
          const data = event.data as TierChangedData;
          if (cdnLatchedRef.current || data.deliveryTier !== 'cdn') break;
          latchCdn(
            data.hlsUrl
              ? { url: data.hlsUrl, originKind: data.hlsOriginKind ?? 'simulated-origin' }
              : null,
          );
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
            if (index < 0) return [...current, line].slice(-MAX_CAPTIONS);
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
          setPoll((current) =>
            current && current.id === data.pollId
              ? { ...current, options: data.options, totalVotes: data.totalVotes }
              : current,
          );
          break;
        }
        case EVENTS.pollClosed: {
          const data = event.data as PollClosedData;
          setPoll((current) =>
            current && current.id === data.pollId ? { ...current, status: 'closed' } : current,
          );
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
    },
    [latchCdn],
  );

  useServerEvents({
    enabled: Boolean(sessionId),
    sessionIds: sessionId ? [sessionId] : [],
    onEvent,
  });

  // Only a started live session has an anchor; a scheduled or ended one has nothing
  // to synchronise against, and `null` is what tells a player to leave itself alone.
  const liveClock = useMemo(
    () =>
      session?.status === 'live' && session.startedAt !== null
        ? { startedAtMs: new Date(session.startedAt).getTime(), skewMs: serverSkewMs }
        : null,
    [session?.status, session?.startedAt, serverSkewMs],
  );

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
