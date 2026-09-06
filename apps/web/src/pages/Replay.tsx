import type { ReplayPlayerHandle } from '../components/live/ReplayPlayer';
import type { PollDto } from '../hooks/useLiveSession';
import type { LiveSessionDto, TranscriptLine } from '@shop/shared';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AssistantPanel } from '../ai/AssistantPanel';
import { useAssistantSurface } from '../ai/assistantSurface';
import { ASSISTANT_EXAMPLES } from '../ai/browseExamples';
import { AskIcon, ChatIcon, ChevronRight, SearchIcon } from '../components/icons';
import { ChatPanel } from '../components/live/ChatPanel';
import { LiveBadge } from '../components/live/LiveBadge';
import { ReplayPlayer } from '../components/live/ReplayPlayer';
import { SessionProductRail } from '../components/live/SessionProductRail';
import { useChat } from '../hooks/useChat';
import { api } from '../lib/api';

const formatClock = (ms: number): string => {
    const total = Math.floor(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const MissingRecording = ({ recordingStatus }: { recordingStatus: string }): JSX.Element => {
    const pending = recordingStatus === 'recording' || recordingStatus === 'processing';
    return (
        <div
            role="status"
            className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-panel bg-[#101210] p-6 text-center"
        >
            <p className="text-14 font-medium text-white">
                {pending ? 'This replay is still being prepared.' : 'This show was not recorded.'}
            </p>
            <p className="max-w-md text-13 text-white/70">
                {pending
                    ? 'The video will appear here when it is ready.'
                    : 'You can still browse the products and show details below.'}
            </p>
        </div>
    );
};
const PollResult = ({ poll }: { poll: PollDto }): JSX.Element => (
    <div className="rounded-ctl border border-line p-4">
        <p className="text-14 font-semibold text-t1">{poll.question}</p>
        <ul className="mt-3 space-y-3">
            {poll.options.map((option) => {
                const share =
                    poll.totalVotes === 0 ? 0 : Math.round((option.votes / poll.totalVotes) * 100);
                const mine = poll.myOptionId === option.id;
                return (
                    <li key={option.id}>
                        <div className="flex items-baseline justify-between gap-3 text-13">
                            <span
                                className={
                                    mine ? 'font-semibold text-accent-text' : 'font-medium text-t2'
                                }
                            >
                                {option.label}
                                {mine && ' · your vote'}
                            </span>
                            <span className="tnum shrink-0 text-t3">{share}%</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-bg">
                            <div
                                className={
                                    mine
                                        ? 'h-full rounded-full bg-accent'
                                        : 'h-full rounded-full bg-line-ctl'
                                }
                                style={{ width: `${share}%` }}
                            />
                        </div>
                    </li>
                );
            })}
        </ul>
        <p className="tnum mt-3 text-13 text-t3">
            {poll.totalVotes === 1 ? '1 vote' : `${poll.totalVotes} votes`}
        </p>
    </div>
);
type SidebarTab = 'ask' | 'transcript' | 'chat';
const SIDEBAR_TABS: readonly {
    id: SidebarTab;
    label: string;
    icon: JSX.Element;
}[] = [
    { id: 'ask', label: 'Ask Ago', icon: <AskIcon className="h-4 w-4" /> },
    { id: 'transcript', label: 'Transcript', icon: <SearchIcon className="h-4 w-4" /> },
    { id: 'chat', label: 'Chat', icon: <ChatIcon className="h-4 w-4" /> },
];
const Replay = (): JSX.Element => {
    const { slug } = useParams<{
        slug: string;
    }>();
    const playerRef = useRef<ReplayPlayerHandle>(null);
    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [tab, setTab] = useState<SidebarTab>('ask');
    const claimPage = useAssistantSurface((state) => state.claimPage);
    const releasePage = useAssistantSurface((state) => state.releasePage);
    const openSignal = useAssistantSurface((state) => state.openSignal);
    useEffect(() => {
        claimPage();
        return releasePage;
    }, [claimPage, releasePage]);
    useEffect(() => {
        if (openSignal > 0) setTab('ask');
    }, [openSignal]);
    const sessionQuery = useQuery<LiveSessionDto, Error>({
        queryKey: ['session', slug],
        queryFn: async () =>
            (
                await api.get<{
                    session: LiveSessionDto;
                }>(`/api/sessions/${slug}`)
            ).session,
        enabled: Boolean(slug),
    });
    const session = sessionQuery.data ?? null;
    const sessionId = session?.id ?? null;
    const transcript = useQuery<
        {
            lines: TranscriptLine[];
            summary: string | null;
        },
        Error
    >({
        queryKey: ['session-transcript', sessionId],
        queryFn: () =>
            api.get<{
                lines: TranscriptLine[];
                summary: string | null;
            }>(`/api/sessions/${sessionId}/transcript`),
        enabled: Boolean(sessionId),
    });
    const searchResults = useQuery<
        {
            lines: TranscriptLine[];
            summary: string | null;
        },
        Error
    >({
        queryKey: ['session-transcript-search', sessionId, search],
        queryFn: () =>
            api.get<{
                lines: TranscriptLine[];
                summary: string | null;
            }>(`/api/sessions/${sessionId}/transcript?q=${encodeURIComponent(search)}`),
        enabled: Boolean(sessionId && search),
    });
    const polls = useQuery<PollDto[], Error>({
        queryKey: ['session-polls', sessionId],
        queryFn: async () =>
            (
                await api.get<{
                    polls: PollDto[];
                }>(`/api/sessions/${sessionId}/polls`)
            ).polls,
        enabled: Boolean(sessionId),
    });
    const chat = useChat({
        sessionId,
        slug,
        mode: 'viewer',
        shardIndex: null,
        shardCount: null,
        liveDelivery: false,
    });
    const recordingUrl = session?.recordingUrl ?? null;
    if (sessionQuery.isLoading) {
        return (
            <div className="space-y-5 py-6">
                <div className="skeleton h-8 w-72" />
                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
                    <div className="skeleton aspect-video w-full" />
                    <div className="skeleton min-h-[24rem] w-full" />
                </div>
            </div>
        );
    }
    if (sessionQuery.isError || !session) {
        return (
            <div className="card mx-auto my-12 max-w-lg p-8 text-center">
                <h1 className="text-23 font-semibold">Replay unavailable</h1>
                <p className="mt-2 text-14 text-t2">We could not load this show.</p>
                <Link
                    to="/live"
                    className="btn-standard mt-5"
                >
                    Browse live shopping
                </Link>
            </div>
        );
    }
    const summary = session.transcriptSummary ?? transcript.data?.summary ?? null;
    const closedPolls = (polls.data ?? []).filter((poll) => poll.options.length > 0);
    const displayedTranscript = search ? searchResults : transcript;
    return (
        <div className="space-y-8 py-6">
            <nav
                aria-label="Breadcrumb"
                className="flex items-center gap-1.5 text-13 text-t3"
            >
                <Link
                    to="/"
                    className="hover:text-accent-text"
                >
                    Home
                </Link>
                <ChevronRight className="h-4 w-4" />
                <Link
                    to="/live"
                    className="hover:text-accent-text"
                >
                    Live shopping
                </Link>
                <ChevronRight className="h-4 w-4" />
                <span className="truncate text-t2">Replay</span>
            </nav>

            <header className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-28 font-semibold text-t1">{session.title}</h1>
                    <LiveBadge
                        status={session.status}
                        peakViewers={session.peakViewers}
                    />
                </div>
                <p className="mt-1 text-14 text-t2">
                    {session.hostName} · {session.sellerName}
                    {session.endedAt &&
                        ` · ${new Date(session.endedAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                        })}`}
                </p>
            </header>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
                <div className="min-w-0">
                    {recordingUrl ? (
                        <ReplayPlayer
                            ref={playerRef}
                            src={recordingUrl}
                            poster={session.coverImageUrl}
                            title={session.title}
                            captions={transcript.data?.lines ?? []}
                        />
                    ) : (
                        <MissingRecording recordingStatus={session.recordingStatus} />
                    )}
                </div>

                <aside className="card flex min-h-[24rem] flex-col overflow-hidden lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)]">
                    <div
                        role="tablist"
                        aria-label="Replay panels"
                        className="relative flex shrink-0 border-b border-line"
                    >
                        {SIDEBAR_TABS.map((segment) => (
                            <button
                                key={segment.id}
                                type="button"
                                role="tab"
                                id={`replay-tab-${segment.id}`}
                                aria-selected={tab === segment.id}
                                aria-controls={`replay-panel-${segment.id}`}
                                onClick={() => setTab(segment.id)}
                                className={`flex h-11 flex-1 items-center justify-center gap-1.5 px-2 text-13 font-medium transition-colors duration-ctl ${tab === segment.id ? 'text-t1' : 'text-t2 hover:text-t1'}`}
                            >
                                {segment.icon}
                                <span className="truncate">{segment.label}</span>
                            </button>
                        ))}
                        <span
                            aria-hidden
                            className="absolute bottom-0 left-0 h-0.5 bg-accent transition-transform duration-ctl ease-out"
                            style={{
                                width: `${100 / SIDEBAR_TABS.length}%`,
                                transform: `translateX(${SIDEBAR_TABS.findIndex((segment) => segment.id === tab) * 100}%)`,
                            }}
                        />
                    </div>

                    <div
                        role="tabpanel"
                        id="replay-panel-ask"
                        aria-labelledby="replay-tab-ask"
                        hidden={tab !== 'ask'}
                        className={`min-h-0 flex-1 ${tab === 'ask' ? 'flex' : 'hidden'}`}
                    >
                        {tab === 'ask' && (
                            <AssistantPanel
                                surface="replay"
                                liveSessionId={session.id}
                                contextLabel={session.title}
                                examples={ASSISTANT_EXAMPLES.replay}
                                seamless
                                className="min-h-0 w-full flex-1"
                            />
                        )}
                    </div>

                    <div
                        role="tabpanel"
                        id="replay-panel-transcript"
                        aria-labelledby="replay-tab-transcript"
                        hidden={tab !== 'transcript'}
                        className={`min-h-0 flex-1 flex-col ${tab === 'transcript' ? 'flex' : 'hidden'}`}
                    >
                        <form
                            className="flex shrink-0 gap-2 border-b border-line p-3"
                            onSubmit={(event) => {
                                event.preventDefault();
                                setSearch(query.trim());
                            }}
                        >
                            <label className="relative min-w-0 flex-1">
                                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t3" />
                                <input
                                    className="input pl-9"
                                    value={query}
                                    onChange={(event) => setQuery(event.target.value)}
                                    placeholder="Search transcript"
                                    aria-label="Search the transcript"
                                />
                            </label>
                            <button
                                type="submit"
                                className="btn-standard px-3"
                            >
                                Search
                            </button>
                        </form>
                        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
                            {displayedTranscript.isLoading && (
                                <p className="p-2 text-13 text-t3">Loading transcript…</p>
                            )}
                            {displayedTranscript.isError && (
                                <p className="p-2 text-13 text-danger">Transcript unavailable.</p>
                            )}
                            {displayedTranscript.data?.lines.length === 0 && (
                                <p className="p-2 text-13 text-t3">
                                    {search
                                        ? `No moments match “${search}”.`
                                        : 'No transcript was captured.'}
                                </p>
                            )}
                            <ul className="space-y-1">
                                {displayedTranscript.data?.lines.map((line) => (
                                    <li key={line.id}>
                                        <button
                                            type="button"
                                            className="w-full rounded-ctl px-2 py-2 text-left transition hover:bg-bg"
                                            onClick={() => {
                                                playerRef.current?.seekTo(line.startMs / 1000);
                                            }}
                                        >
                                            <span className="tnum text-13 font-semibold text-accent-text">
                                                {formatClock(line.startMs)}
                                            </span>
                                            <span className="mt-0.5 block text-13 leading-relaxed text-t2">
                                                {line.text}
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>

                    <div
                        role="tabpanel"
                        id="replay-panel-chat"
                        aria-labelledby="replay-tab-chat"
                        hidden={tab !== 'chat'}
                        className={`min-h-0 flex-1 ${tab === 'chat' ? 'flex' : 'hidden'}`}
                    >
                        {tab === 'chat' && (
                            <ChatPanel
                                chat={chat}
                                canSend={false}
                                signedIn
                                readOnly
                                seamless
                                emptyHint="No chat was recorded for this show."
                                className="min-h-0 w-full flex-1"
                            />
                        )}
                    </div>
                </aside>
            </div>

            <section>
                <div className="mb-4">
                    <h2 className="text-23 font-semibold text-t1">Shop the show</h2>
                    <p className="mt-1 text-14 text-t2">
                        {session.products.length}{' '}
                        {session.products.length === 1 ? 'product' : 'products'} from this replay
                    </p>
                </div>
                <SessionProductRail
                    sessionId={session.id}
                    products={session.products}
                    pinnedProductId={null}
                    live={false}
                    signedIn
                />
            </section>

            <div className="space-y-5">
                {summary && (
                    <section className="card p-5">
                        <h2 className="section-title">Show highlights</h2>
                        <p className="mt-3 text-14 leading-relaxed text-t2">{summary}</p>
                    </section>
                )}
                {closedPolls.length > 0 && (
                    <section className="card p-5">
                        <h2 className="section-title">Poll results</h2>
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                            {closedPolls.map((poll) => (
                                <PollResult
                                    key={poll.id}
                                    poll={poll}
                                />
                            ))}
                        </div>
                    </section>
                )}
                {session.products.length > 0 && (
                    <div className="rounded-panel border border-line bg-accent-wash px-4 py-3">
                        <p className="text-14 font-semibold text-t1">Live offers have ended</p>
                        <p className="mt-1 text-13 text-t2">
                            Products from this replay are now shown at their current shop price.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};
export default Replay;
