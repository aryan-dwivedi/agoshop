import type { IRemoteAudioTrack } from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAssistantSurface } from '../ai/assistantSurface';
import { useVoiceAgent } from '../ai/useVoiceAgent';
import { LiveRoomSidebar, type RoomTab } from '../components/live/LiveRoomSidebar';
import { LiveSavingsBanner } from '../components/live/LiveSavingsBanner';
import { LiveTheatre } from '../components/live/LiveTheatre';
import type { ComposerMode, QuotedLine } from '../components/live/RoomConversation';
import { useChat } from '../hooks/useChat';
import { useLiveSession } from '../hooks/useLiveSession';
import { useCart } from '../hooks/useCart';
import { useOfflineGuard } from '../hooks/useOfflineGuard';
import { useVideoQuality } from '../hooks/useVideoQuality';
import { api } from '../lib/api';
import { useSession } from '../state/session';
const Live = (): JSX.Element => {
    const { slug } = useParams<{
        slug: string;
    }>();
    const { user, config } = useSession();
    const live = useLiveSession(slug, { role: 'viewer' });
    const session = live.session;
    const isLive = session?.status === 'live';
    const [duckTrack, setDuckTrack] = useState<IRemoteAudioTrack | null>(null);
    const [consented, setConsented] = useState(false);
    const [tab, setTab] = useState<RoomTab>('chat');
    const [composerMode, setComposerMode] = useState<ComposerMode>('chat');
    const [chatCollapsed, setChatCollapsed] = useState(false);
    const [quoted, setQuoted] = useState<QuotedLine | null>(null);
    const [assistantSeedPrompt, setAssistantSeedPrompt] = useState<string | null>(null);
    const [captionsOn, setCaptionsOn] = useState(true);
    const [captionNotice, setCaptionNotice] = useState<string | null>(null);
    const [pollOpen, setPollOpen] = useState(false);
    const offline = useOfflineGuard();
    const { quality, setQuality, qualityMenuOpen, setQualityMenuOpen } = useVideoQuality();
    const roomPanelRef = useRef<HTMLElement>(null);
    const showRoomPanel = useCallback((nextTab: RoomTab): void => {
        setChatCollapsed(false);
        setTab(nextTab);
        window.requestAnimationFrame(() => {
            const panel = roomPanelRef.current;
            if (panel === null)
                return;
            const inputLabel = nextTab === 'ask' ? 'Ask Ago anything' : 'Message the room';
            panel.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`)?.focus();
        });
    }, []);
    const claimPage = useAssistantSurface((s) => s.claimPage);
    const releasePage = useAssistantSurface((s) => s.releasePage);
    const openSignal = useAssistantSurface((s) => s.openSignal);
    useEffect(() => {
        claimPage();
        return releasePage;
    }, [claimPage, releasePage]);
    useEffect(() => {
        if (openSignal <= 0)
            return;
        showRoomPanel('ask');
    }, [openSignal, showRoomPanel]);
    useEffect(() => {
        if (captionNotice === null)
            return undefined;
        const timer = window.setTimeout(() => setCaptionNotice(null), 3000);
        return () => window.clearTimeout(timer);
    }, [captionNotice]);
    const onRemoteAudioTrack = useCallback((track: IRemoteAudioTrack | null) => {
        setDuckTrack(track);
    }, []);
    const chat = useChat({
        sessionId: session?.id ?? null,
        slug,
        mode: 'viewer',
        shardIndex: live.join?.shardIndex ?? null,
        shardCount: live.join?.chatShardCount ?? null,
        liveDelivery: Boolean(isLive && live.join),
        injected: live.degradedChat,
    });
    const agent = useVoiceAgent({
        surface: 'live',
        liveSessionId: session?.id ?? null,
        productId: live.pinnedProductId,
        duckTrack,
    });
    const quoteIntoAssistant = useCallback((next: QuotedLine) => {
        const subject = next.source === 'chat' ? 'chat message' : 'host transcript';
        setAssistantSeedPrompt(`About this ${subject} from ${next.author}: “${next.text}”`);
        setChatCollapsed(false);
        setTab('ask');
    }, []);
    const cart = useCart(Boolean(user));
    const pollId = live.poll?.id ?? null;
    useEffect(() => {
        if (pollId === null)
            return;
        setPollOpen(window.matchMedia('(min-width: 1024px)').matches);
    }, [pollId]);
    const liveLines = (cart.data?.items ?? []).filter((item) => item.liveSessionId === session?.id && item.applied.length > 0);
    const liveSavings = liveLines.reduce((sum, item) => sum + item.pricing.discountMinorUnits, 0);
    const discountExpired = cart.data?.notices.includes('live_discount_expired') ?? false;
    if (live.query.isLoading) {
        return (<div className="space-y-4 py-4">
        <div className="skeleton aspect-video w-full rounded-panel"/>
        <div className="skeleton h-pin-bar w-full"/>
        <p className="text-center text-14 text-t3">Connecting</p>
      </div>);
    }
    if (live.query.isError || session === null) {
        return (<div className="card my-6 p-10 text-center">
        <p className="text-16 font-medium text-danger">
          This show could not be loaded. {live.query.error?.message}
        </p>
        <Link to="/live" className="btn-standard mt-4">
          Back to live shows
        </Link>
      </div>);
    }
    const consentGate = Boolean(live.join?.recordingConsentRequired) && !consented;
    const captionsAvailable = live.join?.captionsEnabled ?? false;
    const readOnly = !isLive || offline;
    const latestRoomMessage = chat.messages.at(-1);
    const latestRoomText = latestRoomMessage?.text?.trim() ?? '';
    const firstProduct = session.products[0];
    const secondProduct = session.products[1];
    const liveAssistantExamples = [
        latestRoomText === ''
            ? `What is ${session.hostName} showing right now?`
            : `What did ${latestRoomMessage?.displayName ?? 'the room'} mean by “${latestRoomText.length > 72 ? `${latestRoomText.slice(0, 72)}…` : latestRoomText}”?`,
        firstProduct === undefined
            ? 'Summarise what has happened in this live room.'
            : secondProduct === undefined
                ? `What should I know about ${firstProduct.title}?`
                : `Compare ${firstProduct.title} and ${secondProduct.title}.`,
        session.products.length > 1
            ? `Which of these ${session.products.length} live deals is the best value?`
            : 'Does this live deal fit what I need?',
    ];
    const toggleCaptions = (): void => {
        const next = !captionsOn;
        setCaptionsOn(next);
        setCaptionNotice(next
            ? live.captions.length > 0
                ? 'Closed captions on'
                : 'Closed captions on — waiting for host speech'
            : 'Closed captions off');
    };
    const chatDot = chat.status === 'ready' ? 'bg-success' : chat.status === 'error' ? 'bg-danger' : 'bg-accent';
    const chatState = offline
        ? 'Offline'
        : chat.status === 'ready'
            ? 'Live'
            : chat.status === 'joining'
                ? 'Joining'
                : chat.status === 'error'
                    ? 'Reconnecting'
                    : '';
    const handleConsent = (): void => {
        setConsented(true);
        if (session.id !== '') {
            void api
                .post(`/api/sessions/${session.id}/consent`, { acknowledged: true })
                .catch(() => undefined);
        }
    };
    return (<div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
      <LiveSavingsBanner isLive={isLive} liveSavings={liveSavings} liveLineCount={liveLines.length} discountExpired={discountExpired}/>

      <section className={`relative flex min-h-0 flex-1 overflow-hidden border-y border-line bg-black lg:grid ${chatCollapsed
            ? 'lg:grid-cols-1'
            : 'lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem]'}`}>
        <LiveTheatre session={session} live={live} isLive={isLive} config={config} offline={offline} consentGate={consentGate} onConsent={handleConsent} quality={quality} onQualityChange={setQuality} qualityMenuOpen={qualityMenuOpen} onQualityMenuOpenChange={setQualityMenuOpen} captionsAvailable={captionsAvailable} captionsOn={captionsOn} onToggleCaptions={toggleCaptions} captionNotice={captionNotice} pollOpen={pollOpen} onPollOpenChange={setPollOpen} chatCollapsed={chatCollapsed} onChatCollapsedChange={setChatCollapsed} onRemoteAudioTrack={onRemoteAudioTrack} onViewProducts={() => showRoomPanel('products')} user={user}/>

        <LiveRoomSidebar ref={roomPanelRef} session={session} live={live} isLive={isLive} offline={offline} readOnly={readOnly} chat={chat} agent={agent} user={user} tab={tab} onTabChange={setTab} chatCollapsed={chatCollapsed} onChatCollapsedChange={setChatCollapsed} composerMode={composerMode} onComposerModeChange={setComposerMode} quoted={quoted} onQuotedChange={setQuoted} onAskAbout={quoteIntoAssistant} assistantSeedPrompt={assistantSeedPrompt} onAssistantSeedPromptConsumed={() => setAssistantSeedPrompt(null)} liveAssistantExamples={liveAssistantExamples} duckTrack={duckTrack} chatState={chatState} chatDot={chatDot}/>
      </section>
    </div>);
};
export default Live;
