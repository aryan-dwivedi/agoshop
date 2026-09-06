import type { TranscriptLine } from '@shop/shared';

import Hls from 'hls.js';
import {
    Captions,
    LoaderCircle,
    Maximize,
    Minimize,
    Pause,
    Play,
    RotateCcw,
    Volume2,
    VolumeX,
} from 'lucide-react';
import {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';

export type ReplayPlayerHandle = {
    seekTo: (seconds: number) => void;
};
type ReplayPlayerProps = {
    src: string;
    poster: string | null;
    title: string;
    captions: TranscriptLine[];
};
const CAPTION_HOLD_MS = 6000;
// Live shopping replays should never exceed a few hours; reject bogus probe values.
const MAX_REASONABLE_DURATION_S = 8 * 60 * 60;
const clampDuration = (seconds: number): number => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.min(seconds, MAX_REASONABLE_DURATION_S);
};
const resolveDuration = (video: HTMLVideoElement, playbackTime = 0): number => {
    const media = clampDuration(video.duration);
    const bufferedEnd =
        video.buffered.length > 0
            ? clampDuration(video.buffered.end(video.buffered.length - 1))
            : 0;
    const seekableEnd =
        video.seekable.length > 0
            ? clampDuration(video.seekable.end(video.seekable.length - 1))
            : 0;
    const played = clampDuration(playbackTime);
    return Math.max(media, bufferedEnd, seekableEnd, played);
};
const seekForDurationProbe = (video: HTMLVideoElement): boolean => {
    if (video.seekable.length > 0) {
        const end = clampDuration(video.seekable.end(video.seekable.length - 1));
        if (end > 0) {
            video.currentTime = end;
            return true;
        }
    }
    if (video.buffered.length > 0) {
        const end = clampDuration(video.buffered.end(video.buffered.length - 1));
        if (end > 0) {
            video.currentTime = end;
            return true;
        }
    }
    return false;
};
const formatTime = (seconds: number): string => {
    const safe = clampDuration(seconds);
    if (safe <= 0) return '0:00';
    const whole = Math.floor(safe);
    const hours = Math.floor(whole / 3600);
    const minutes = Math.floor((whole % 3600) / 60);
    const remaining = String(whole % 60).padStart(2, '0');
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`
        : `${minutes}:${remaining}`;
};
export const ReplayPlayer = forwardRef<ReplayPlayerHandle, ReplayPlayerProps>(function ReplayPlayer(
    { src, poster, title, captions },
    ref,
): JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const hideTimerRef = useRef<number | null>(null);
    const durationProbeRef = useRef<number | null>(null);
    const durationFallbackRef = useRef<number | null>(null);
    const [playing, setPlaying] = useState(false);
    const [waiting, setWaiting] = useState(false);
    const [probingDuration, setProbingDuration] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [captionsOn, setCaptionsOn] = useState(true);
    const [fullscreen, setFullscreen] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [mediaError, setMediaError] = useState<string | null>(null);
    const clearHideTimer = useCallback(() => {
        if (hideTimerRef.current === null) return;
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    }, []);
    const revealControls = useCallback(() => {
        clearHideTimer();
        setControlsVisible(true);
        if (!videoRef.current?.paused) {
            hideTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2500);
        }
    }, [clearHideTimer]);
    useEffect(() => clearHideTimer, [clearHideTimer]);
    useEffect(() => {
        const onFullscreenChange = (): void =>
            setFullscreen(document.fullscreenElement === rootRef.current);
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
    }, []);
    const finishDurationProbe = useCallback(
        (video: HTMLVideoElement, resolvedDuration: number): void => {
            if (durationFallbackRef.current !== null) {
                window.clearTimeout(durationFallbackRef.current);
                durationFallbackRef.current = null;
            }
            setDuration(resolvedDuration);
            const restoreTime = durationProbeRef.current;
            if (restoreTime === null) return;
            durationProbeRef.current = null;
            video.currentTime = restoreTime;
            setCurrentTime(restoreTime);
            setProbingDuration(false);
        },
        [],
    );
    const syncDuration = useCallback(
        (video: HTMLVideoElement, probeUnknown = false): void => {
            const resolved = resolveDuration(video, video.currentTime);
            if (resolved > 0) {
                finishDurationProbe(video, resolved);
                return;
            }
            if (!probeUnknown || durationProbeRef.current !== null) return;
            durationProbeRef.current = video.currentTime;
            setProbingDuration(true);
            if (!seekForDurationProbe(video)) {
                finishDurationProbe(video, 0);
                return;
            }
            durationFallbackRef.current = window.setTimeout(() => {
                finishDurationProbe(video, resolveDuration(video, 0));
            }, 4000);
        },
        [finishDurationProbe],
    );
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        setMediaError(null);
        setCurrentTime(0);
        durationProbeRef.current = null;
        if (durationFallbackRef.current !== null) {
            window.clearTimeout(durationFallbackRef.current);
            durationFallbackRef.current = null;
        }
        setProbingDuration(false);
        setDuration(0);
        if (src.toLowerCase().split(/[?#]/, 1)[0]?.endsWith('.m3u8') && Hls.isSupported()) {
            const hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) setMediaError('This replay could not be loaded.');
            });
            return () => hls.destroy();
        }
        video.src = src;
        const durationTimer = window.setTimeout(() => syncDuration(video, true), 500);
        return () => {
            window.clearTimeout(durationTimer);
            if (durationFallbackRef.current !== null) {
                window.clearTimeout(durationFallbackRef.current);
                durationFallbackRef.current = null;
            }
            video.removeAttribute('src');
            video.load();
        };
    }, [src, syncDuration]);
    const seekTo = useCallback((seconds: number): void => {
        const video = videoRef.current;
        if (!video) return;
        if (durationProbeRef.current !== null) return;
        const limit = resolveDuration(video, duration);
        video.currentTime = Math.max(0, Math.min(seconds, limit > 0 ? limit : seconds));
        setCurrentTime(video.currentTime);
        if (limit > 0) setDuration((current) => Math.max(current, limit));
    }, [duration]);
    useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);
    const togglePlayback = useCallback((): void => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            if (video.ended) seekTo(0);
            void video.play().catch(() => setMediaError('Playback could not start.'));
        } else {
            video.pause();
        }
    }, [seekTo]);
    const toggleFullscreen = useCallback((): void => {
        if (document.fullscreenElement === rootRef.current) {
            void document.exitFullscreen();
            return;
        }
        void rootRef.current?.requestFullscreen();
    }, []);
    const toggleMuted = useCallback((): void => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        setMuted(video.muted);
    }, []);
    const activeCaption = useMemo(() => {
        if (!captionsOn || captions.length === 0) return null;
        const currentMs = currentTime * 1000;
        let candidate: TranscriptLine | null = null;
        for (const line of captions) {
            if (line.startMs > currentMs) break;
            candidate = line;
        }
        if (candidate === null || currentMs - candidate.startMs > CAPTION_HOLD_MS) return null;
        return candidate;
    }, [captions, captionsOn, currentTime]);
    const progress =
        duration > 0 ? Math.min(100, (currentTime / Math.max(duration, currentTime)) * 100) : 0;
    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        switch (event.key.toLowerCase()) {
            case ' ':
            case 'k':
                event.preventDefault();
                togglePlayback();
                break;
            case 'arrowleft':
                event.preventDefault();
                seekTo(currentTime - 5);
                break;
            case 'arrowright':
                event.preventDefault();
                seekTo(currentTime + 5);
                break;
            case 'm':
                toggleMuted();
                break;
            case 'c':
                setCaptionsOn((current) => !current);
                break;
            case 'f':
                toggleFullscreen();
                break;
            default:
                return;
        }
        revealControls();
    };
    return (
        <div
            ref={rootRef}
            data-theme="dark"
            role="group"
            aria-label={`${title} replay player`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerMove={revealControls}
            onPointerLeave={() => playing && setControlsVisible(false)}
            onFocusCapture={revealControls}
            className={`group/player relative aspect-video w-full overflow-hidden rounded-panel bg-black text-white shadow-card outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${controlsVisible ? '' : 'cursor-none'}`}
        >
            <video
                ref={videoRef}
                playsInline
                preload="metadata"
                poster={poster ?? undefined}
                onLoadedMetadata={(event) => syncDuration(event.currentTarget)}
                aria-label={`${title} recording`}
                className="h-full w-full object-contain"
                onClick={togglePlayback}
                onDoubleClick={toggleFullscreen}
                onDurationChange={(event) => syncDuration(event.currentTarget)}
                onTimeUpdate={(event) => {
                    if (durationProbeRef.current !== null) return;
                    const video = event.currentTarget;
                    const time = video.currentTime;
                    setCurrentTime(time);
                    // Browser-recorded WebM often under-reports duration metadata.
                    setDuration((current) => resolveDuration(video, Math.max(current, time)));
                }}
                onProgress={(event) => {
                    const video = event.currentTarget;
                    const resolved = resolveDuration(video, video.currentTime);
                    if (resolved <= 0) return;
                    if (durationProbeRef.current !== null) {
                        finishDurationProbe(video, resolved);
                        return;
                    }
                    setDuration((current) => Math.max(current, resolved));
                }}
                onPlay={() => {
                    setPlaying(true);
                    setWaiting(false);
                    revealControls();
                }}
                onPause={() => {
                    setPlaying(false);
                    setControlsVisible(true);
                    clearHideTimer();
                }}
                onEnded={() => {
                    setPlaying(false);
                    setControlsVisible(true);
                    const video = videoRef.current;
                    if (!video) return;
                    const time = video.currentTime;
                    setCurrentTime(time);
                    setDuration((current) => Math.max(current, time));
                }}
                onWaiting={() => setWaiting(true)}
                onCanPlay={(event) => {
                    setWaiting(false);
                    syncDuration(event.currentTarget, true);
                }}
                onVolumeChange={(event) => {
                    setVolume(event.currentTarget.volume);
                    setMuted(event.currentTarget.muted);
                }}
                onError={() => setMediaError('This replay could not be loaded.')}
            />

            <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-200 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
            />
            <div
                className={`pointer-events-none absolute left-3 top-3 flex items-center gap-2 transition-opacity duration-200 md:left-4 md:top-4 ${controlsVisible ? 'opacity-100' : 'opacity-0'}`}
            >
                <span className="rounded-full bg-black/55 px-3 py-1 text-11 font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-sm">
                    Replay
                </span>
                <span className="max-w-[55vw] truncate text-13 font-medium text-white/85 [text-shadow:var(--on-video-shadow)]">
                    {title}
                </span>
            </div>

            {activeCaption !== null && mediaError === null && (
                <div className="pointer-events-none absolute inset-x-4 bottom-20 z-10 flex justify-center md:bottom-24">
                    <p className="max-w-[48rem] rounded-ctl bg-black/85 px-3 py-1.5 text-center text-14 font-medium leading-relaxed text-white shadow-float md:text-16">
                        {activeCaption.text}
                    </p>
                </div>
            )}

            {(probingDuration || (waiting && playing)) && mediaError === null && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <LoaderCircle
                        className="h-9 w-9 animate-spin text-white"
                        strokeWidth={1.8}
                    />
                </div>
            )}

            {!playing && !probingDuration && mediaError === null && (
                <button
                    type="button"
                    aria-label={currentTime > 0 ? 'Resume replay' : 'Play replay'}
                    onClick={togglePlayback}
                    className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/55 text-white shadow-float backdrop-blur-sm transition hover:scale-105 hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                    {currentTime >= duration && duration > 0 ? (
                        <RotateCcw
                            className="h-7 w-7"
                            strokeWidth={1.8}
                        />
                    ) : (
                        <Play
                            className="ml-0.5 h-7 w-7"
                            fill="currentColor"
                            strokeWidth={1.8}
                        />
                    )}
                </button>
            )}

            {mediaError !== null && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#101210] p-6 text-center">
                    <p className="text-16 font-semibold text-white">Replay unavailable</p>
                    <p className="max-w-sm text-13 text-white/70">{mediaError}</p>
                    <button
                        type="button"
                        className="rounded-full bg-white px-4 py-2 text-13 font-semibold text-black"
                        onClick={() => {
                            setMediaError(null);
                            videoRef.current?.load();
                        }}
                    >
                        Try again
                    </button>
                </div>
            )}

            <div
                className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-14 transition-opacity duration-200 md:px-4 md:pb-4 ${controlsVisible || !playing ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
                <label className="block py-2">
                    <input
                        type="range"
                        aria-label="Replay position"
                        min={0}
                        max={Math.max(duration, currentTime) || 0}
                        step={0.1}
                        value={currentTime}
                        disabled={duration <= 0 && currentTime <= 0}
                        onChange={(event) => seekTo(Number(event.target.value))}
                        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/30 accent-white disabled:cursor-not-allowed [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        style={{
                            background: `linear-gradient(to right, #fff 0%, #fff ${progress}%, rgb(255 255 255 / 0.28) ${progress}%, rgb(255 255 255 / 0.28) 100%)`,
                        }}
                    />
                </label>

                <div className="flex items-center gap-1.5 md:gap-2">
                    <button
                        type="button"
                        aria-label={playing ? 'Pause replay' : 'Play replay'}
                        disabled={probingDuration}
                        onClick={togglePlayback}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50"
                    >
                        {playing ? (
                            <Pause
                                className="h-5 w-5"
                                fill="currentColor"
                                strokeWidth={1.8}
                            />
                        ) : (
                            <Play
                                className="ml-0.5 h-5 w-5"
                                fill="currentColor"
                                strokeWidth={1.8}
                            />
                        )}
                    </button>

                    <div className="group/volume flex items-center">
                        <button
                            type="button"
                            aria-label={muted || volume === 0 ? 'Unmute replay' : 'Mute replay'}
                            onClick={toggleMuted}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                            {muted || volume === 0 ? (
                                <VolumeX
                                    className="h-5 w-5"
                                    strokeWidth={1.8}
                                />
                            ) : (
                                <Volume2
                                    className="h-5 w-5"
                                    strokeWidth={1.8}
                                />
                            )}
                        </button>
                        <label className="hidden w-0 overflow-hidden transition-all duration-200 group-hover/volume:w-20 group-focus-within/volume:w-20 sm:block">
                            <span className="sr-only">Volume</span>
                            <input
                                type="range"
                                aria-label="Volume"
                                min={0}
                                max={1}
                                step={0.05}
                                value={muted ? 0 : volume}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    const video = videoRef.current;
                                    if (!video) return;
                                    video.volume = next;
                                    video.muted = next === 0;
                                }}
                                className="mx-1 h-1 w-[4.5rem] cursor-pointer appearance-none rounded-full bg-white/30 accent-white [&::-moz-range-thumb]:h-2.5 [&::-moz-range-thumb]:w-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                            />
                        </label>
                    </div>

                    <span className="tnum ml-0.5 text-12 font-medium text-white/90 md:text-13">
                        {formatTime(currentTime)} <span className="text-white/55">/</span>{' '}
                        {formatTime(Math.max(duration, currentTime))}
                    </span>

                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            aria-label={captionsOn ? 'Turn captions off' : 'Turn captions on'}
                            aria-pressed={captionsOn}
                            title="Captions (C)"
                            onClick={() => setCaptionsOn((current) => !current)}
                            className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-12 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                                captionsOn
                                    ? 'bg-white text-black hover:bg-white/90'
                                    : 'text-white hover:bg-white/15'
                            }`}
                        >
                            <Captions
                                className="h-5 w-5"
                                strokeWidth={1.8}
                            />
                        </button>
                        <button
                            type="button"
                            aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'}
                            title="Full screen (F)"
                            onClick={toggleFullscreen}
                            className="flex h-9 w-9 items-center justify-center rounded-full text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                            {fullscreen ? (
                                <Minimize
                                    className="h-5 w-5"
                                    strokeWidth={1.8}
                                />
                            ) : (
                                <Maximize
                                    className="h-5 w-5"
                                    strokeWidth={1.8}
                                />
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
