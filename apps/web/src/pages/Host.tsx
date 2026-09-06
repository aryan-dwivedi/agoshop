import type { HoldToConfirmHandle } from '../components/HoldToConfirm';
import type { ChatEnvelope, LiveSessionDto } from '@shop/shared';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import { SAMPLE_LIVE_SOURCE_URL } from '@shop/shared';

import { BroadcastMonitor } from '../components/host/BroadcastMonitor';
import { HostDeck } from '../components/host/HostDeck';
import { HostLoadError, HostLoading, HostRoleGate } from '../components/host/HostGate';
import { HostHeader } from '../components/host/HostHeader';
import { HostSidebar } from '../components/host/HostSidebar';
import { KeyMapOverlay } from '../components/host/KeyMapOverlay';
import { EXPANDED_RIBBON_MS, formatElapsed } from '../components/host/constants';
import { LineupStrip, usePinProduct } from '../components/live/LineupStrip';
import { useChat } from '../hooks/useChat';
import {
    readPreflightHandoff,
    useHostBroadcast,
    writePreflightHandoff,
} from '../hooks/useHostBroadcast';
import { useHostKeyboard } from '../hooks/useHostKeyboard';
import { useLiveSession } from '../hooks/useLiveSession';
import { useMonitorSizing } from '../hooks/useMonitorSizing';
import { useStreamHealth } from '../hooks/useStreamHealth';
import { customerUrl } from '../lib/origins';
import { useSession } from '../state/session';

const Host = (): JSX.Element => {
    const { slug } = useParams<{
        slug: string;
    }>();
    const { user, config } = useSession();
    const queryClient = useQueryClient();
    const live = useLiveSession(slug, { role: 'host' });
    const session = live.session;
    const isOwner = session !== null && user !== null && session.hostUserId === user.id;
    const isCohost = session !== null && user !== null && session.coHostUserId === user.id;
    const canAccessRoom = user !== null && (isOwner || isCohost || user.role === 'admin');
    const onSessionUpdated = useCallback(
        (updated: LiveSessionDto) => {
            queryClient.setQueryData(
                ['session', slug],
                (
                    current:
                        | {
                              session: LiveSessionDto;
                          }
                        | undefined,
                ) => (current === undefined ? current : { ...current, session: updated }),
            );
        },
        [queryClient, slug],
    );
    const previewRef = useRef<HTMLDivElement>(null);
    const endHoldRef = useRef<HoldToConfirmHandle>(null);
    const [selectedMessage, setSelectedMessage] = useState<ChatEnvelope | null>(null);
    const [tab, setTab] = useState<'chat' | 'moderation'>('chat');
    const [captionsVisible, setCaptionsVisible] = useState(true);
    const [pricePanel, setPricePanel] = useState(false);
    const [pollPanel, setPollPanel] = useState(false);
    const [keyMap, setKeyMap] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [reconnectSince, setReconnectSince] = useState<number | null>(null);
    const [ribbonExpanded, setRibbonExpanded] = useState(false);
    const handoff = useMemo(() => readPreflightHandoff(slug), [slug]);
    const [consent, setConsent] = useState(handoff.consent);
    const autoGoLiveRef = useRef(handoff.autoGoLive);
    const publishedFileUrl =
        session?.sourceVideoUrl ?? session?.liveSourceUrl ?? SAMPLE_LIVE_SOURCE_URL;
    const intendedSource =
        handoff.source ?? ((session?.sourceVideoUrl ?? null) !== null ? 'file' : 'camera');
    const broadcast = useHostBroadcast({
        appId: config?.agoraAppId ?? null,
        slug,
        sessionId: session?.id ?? null,
        sessionStatus: session?.status ?? null,
        startedAtMs: session?.startedAt ? new Date(session.startedAt).getTime() : null,
        fileUrl: publishedFileUrl,
        cameraId: handoff.cameraId,
        microphoneId: handoff.microphoneId,
        onEnded: () => window.location.assign(customerUrl(`/replay/${slug}`)),
    });
    const publishing = broadcast.state === 'live';
    const health = useStreamHealth({
        client: broadcast.client,
        enabled: publishing,
    });
    const reconnecting = publishing && broadcast.connectionState === 'RECONNECTING';
    const disconnected = publishing && broadcast.connectionState === 'DISCONNECTED';
    const chat = useChat({
        sessionId: session?.id ?? null,
        slug,
        mode: 'host',
        shardIndex: null,
        shardCount: session?.status === 'live' ? (live.join?.chatShardCount ?? null) : null,
        liveDelivery: session?.status === 'live',
        injected: live.degradedChat,
    });
    const pin = usePinProduct(session?.id ?? '');
    const products = useMemo(
        () => [...(session?.products ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
        [session?.products],
    );
    const { source, setSource, state: broadcastState, startPreview: armPreview } = broadcast;
    const startPreview = useCallback(() => {
        const element = previewRef.current;
        if (element) void armPreview(element);
    }, [armPreview]);
    useEffect(() => {
        if (session === null) return;
        if (source !== intendedSource && broadcastState === 'idle') void setSource(intendedSource);
    }, [session, source, intendedSource, broadcastState, setSource]);
    useEffect(() => {
        if (session?.status === 'live' && broadcastState === 'idle' && source === intendedSource) {
            startPreview();
        }
    }, [session?.status, broadcastState, source, intendedSource, startPreview]);
    useEffect(() => {
        if (!autoGoLiveRef.current || broadcastState !== 'preview' || !consent) return;
        autoGoLiveRef.current = false;
        writePreflightHandoff(slug, { ...handoff, autoGoLive: false });
        void broadcast.goLive();
    }, [broadcastState, consent, slug, handoff, broadcast]);
    useEffect(() => {
        if (!publishing && !reconnecting) return;
        const id = window.setInterval(() => setNowMs(Date.now()), 1000);
        return () => window.clearInterval(id);
    }, [publishing, reconnecting]);
    useEffect(() => {
        if (broadcast.connectionState === 'RECONNECTING') {
            setReconnectSince((current) => current ?? Date.now());
            return;
        }
        setReconnectSince(null);
    }, [broadcast.connectionState]);
    useEffect(() => {
        if (!publishing || !handoff.skipped) return;
        setRibbonExpanded(true);
        const id = window.setTimeout(() => setRibbonExpanded(false), EXPANDED_RIBBON_MS);
        return () => window.clearTimeout(id);
    }, [publishing, handoff.skipped]);
    const aspect = broadcast.frameAspect ?? 16 / 9;
    const { stageRef, monitorWidth } = useMonitorSizing(aspect, ribbonExpanded);
    const pinnedProduct =
        products.find((product) => product.productId === live.pinnedProductId) ?? null;
    const pinnedSoldOut = pinnedProduct !== null && (pinnedProduct.stock ?? 1) <= 0;
    const nextInStock =
        products.find(
            (product) => product.productId !== live.pinnedProductId && (product.stock ?? 1) > 0,
        ) ?? null;
    const focusProduct =
        pinnedProduct ?? products.find((product) => product.isFeatured) ?? products[0] ?? null;
    const { toggleMic, toggleCamera, endSession } = broadcast;
    const pinSlot = useCallback(
        (index: number) => {
            const product = products[index];
            if (product === undefined) return;
            pin.pin(product.productId);
        },
        [products, pin],
    );
    useHostKeyboard({
        enabled: session !== null && isOwner,
        endHoldRef,
        pinSlot,
        onPinClear: () => pin.pin(null),
        toggleMic,
        toggleCamera,
        onPricePanelToggle: () => {
            setPricePanel((current) => !current);
            setPollPanel(false);
        },
        onPollPanelToggle: () => {
            setPollPanel((current) => !current);
            setPricePanel(false);
        },
        onCaptionsToggle: () => setCaptionsVisible((current) => !current),
        onKeyMapToggle: () => setKeyMap((current) => !current),
        onKeyMapClose: () => setKeyMap(false),
        onPanelsClose: () => {
            setPricePanel(false);
            setPollPanel(false);
        },
    });
    if (live.query.isLoading) return <HostLoading />;
    if (live.query.isError || session === null) {
        return <HostLoadError message={live.query.error?.message} />;
    }
    if (user === null || !canAccessRoom) return <HostRoleGate slug={session.slug} />;
    const isLive = session.status === 'live';
    const startedAtMs = session.startedAt === null ? null : new Date(session.startedAt).getTime();
    const elapsed =
        startedAtMs === null ? null : formatElapsed(nowMs + live.serverSkewMs - startedAtMs);
    const reconnectSeconds =
        reconnectSince === null ? 0 : Math.max(0, Math.floor((nowMs - reconnectSince) / 1000));
    const canGoLive =
        (isOwner ? session.status === 'scheduled' || isLive : isLive) &&
        consent &&
        broadcast.state === 'preview';
    const viewersLabel = `${live.viewerCount.toLocaleString('en-IN')} watching`;
    return (
        <div
            data-surface="studio"
            data-room="broadcast"
            className="flex h-[100dvh] flex-col overflow-hidden bg-bg text-t1"
        >
            <HostHeader
                title={session.title}
                status={session.status}
                elapsed={elapsed}
                viewersLabel={viewersLabel}
                health={health}
                publishing={publishing}
                slug={session.slug}
                isLive={isLive}
                isOwner={isOwner}
                broadcast={broadcast}
                endHoldRef={endHoldRef}
                onOpenKeyMap={() => setKeyMap(true)}
                onEndSession={() => void endSession()}
            />

            <div className="flex min-h-0 flex-1">
                <main className="relative flex min-w-0 flex-1 flex-col">
                    <BroadcastMonitor
                        session={session}
                        broadcast={broadcast}
                        health={health}
                        publishing={publishing}
                        reconnecting={reconnecting}
                        disconnected={disconnected}
                        captionsVisible={captionsVisible}
                        consent={consent}
                        onConsentChange={setConsent}
                        canGoLive={canGoLive}
                        isLive={isLive}
                        viewersLabel={viewersLabel}
                        previewRef={previewRef}
                        stageRef={stageRef}
                        monitorWidth={monitorWidth}
                        aspect={aspect}
                        ribbonExpanded={ribbonExpanded}
                        reconnectSeconds={reconnectSeconds}
                        onStartPreview={startPreview}
                        onEndSession={() => void endSession()}
                        isOwner={isOwner}
                    />

                    {isOwner && (
                        <LineupStrip
                            products={products}
                            pinnedProductId={live.pinnedProductId}
                            onPin={pin.pin}
                            pendingId={pin.pendingId}
                            busy={pin.busy}
                            className="shrink-0 px-3"
                        />
                    )}

                    <HostDeck
                        broadcast={broadcast}
                        session={session}
                        poll={live.poll}
                        onPollChange={live.applyPoll}
                        focusProduct={focusProduct}
                        captionsVisible={captionsVisible}
                        onCaptionsChange={setCaptionsVisible}
                        pricePanel={pricePanel}
                        onPricePanelChange={setPricePanel}
                        pollPanel={pollPanel}
                        onPollPanelChange={setPollPanel}
                        reconnecting={reconnecting}
                        disconnected={disconnected}
                        pinError={pin.error}
                        pinnedSoldOut={pinnedSoldOut}
                        pinnedProduct={pinnedProduct}
                        nextInStock={nextInStock}
                        onPin={pin.pin}
                        pinBusy={pin.busy}
                        isOwner={isOwner}
                    />

                    {isOwner && keyMap && <KeyMapOverlay onClose={() => setKeyMap(false)} />}
                </main>

                <HostSidebar
                    tab={tab}
                    onTabChange={setTab}
                    degradedChat={live.degradedChat}
                    chat={chat}
                    isLive={isLive}
                    user={user}
                    products={products}
                    sessionId={session.id}
                    selectedMessage={selectedMessage}
                    onSelectMessage={setSelectedMessage}
                    onClearSelection={() => setSelectedMessage(null)}
                    moderationNotice={live.moderation}
                    session={session}
                    isOwner={isOwner}
                    onSessionUpdated={onSessionUpdated}
                />
            </div>
        </div>
    );
};
export default Host;
