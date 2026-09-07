import type { HlsOrigin } from '../../hooks/useLiveSession';
import type { JoinSessionDto } from '@shop/shared';
import type {
    IAgoraRTCClient,
    IAgoraRTCRemoteUser,
    IRemoteAudioTrack,
    IRemoteVideoTrack,
} from 'agora-rtc-sdk-ng';
import type { ReactNode, RefObject } from 'react';

import AgoraRTC, { RemoteStreamFallbackType, RemoteStreamType } from 'agora-rtc-sdk-ng';
import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    LIVE_SYNC_INTERVAL_MS,
    LIVE_SYNC_NUDGE_RATE,
    LIVE_SYNC_NUDGE_THRESHOLD_SECONDS,
    LIVE_SYNC_SEEK_THRESHOLD_SECONDS,
    syncedPosition,
} from '@shop/shared';

import { SoundOffIcon, SoundOnIcon } from '../icons';

type LiveClock = {
    startedAtMs: number;
    skewMs: number;
};
export type VideoQuality = 'auto' | 'low' | 'high';
type Props = {
    appId: string | null;
    join: JoinSessionDto | null;
    deliveryTier: 'rtc' | 'cdn';
    hls: HlsOrigin | null;
    onRemoteAudioTrack?: (track: IRemoteAudioTrack | null) => void;
    standbyUrl?: string | null;
    liveClock: LiveClock | null;
    quality?: VideoQuality;
    overlay?: ReactNode;
    blurred?: boolean;
    fit?: 'aspect' | 'fill';
    contentFit?: 'cover' | 'contain';
    onStreamAspect?: (ratio: number) => void;
    className?: string;
};
type RemoteVideo = {
    uid: string;
    track: IRemoteVideoTrack;
};
type StageState = 'idle' | 'connecting' | 'waiting-for-host' | 'playing' | 'error';
const STATE_LABEL: Record<StageState, string> = {
    idle: 'Not connected',
    connecting: 'Connecting',
    'waiting-for-host': "Standby — the host hasn't started yet",
    playing: 'Live',
    error: 'Stream unavailable',
};
const FULL_VOLUME = 100;
const RemoteVideoTile = ({
    publisher,
    contentFit,
    watchAspect,
}: {
    publisher: RemoteVideo;
    contentFit: 'cover' | 'contain';
    watchAspect: (key: string, element: HTMLVideoElement | null) => void;
}): JSX.Element => {
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        publisher.track.play(container, { fit: contentFit });
        const captureAspect = (): void =>
            watchAspect(`rtc-${publisher.uid}`, container.querySelector<HTMLVideoElement>('video'));
        captureAspect();
        const frame = window.requestAnimationFrame(captureAspect);
        return () => {
            window.cancelAnimationFrame(frame);
            publisher.track.stop();
        };
    }, [contentFit, publisher.track, publisher.uid, watchAspect]);
    return (
        <div
            ref={containerRef}
            aria-label="Live presenter"
            className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-black"
        />
    );
};
const shortestDrift = (position: number, target: number, durationSeconds: number): number => {
    const raw = position - target;
    const half = durationSeconds / 2;
    if (raw > half) return raw - durationSeconds;
    if (raw < -half) return raw + durationSeconds;
    return raw;
};
const useSyncedPlayhead = (
    videoRef: RefObject<HTMLVideoElement>,
    {
        clock,
        enabled,
        source,
    }: {
        clock: LiveClock | null;
        enabled: boolean;
        source: string | null;
    },
): void => {
    useEffect(() => {
        if (!enabled || !clock || source === null) return;
        const video = videoRef.current;
        if (!video) return;
        const targetPosition = (): number | null =>
            syncedPosition(clock.startedAtMs, Date.now() + clock.skewMs, video.duration);
        const anchor = (): void => {
            const target = targetPosition();
            if (target === null) return;
            video.currentTime = target;
        };
        const correctDrift = (): void => {
            const target = targetPosition();
            if (target === null) return;
            const drift = shortestDrift(video.currentTime, target, video.duration);
            if (Math.abs(drift) > LIVE_SYNC_SEEK_THRESHOLD_SECONDS) {
                video.currentTime = target;
                video.playbackRate = 1;
                return;
            }
            if (Math.abs(drift) > LIVE_SYNC_NUDGE_THRESHOLD_SECONDS) {
                video.playbackRate =
                    drift > 0 ? 1 - LIVE_SYNC_NUDGE_RATE : 1 + LIVE_SYNC_NUDGE_RATE;
                return;
            }
            video.playbackRate = 1;
        };
        video.addEventListener('loadedmetadata', anchor);
        if (video.readyState >= HTMLMediaElement.HAVE_METADATA) anchor();
        const onVisible = (): void => {
            if (document.visibilityState === 'visible') correctDrift();
        };
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(correctDrift, LIVE_SYNC_INTERVAL_MS);
        return () => {
            video.removeEventListener('loadedmetadata', anchor);
            document.removeEventListener('visibilitychange', onVisible);
            window.clearInterval(timer);
            video.playbackRate = 1;
        };
    }, [videoRef, clock, enabled, source]);
};
const useStreamAspect = (
    onStreamAspect: ((ratio: number) => void) | undefined,
): ((key: string, element: HTMLVideoElement | null) => void) => {
    const callbackRef = useRef(onStreamAspect);
    callbackRef.current = onStreamAspect;
    const reportedRef = useRef<string | null>(null);
    const detachRef = useRef<(() => void) | null>(null);
    useEffect(
        () => () => {
            detachRef.current?.();
            detachRef.current = null;
        },
        [],
    );
    return useCallback((key: string, element: HTMLVideoElement | null): void => {
        if (element === null || reportedRef.current === key) return;
        const emit = (): void => {
            if (reportedRef.current === key) return;
            const { videoWidth, videoHeight } = element;
            if (videoWidth <= 0 || videoHeight <= 0) return;
            reportedRef.current = key;
            detachRef.current?.();
            detachRef.current = null;
            callbackRef.current?.(videoWidth / videoHeight);
        };
        emit();
        if (reportedRef.current === key) return;
        element.addEventListener('loadedmetadata', emit);
        element.addEventListener('resize', emit);
        detachRef.current?.();
        detachRef.current = () => {
            element.removeEventListener('loadedmetadata', emit);
            element.removeEventListener('resize', emit);
        };
    }, []);
};
export const VideoStage = ({
    appId,
    join,
    deliveryTier,
    hls,
    onRemoteAudioTrack,
    standbyUrl = null,
    liveClock,
    quality = 'auto',
    overlay,
    blurred = false,
    fit = 'aspect',
    contentFit = 'cover',
    onStreamAspect,
    className,
}: Props): JSX.Element => {
    const videoElementRef = useRef<HTMLVideoElement>(null);
    const standbyVideoRef = useRef<HTMLVideoElement>(null);
    const audioTracksRef = useRef<Map<string, IRemoteAudioTrack>>(new Map());
    const remoteVideoTracksRef = useRef<Map<string, IRemoteVideoTrack>>(new Map());
    const rtcClientRef = useRef<IAgoraRTCClient | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const qualityRef = useRef(quality);
    qualityRef.current = quality;
    const audioCallbackRef = useRef(onRemoteAudioTrack);
    audioCallbackRef.current = onRemoteAudioTrack;
    const watchAspect = useStreamAspect(onStreamAspect);
    const [rtcState, setRtcState] = useState<StageState>('idle');
    const [cdnState, setCdnState] = useState<StageState>('idle');
    const [error, setError] = useState<string | null>(null);
    const [cdnPlaying, setCdnPlaying] = useState(false);
    const [remoteVideos, setRemoteVideos] = useState<RemoteVideo[]>([]);
    const [audioEnabled, setAudioEnabled] = useState(false);
    const audioEnabledRef = useRef(audioEnabled);
    audioEnabledRef.current = audioEnabled;
    useEffect(() => {
        for (const track of audioTracksRef.current.values()) {
            track.setVolume(audioEnabled ? FULL_VOLUME : 0);
        }
        const primaryTrack = audioTracksRef.current.values().next().value ?? null;
        audioCallbackRef.current?.(audioEnabled ? primaryTrack : null);
    }, [audioEnabled]);
    useEffect(() => {
        const target = rtcClientRef.current;
        if (target !== null) {
            const streamType =
                quality === 'low' ? RemoteStreamType.LOW_STREAM : RemoteStreamType.HIGH_STREAM;
            const fallbackType =
                quality === 'high'
                    ? RemoteStreamFallbackType.DISABLE
                    : quality === 'low'
                      ? RemoteStreamFallbackType.AUDIO_ONLY
                      : RemoteStreamFallbackType.LOW_STREAM;
            void target.setRemoteDefaultVideoStreamType(streamType);
            for (const remote of target.remoteUsers) {
                void target.setRemoteVideoStreamType(remote.uid, streamType);
                void target.setStreamFallbackOption(remote.uid, fallbackType);
            }
        }
        const hlsInstance = hlsRef.current;
        if (hlsInstance !== null && hlsInstance.levels.length > 0) {
            hlsInstance.currentLevel =
                quality === 'auto' ? -1 : quality === 'low' ? 0 : hlsInstance.levels.length - 1;
        }
    }, [quality]);
    const rtcShouldRun = Boolean(appId && join) && (deliveryTier === 'rtc' || !cdnPlaying);
    useEffect(() => {
        if (!rtcShouldRun || !appId || !join) return;
        remoteVideoTracksRef.current.clear();
        setRemoteVideos([]);
        let client: IAgoraRTCClient | null = null;
        let cancelled = false;
        void (async () => {
            setRtcState('connecting');
            try {
                const rtc = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
                rtcClientRef.current = rtc;
                client = rtc;
                rtc.on('user-published', (user: IAgoraRTCRemoteUser, mediaType) => {
                    void (async () => {
                        try {
                            await rtc.subscribe(user, mediaType);
                            if (mediaType === 'video') {
                                const selected =
                                    qualityRef.current === 'low'
                                        ? RemoteStreamType.LOW_STREAM
                                        : RemoteStreamType.HIGH_STREAM;
                                const fallback =
                                    qualityRef.current === 'high'
                                        ? RemoteStreamFallbackType.DISABLE
                                        : qualityRef.current === 'low'
                                          ? RemoteStreamFallbackType.AUDIO_ONLY
                                          : RemoteStreamFallbackType.LOW_STREAM;
                                await rtc.setRemoteVideoStreamType(user.uid, selected);
                                await rtc.setStreamFallbackOption(user.uid, fallback);
                            }
                            if (mediaType === 'video' && user.videoTrack) {
                                const uid = String(user.uid);
                                remoteVideoTracksRef.current.set(uid, user.videoTrack);
                                setRemoteVideos(
                                    Array.from(
                                        remoteVideoTracksRef.current,
                                        ([remoteUid, track]) => ({
                                            uid: remoteUid,
                                            track,
                                        }),
                                    ),
                                );
                                setRtcState('playing');
                            }
                            if (mediaType === 'audio' && user.audioTrack) {
                                const uid = String(user.uid);
                                const track = user.audioTrack;
                                track.play();
                                track.setVolume(audioEnabledRef.current ? FULL_VOLUME : 0);
                                audioTracksRef.current.set(uid, track);
                                const primaryTrack =
                                    audioTracksRef.current.values().next().value ?? null;
                                audioCallbackRef.current?.(
                                    audioEnabledRef.current ? primaryTrack : null,
                                );
                            }
                        } catch (err) {
                            setError(err instanceof Error ? err.message : 'subscribe_failed');
                        }
                    })();
                });
                const forgetRemote = (
                    user: IAgoraRTCRemoteUser,
                    mediaType?: 'audio' | 'video',
                ): void => {
                    const uid = String(user.uid);
                    if (mediaType === undefined || mediaType === 'audio') {
                        audioTracksRef.current.get(uid)?.stop();
                        audioTracksRef.current.delete(uid);
                        const primaryTrack = audioTracksRef.current.values().next().value ?? null;
                        audioCallbackRef.current?.(audioEnabledRef.current ? primaryTrack : null);
                    }
                    if (mediaType === undefined || mediaType === 'video') {
                        remoteVideoTracksRef.current.delete(uid);
                        setRemoteVideos(
                            Array.from(remoteVideoTracksRef.current, ([remoteUid, track]) => ({
                                uid: remoteUid,
                                track,
                            })),
                        );
                        setRtcState(
                            remoteVideoTracksRef.current.size > 0 ? 'playing' : 'waiting-for-host',
                        );
                    }
                };
                rtc.on('user-unpublished', forgetRemote);
                rtc.on('user-left', (user) => forgetRemote(user));
                await rtc.setClientRole('audience', { level: 2 });
                await rtc.setRemoteDefaultVideoStreamType(
                    qualityRef.current === 'low'
                        ? RemoteStreamType.LOW_STREAM
                        : RemoteStreamType.HIGH_STREAM,
                );
                await rtc.join(appId, join.rtcChannel, join.rtcToken, join.uid);
                if (cancelled) return;
                setRtcState((current) => (current === 'playing' ? current : 'waiting-for-host'));
            } catch (err) {
                if (!cancelled) {
                    setRtcState('error');
                    setError(err instanceof Error ? err.message : 'rtc_join_failed');
                }
            }
        })();
        return () => {
            cancelled = true;
            rtcClientRef.current = null;
            for (const track of audioTracksRef.current.values()) track.stop();
            audioTracksRef.current.clear();
            remoteVideoTracksRef.current.clear();
            audioCallbackRef.current?.(null);
            const leaving = client;
            if (leaving) {
                leaving.removeAllListeners();
                void leaving.leave().catch(() => undefined);
            }
        };
    }, [rtcShouldRun, appId, join, watchAspect, contentFit]);
    useEffect(() => {
        if (deliveryTier !== 'cdn' || !hls) return;
        const video = videoElementRef.current;
        if (!video) return;
        setCdnState('connecting');
        let instance: Hls | null = null;
        const onPlaying = (): void => {
            setCdnState('playing');
            setCdnPlaying(true);
        };
        video.addEventListener('playing', onPlaying);
        if (Hls.isSupported()) {
            instance = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                capLevelToPlayerSize: true,
            });
            hlsRef.current = instance;
            instance.on(Hls.Events.MANIFEST_PARSED, () => {
                if (instance === null || instance.levels.length === 0) return;
                instance.currentLevel =
                    qualityRef.current === 'auto'
                        ? -1
                        : qualityRef.current === 'low'
                          ? 0
                          : instance.levels.length - 1;
            });
            instance.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal) return;
                setCdnState('error');
                setError(`HLS ${data.details}`);
            });
            instance.loadSource(hls.url);
            instance.attachMedia(video);
        } else if (video.canPlayType('application/vnd.apple.mpegurl') !== '') {
            video.src = hls.url;
        } else {
            setCdnState('error');
            setError('This browser cannot play HLS.');
        }
        void video.play().catch(() => undefined);
        return () => {
            video.removeEventListener('playing', onPlaying);
            hlsRef.current = null;
            instance?.destroy();
        };
    }, [deliveryTier, hls]);
    const activeState = deliveryTier === 'cdn' && cdnPlaying ? cdnState : rtcState;
    const handingOver = deliveryTier === 'cdn' && !cdnPlaying;
    const standbyActive =
        standbyUrl !== null && deliveryTier === 'rtc' && rtcState === 'waiting-for-host';
    useSyncedPlayhead(standbyVideoRef, {
        clock: liveClock,
        enabled: standbyActive,
        source: standbyUrl,
    });
    useSyncedPlayhead(videoElementRef, {
        clock: liveClock,
        enabled: deliveryTier === 'cdn',
        source: hls?.url ?? null,
    });
    return (
        <div
            className={`relative overflow-hidden bg-black ${fit === 'fill' ? 'h-full' : 'rounded-panel border border-line'} ${className ?? ''}`}
        >
            <div
                className={`relative w-full ${fit === 'fill' ? 'h-full' : 'aspect-video'} ${blurred ? 'blur-2xl' : ''}`}
            >
                <div
                    className={`absolute inset-0 grid h-full w-full gap-px bg-black ${
                        remoteVideos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'
                    } ${deliveryTier === 'cdn' && cdnPlaying ? 'hidden' : ''}`}
                >
                    {remoteVideos.map((publisher) => (
                        <RemoteVideoTile
                            key={publisher.uid}
                            publisher={publisher}
                            contentFit={contentFit}
                            watchAspect={watchAspect}
                        />
                    ))}
                </div>
                <video
                    ref={videoElementRef}
                    playsInline
                    controls={false}
                    muted={handingOver || !audioEnabled}
                    onLoadedMetadata={(e) => watchAspect(`cdn-${hls?.url ?? ''}`, e.currentTarget)}
                    className={`absolute inset-0 h-full w-full bg-black ${contentFit === 'contain' ? 'object-contain' : 'object-cover'} ${deliveryTier === 'cdn' && cdnPlaying ? '' : 'pointer-events-none opacity-0'}`}
                />
                {standbyActive && (
                    <video
                        key={standbyUrl}
                        ref={standbyVideoRef}
                        src={standbyUrl}
                        autoPlay
                        loop
                        playsInline
                        muted={!audioEnabled}
                        onLoadedMetadata={(e) =>
                            watchAspect(`standby-${standbyUrl ?? ''}`, e.currentTarget)
                        }
                        className={`absolute inset-0 h-full w-full bg-black ${contentFit === 'contain' ? 'object-contain' : 'object-cover'}`}
                    />
                )}
            </div>

            {(handingOver || standbyActive) && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end p-3">
                    <span className="on-video pill text-14">
                        {handingOver ? 'Connecting' : STATE_LABEL['waiting-for-host']}
                    </span>
                </div>
            )}

            {(standbyActive || activeState === 'playing') && (
                <button
                    type="button"
                    aria-label={
                        audioEnabled ? 'Mute this live session' : 'Unmute this live session'
                    }
                    className="on-video absolute bottom-3 left-3 z-30 inline-flex min-h-ctl items-center gap-2 rounded-full px-3.5 text-14 font-medium transition duration-ctl ease-out hover:text-accent"
                    title={audioEnabled ? 'Mute this live session' : 'Unmute this live session'}
                    onClick={() => setAudioEnabled((enabled) => !enabled)}
                >
                    {audioEnabled ? (
                        <SoundOnIcon className="h-4 w-4" />
                    ) : (
                        <SoundOffIcon className="h-4 w-4" />
                    )}
                    {audioEnabled ? 'Mute' : 'Unmute'}
                </button>
            )}

            {activeState !== 'playing' && !standbyActive && (
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
                    {activeState !== 'error' && (
                        <span
                            aria-hidden
                            className="skeleton absolute inset-0 rounded-none"
                        />
                    )}
                    <p className="relative text-14 font-medium text-t2">
                        {STATE_LABEL[activeState]}
                    </p>
                    {error !== null && activeState === 'error' && (
                        <p className="relative max-w-sm text-13 text-danger">{error}</p>
                    )}
                </div>
            )}

            {overlay}
        </div>
    );
};
