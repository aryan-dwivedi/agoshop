import type { useLiveSession } from '../../hooks/useLiveSession';
import type { FlyingReactionsHandle } from './FlyingReactionsOverlay';
import type { VideoQuality } from './VideoStage';
import type { LiveSessionDto } from '@shop/shared';
import type { IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

import { Maximize, PanelRightClose, PanelRightOpen, Settings } from 'lucide-react';
import { useRef } from 'react';
import { Link } from 'react-router-dom';

import { CaptionIcon, CloseIcon, PlayIcon } from '../icons';
import { CaptionOverlay } from './CaptionOverlay';
import { FlyingReactionsOverlay } from './FlyingReactionsOverlay';
import { LiveBadge } from './LiveBadge';
import { PinBar } from './PinBar';
import { PollCard } from './PollCard';
import { ReactionBar } from './ReactionBar';
import { ScheduledStage } from './ScheduledStage';
import { VideoStage } from './VideoStage';

type LiveSession = ReturnType<typeof useLiveSession>;
const QUALITY_OPTIONS: readonly {
    id: VideoQuality;
    label: string;
    note: string;
}[] = [
    { id: 'auto', label: 'Auto', note: 'Adapts to your connection' },
    {
        id: 'low',
        label: 'Data saver',
        note: 'Lower bandwidth, steadier playback',
    },
    { id: 'high', label: 'Best quality', note: 'Highest available rendition' },
];
const VIEWER_FLOOR = 10;
export const LiveTheatre = ({
    session,
    live,
    isLive,
    config,
    offline,
    consentGate,
    onConsent,
    quality,
    onQualityChange,
    qualityMenuOpen,
    onQualityMenuOpenChange,
    captionsAvailable,
    captionsOn,
    onToggleCaptions,
    captionNotice,
    pollOpen,
    onPollOpenChange,
    chatCollapsed,
    onChatCollapsedChange,
    onRemoteAudioTrack,
    onViewProducts,
    user,
}: {
    session: LiveSessionDto;
    live: LiveSession;
    isLive: boolean;
    config: {
        agoraAppId: string | null;
    } | null;
    offline: boolean;
    consentGate: boolean;
    onConsent: () => void;
    quality: VideoQuality;
    onQualityChange: (quality: VideoQuality) => void;
    qualityMenuOpen: boolean;
    onQualityMenuOpenChange: (open: boolean | ((open: boolean) => boolean)) => void;
    captionsAvailable: boolean;
    captionsOn: boolean;
    onToggleCaptions: () => void;
    captionNotice: string | null;
    pollOpen: boolean;
    onPollOpenChange: (open: boolean) => void;
    chatCollapsed: boolean;
    onChatCollapsedChange: (collapsed: boolean | ((collapsed: boolean) => boolean)) => void;
    onRemoteAudioTrack: (track: IRemoteAudioTrack | null) => void;
    onViewProducts: () => void;
    user: unknown;
}): JSX.Element => {
    const flyingReactionsRef = useRef<FlyingReactionsHandle>(null);
    const playerRef = useRef<HTMLDivElement>(null);
    const viewerLabel =
        live.viewerCount >= VIEWER_FLOOR
            ? `${live.viewerCount.toLocaleString('en-IN')} watching`
            : 'Live now';
    const pinBarShown = isLive && session.products.length > 0;
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-black">
            <div
                ref={playerRef}
                className="relative aspect-video w-full shrink-0 overflow-hidden bg-black lg:min-h-0 lg:flex-1 lg:aspect-auto"
            >
                <div className="absolute inset-0">
                    {isLive ? (
                        <VideoStage
                            fit="fill"
                            contentFit="contain"
                            appId={config?.agoraAppId ?? null}
                            join={live.join}
                            deliveryTier={live.deliveryTier}
                            hls={live.hls}
                            onRemoteAudioTrack={onRemoteAudioTrack}
                            standbyUrl={session.liveSourceUrl}
                            liveClock={live.liveClock}
                            quality={quality}
                            blurred={consentGate}
                            overlay={
                                <>
                                    <FlyingReactionsOverlay
                                        ref={flyingReactionsRef}
                                        reactions={live.reactions}
                                    />
                                    <CaptionOverlay
                                        captions={live.captions}
                                        enabled={captionsAvailable && captionsOn}
                                        className="bottom-[4.5rem] lg:bottom-20"
                                    />
                                </>
                            }
                        />
                    ) : session.status === 'scheduled' ? (
                        <ScheduledStage
                            session={session}
                            skewMs={live.serverSkewMs}
                        />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#111214] px-6 text-center">
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
                                <PlayIcon className="h-6 w-6" />
                            </span>
                            <p className="text-19 font-semibold text-white">This show has ended.</p>
                            {session.recordingStatus === 'ready' ? (
                                <div className="flex flex-wrap items-center justify-center gap-2">
                                    <Link
                                        to={`/replay/${session.slug}`}
                                        className="btn-commit"
                                    >
                                        <PlayIcon className="h-4 w-4" />
                                        Watch the replay
                                    </Link>
                                    <Link
                                        to="/live"
                                        className="on-video rounded-full px-4 py-2 text-14 font-medium"
                                    >
                                        See what&apos;s live
                                    </Link>
                                </div>
                            ) : (
                                <>
                                    <p className="max-w-sm text-14 leading-relaxed text-white/70">
                                        The replay will be here in a few minutes.
                                    </p>
                                    <Link
                                        to="/live"
                                        className="on-video rounded-full px-4 py-2 text-14 font-medium"
                                    >
                                        See what&apos;s live
                                    </Link>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {consentGate && (
                    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center backdrop-blur-sm">
                        <p className="max-w-sm text-14 leading-relaxed text-white">
                            This show is being recorded, and the recording is published as a replay.
                            Your chat messages are stored with your display name.
                        </p>
                        <button
                            type="button"
                            className="btn-commit"
                            onClick={onConsent}
                        >
                            I understand — start watching
                        </button>
                    </div>
                )}

                <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start gap-3 p-3 md:p-4">
                    <div className="scrim-top pointer-events-none absolute inset-x-0 top-0 h-24" />
                    <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        <LiveBadge
                            status={session.status}
                            viewerCount={live.viewerCount}
                            onDark
                        />
                        {offline && (
                            <span
                                role="status"
                                className="on-video pill text-14"
                            >
                                Reconnecting
                            </span>
                        )}
                        {isLive && captionsAvailable && captionsOn && (
                            <span className="on-video pill text-14">CC</span>
                        )}
                    </div>

                    {live.poll !== null && (
                        <div className="pointer-events-auto relative w-[min(20rem,65%)] shrink-0">
                            {pollOpen ? (
                                <div className="relative">
                                    <PollCard
                                        poll={live.poll}
                                        onPollChange={live.applyPoll}
                                        canVote={
                                            Boolean(user) && live.poll.status === 'open' && !offline
                                        }
                                    />
                                    <button
                                        type="button"
                                        aria-label="Collapse the poll"
                                        className="on-video absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full"
                                        onClick={() => onPollOpenChange(false)}
                                    >
                                        <CloseIcon className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    aria-expanded={false}
                                    className="on-video ml-auto flex min-h-ctl w-full items-center gap-2 rounded-full px-3.5 text-14 font-medium"
                                    onClick={() => onPollOpenChange(true)}
                                >
                                    <span className="truncate">Poll · {live.poll.question}</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {isLive && qualityMenuOpen && (
                    <div
                        role="menu"
                        aria-label="Playback and captions settings"
                        className="absolute bottom-16 right-3 z-40 w-72 rounded-panel border border-white/15 bg-[#18181b]/95 p-2 text-white shadow-float backdrop-blur md:right-4"
                    >
                        <div className="flex items-center justify-between px-2 py-1.5">
                            <p className="text-14 font-semibold">Playback & captions</p>
                            <button
                                type="button"
                                className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white"
                                aria-label="Close playback and captions settings"
                                onClick={() => onQualityMenuOpenChange(false)}
                            >
                                <CloseIcon className="h-4 w-4" />
                            </button>
                        </div>
                        <p className="px-2 pb-1 pt-2 text-11 font-semibold uppercase tracking-[0.08em] text-white/55">
                            Quality
                        </p>
                        {QUALITY_OPTIONS.map((option) => (
                            <button
                                key={option.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={quality === option.id}
                                className="flex w-full items-center gap-3 rounded-ctl px-2 py-2 text-left hover:bg-white/10"
                                onClick={() => {
                                    onQualityChange(option.id);
                                    onQualityMenuOpenChange(false);
                                }}
                            >
                                <span
                                    className={`h-2 w-2 shrink-0 rounded-full ${quality === option.id ? 'bg-accent' : 'bg-white/20'}`}
                                />
                                <span className="min-w-0">
                                    <span className="block text-13 font-medium">
                                        {option.label}
                                    </span>
                                    <span className="block text-11 text-white/55">
                                        {option.note}
                                    </span>
                                </span>
                            </button>
                        ))}
                        <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={captionsAvailable && captionsOn}
                            disabled={!captionsAvailable}
                            className="mt-1 flex w-full items-center justify-between rounded-ctl border-t border-white/10 px-2 py-2 text-13 hover:bg-white/10 disabled:opacity-45"
                            onClick={onToggleCaptions}
                        >
                            Closed captions
                            <span>
                                {captionsAvailable ? (captionsOn ? 'On' : 'Off') : 'Unavailable'}
                            </span>
                        </button>
                    </div>
                )}

                {isLive && (
                    <>
                        <div className="scrim-bottom pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28" />
                        {captionNotice !== null && (
                            <p
                                role="status"
                                className="on-video pointer-events-none absolute bottom-16 right-3 z-40 rounded-full px-3 py-2 text-13 md:right-4"
                            >
                                {captionNotice}
                            </p>
                        )}
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-end justify-end gap-2 p-3 md:p-4">
                            <div className="pointer-events-auto hidden lg:block">
                                <ReactionBar
                                    sessionId={session.id}
                                    disabled={offline}
                                    onSpawn={(emoji) => flyingReactionsRef.current?.spawn(emoji)}
                                />
                            </div>
                            <button
                                type="button"
                                aria-pressed={chatCollapsed}
                                aria-label={
                                    chatCollapsed ? 'Open room sidebar' : 'Collapse room sidebar'
                                }
                                title={
                                    chatCollapsed ? 'Open room sidebar' : 'Collapse room sidebar'
                                }
                                className="on-video pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full"
                                onClick={() => onChatCollapsedChange((collapsed) => !collapsed)}
                            >
                                {chatCollapsed ? (
                                    <PanelRightOpen className="h-4 w-4" />
                                ) : (
                                    <PanelRightClose className="h-4 w-4" />
                                )}
                            </button>
                            <button
                                type="button"
                                aria-pressed={captionsAvailable ? captionsOn : undefined}
                                aria-label={
                                    captionsAvailable
                                        ? captionsOn
                                            ? 'Turn off closed captions'
                                            : 'Turn on closed captions'
                                        : 'Closed captions unavailable'
                                }
                                title={
                                    captionsAvailable
                                        ? 'Closed captions'
                                        : 'Closed captions unavailable'
                                }
                                disabled={!captionsAvailable}
                                className="on-video pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-45"
                                onClick={onToggleCaptions}
                            >
                                <CaptionIcon className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-expanded={qualityMenuOpen}
                                aria-label={`Playback and captions settings, quality ${QUALITY_OPTIONS.find((option) => option.id === quality)?.label ?? 'Auto'}`}
                                title="Playback & captions"
                                className="on-video pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full px-3"
                                onClick={() => onQualityMenuOpenChange((open) => !open)}
                            >
                                <Settings className="h-4 w-4" />
                            </button>
                            <button
                                type="button"
                                aria-label="Enter full screen"
                                title="Full screen"
                                className="on-video pointer-events-auto inline-flex h-10 items-center justify-center rounded-full px-3"
                                onClick={() =>
                                    void playerRef.current
                                        ?.requestFullscreen()
                                        .catch(() => undefined)
                                }
                            >
                                <Maximize className="h-4 w-4" />
                            </button>
                            {live.joinError !== null && (
                                <p className="on-video pointer-events-auto pill text-14 text-danger">
                                    Could not join the stream.
                                </p>
                            )}
                        </div>

                        <div className="absolute right-3 top-1/2 z-30 -translate-y-1/2 lg:hidden">
                            <ReactionBar
                                sessionId={session.id}
                                disabled={offline}
                                variant="tap"
                                onSpawn={(emoji) => flyingReactionsRef.current?.spawn(emoji)}
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="flex shrink-0 items-start gap-3 border-t border-line bg-surface px-4 py-3 md:items-center">
                <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-16 font-bold text-accent-ink"
                >
                    {session.hostName.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                    <h1 className="truncate text-19 font-semibold tracking-[-0.01em] text-t1 lg:text-20">
                        {session.title}
                    </h1>
                    <p className="truncate text-13 text-t2">
                        {session.hostName} · {session.sellerName}
                    </p>
                </div>
                {isLive && (
                    <span className="tnum hidden shrink-0 text-13 font-medium text-t2 sm:block">
                        {viewerLabel}
                    </span>
                )}
            </div>

            {pinBarShown && (
                <PinBar
                    sessionId={session.id}
                    products={session.products}
                    pinnedProductId={live.pinnedProductId}
                    live={isLive}
                    signedIn={Boolean(user)}
                    onViewProducts={onViewProducts}
                />
            )}
        </div>
    );
};
