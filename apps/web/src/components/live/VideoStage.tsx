import AgoraRTC, {
  RemoteStreamFallbackType,
  RemoteStreamType,
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';
import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  LIVE_SYNC_INTERVAL_MS,
  LIVE_SYNC_NUDGE_RATE,
  LIVE_SYNC_NUDGE_THRESHOLD_SECONDS,
  LIVE_SYNC_SEEK_THRESHOLD_SECONDS,
  syncedPosition,
  type JoinSessionDto,
} from '@shop/shared';

import type { HlsOrigin } from '../../hooks/useLiveSession';
import { SoundOffIcon, SoundOnIcon } from '../icons';

/**
 * The viewer's media surface, and the only place the two delivery tiers meet.
 *
 * RTC tier: audience at ultra-low latency (`level: 2`), subscribing on `user-published`.
 * CDN tier: `hls.js` against the session's HLS origin.
 *
 * The handoff never leaves a gap: when the tier flips to `cdn` the HLS element is
 * attached and started *first*, and only once it actually reports playback does the
 * RTC client leave the live channel. The tier never flips back (decision 8).
 *
 * The tier handover is silent by design: the shopper is watching a show, and "we
 * moved you from RTC to a CDN" is a fact about our plumbing, not about the show.
 *
 * Shared-clock invariant: a live room is one room. Both file-backed surfaces here —
 * the standby loop and the file-backed HLS ladder — would otherwise play from t=0
 * in every browser, giving each viewer a private clip. `useSyncedPlayhead` derives
 * their playhead from the session clock instead, and neither surface exposes
 * `controls`, because a seek bar hands one viewer a timeline nobody else shares.
 * The RTC tier is genuinely shared already and is left alone.
 */

type LiveClock = { startedAtMs: number; skewMs: number };
export type VideoQuality = 'auto' | 'low' | 'high';

type Props = {
  appId: string | null;
  join: JoinSessionDto | null;
  deliveryTier: 'rtc' | 'cdn';
  hls: HlsOrigin | null;
  /** Hands the remote audio track up so the AI panel can duck the stream. */
  onRemoteAudioTrack?: (track: IRemoteAudioTrack | null) => void;
  /**
   * A file feed to play while the channel has no publisher. The stage labels it
   * `Standby — the host hasn't started yet`, so the room never implies a host is on
   * camera when none is, and it rides `liveClock` so every viewer sees one moment.
   */
  standbyUrl?: string | null;
  /**
   * The room's shared playhead anchor. Null for a session with no start time, which
   * means "leave the element where the source puts it".
   */
  liveClock: LiveClock | null;
  /** Auto adapts to network conditions; low and high pin a simulcast/HLS rendition. */
  quality?: VideoQuality;
  overlay?: ReactNode;
  /** Blurs media until the viewer acknowledges the recording notice. */
  blurred?: boolean;
  /**
   * `aspect` (default) is a standalone 16:9 card. `fill` makes the stage take the
   * height it is given, so a theater can size the box from the stream itself.
   */
  fit?: 'aspect' | 'fill';
  /** How media fits the theatre. Live rooms use `contain`, standalone cards use `cover`. */
  contentFit?: 'cover' | 'contain';
  /**
   * The frame's true aspect ratio, reported once per publisher. The room sizes its
   * stage box from it, which is what removes the letterbox bars entirely.
   */
  onStreamAspect?: (ratio: number) => void;
  className?: string;
};

type StageState = 'idle' | 'connecting' | 'waiting-for-host' | 'playing' | 'error';

const STATE_LABEL: Record<StageState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  'waiting-for-host': "Standby — the host hasn't started yet",
  playing: 'Live',
  error: 'Stream unavailable',
};

/** Agora volumes are 0-100; the AI panel ducks to a low value while it speaks. */
const FULL_VOLUME = 100;

/**
 * Signed distance from the shared position, measured the short way round a looping
 * asset: a viewer one second before the loop point is a second *behind* a position
 * just past it, not a whole loop ahead of it, and deserves a nudge rather than a
 * full-length seek backwards.
 */
const shortestDrift = (position: number, target: number, durationSeconds: number): number => {
  const raw = position - target;
  const half = durationSeconds / 2;
  if (raw > half) return raw - durationSeconds;
  if (raw < -half) return raw + durationSeconds;
  return raw;
};

/**
 * Pins one `<video>` to the room's shared clock.
 *
 * Anchors on metadata (duration is required to resolve a looping position), then
 * re-checks every `LIVE_SYNC_INTERVAL_MS`. Large drift earns a hard seek; small drift
 * earns a playback-rate nudge, which is invisible where a seek is a visible jolt.
 *
 * A hidden tab is the one case the interval cannot cover: browsers throttle timers in
 * background tabs to roughly once a minute and slow media decoding with them, so a
 * room left in another tab comes back arbitrarily far behind and would stay there for
 * up to a throttled tick. Becoming visible therefore re-anchors immediately — when a
 * viewer looks at the room, they are at the live edge, not wherever their tab dozed
 * off to. Measured drift in a backgrounded tab reached several seconds without this.
 *
 * `syncedPosition` returning null means the source is genuinely live (non-finite
 * duration) — it is already at its own live edge and must not be touched.
 *
 * `source` identifies the media currently attached: a new source is a new element or
 * a new asset, and either way the playhead has to be anchored again.
 */
const useSyncedPlayhead = (
  videoRef: RefObject<HTMLVideoElement>,
  { clock, enabled, source }: { clock: LiveClock | null; enabled: boolean; source: string | null },
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
        video.playbackRate = drift > 0 ? 1 - LIVE_SYNC_NUDGE_RATE : 1 + LIVE_SYNC_NUDGE_RATE;
        return;
      }
      video.playbackRate = 1;
    };

    video.addEventListener('loadedmetadata', anchor);
    // Metadata can already have arrived before this effect ran, and the event will
    // not fire again for it.
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) anchor();
    // A resume must not wait for the next tick, and it is a re-anchor rather than a
    // drift correction: after throttling the gap is routinely past the seek threshold.
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

/**
 * Reports the frame's true aspect ratio, once per publisher.
 *
 * The stage box is sized from this number, so reporting the same source twice would
 * resize the room under the shopper for nothing: the guard is by source key, not by
 * time. `resize` is listened for alongside `loadedmetadata` because a phone-hosted
 * publisher can rotate mid-show — new intrinsic size, no reload — and because Agora
 * mounts its own `<video>` element that React never renders and cannot ref.
 */
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

    // Metadata is routinely already in when this runs, and the event will not fire
    // again for it.
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
  const rtcContainerRef = useRef<HTMLDivElement>(null);
  const videoElementRef = useRef<HTMLVideoElement>(null);
  const standbyVideoRef = useRef<HTMLVideoElement>(null);
  const audioTrackRef = useRef<IRemoteAudioTrack | null>(null);
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
  /** Flipped only once HLS is genuinely playing, which is what releases RTC. */
  const [cdnPlaying, setCdnPlaying] = useState(false);
  /**
   * Sound is off until the viewer asks for it, on EVERY tier — not just the file
   * feed, where muting used to be a mere autoplay concession. Entering a room is not
   * consent to be spoken at, browsers refuse unmuted autoplay anyway, and a shopper
   * with several tabs open needs the room they chose to be the one making noise.
   * One switch covers RTC, the standby loop and the CDN tier, because to a viewer
   * there is only ever one thing playing.
   */
  const [audioEnabled, setAudioEnabled] = useState(false);
  /**
   * The RTC subscribe handler is registered once per join, so it must read the
   * viewer's current choice rather than the value captured when it was created.
   */
  const audioEnabledRef = useRef(audioEnabled);
  audioEnabledRef.current = audioEnabled;

  // Applies the choice to a track that was already subscribed before it was made.
  useEffect(() => {
    const track = audioTrackRef.current;
    if (!track) return;
    track.setVolume(audioEnabled ? FULL_VOLUME : 0);
    audioCallbackRef.current?.(audioEnabled ? track : null);
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

    let client: IAgoraRTCClient | null = null;
    let cancelled = false;

    void (async () => {
      setRtcState('connecting');
      try {
        const rtc = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
        rtcClientRef.current = rtc;
        client = rtc;

        // Registered before joining so a host that is already publishing is not missed.
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
              if (mediaType === 'video' && rtcContainerRef.current) {
                const container = rtcContainerRef.current;
                user.videoTrack?.play(container, { fit: contentFit });
                setRtcState('playing');
                /*
                 * Agora mounts its own element inside the container, sometimes a tick
                 * after `play` resolves, and that element is the only thing that knows
                 * the publisher's real frame size. One immediate read plus one on the
                 * next frame covers both orderings; the hook itself is idempotent.
                 */
                const captureAspect = (): void =>
                  watchAspect(
                    `rtc-${user.uid}`,
                    container.querySelector<HTMLVideoElement>('video'),
                  );
                captureAspect();
                requestAnimationFrame(captureAspect);
              }
              if (mediaType === 'audio' && user.audioTrack) {
                const track = user.audioTrack;
                // Played once and held at zero volume: the element has to be running
                // for unmuting later to be instant rather than a fresh subscribe.
                track.play();
                track.setVolume(audioEnabledRef.current ? FULL_VOLUME : 0);
                audioTrackRef.current = track;
                // Handed up only while audible: the AI panel ducks this track, and
                // restoring its volume after a duck must never override a mute.
                audioCallbackRef.current?.(audioEnabledRef.current ? track : null);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'subscribe_failed');
            }
          })();
        });

        rtc.on('user-unpublished', (_user, mediaType) => {
          if (mediaType === 'audio') {
            audioTrackRef.current = null;
            audioCallbackRef.current?.(null);
          }
          if (mediaType === 'video') setRtcState('waiting-for-host');
        });

        await rtc.setClientRole('audience', { level: 2 });
        await rtc.setRemoteDefaultVideoStreamType(
          qualityRef.current === 'low' ? RemoteStreamType.LOW_STREAM : RemoteStreamType.HIGH_STREAM,
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
      audioTrackRef.current = null;
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
      instance = new Hls({ enableWorker: true, lowLatencyMode: true, capLevelToPlayerSize: true });
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
      // Safari plays HLS natively; hls.js would only get in the way.
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
  /**
   * The channel is joined but nobody is publishing: play the file feed rather than a
   * black rectangle. A real publisher takes the stage back the moment it arrives,
   * because `rtcState` flips to `playing` and this unmounts.
   */
  const standbyActive =
    standbyUrl !== null && deliveryTier === 'rtc' && rtcState === 'waiting-for-host';

  // Both file-backed surfaces ride the session clock; the RTC container has no
  // element to seek and needs none.
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
      className={`relative overflow-hidden bg-black ${
        fit === 'fill' ? 'h-full' : 'rounded-panel border border-line'
      } ${className ?? ''}`}
    >
      {/*
       * `fill` takes the theatre height. `contentFit` chooses Twitch-style contain for
       * the viewing room or edge-to-edge cover for standalone media cards.
       */}
      <div
        className={`relative w-full ${fit === 'fill' ? 'h-full' : 'aspect-video'} ${
          blurred ? 'blur-2xl' : ''
        }`}
      >
        {/* Both players stay mounted through the handoff; RTC leaves only after HLS plays. */}
        <div
          ref={rtcContainerRef}
          className={`absolute inset-0 h-full w-full ${deliveryTier === 'cdn' && cdnPlaying ? 'hidden' : ''}`}
        />
        <video
          ref={videoElementRef}
          playsInline
          // A live surface is never scrubbable: a seek bar would let one viewer leave
          // the shared room clock behind.
          controls={false}
          muted={handingOver || !audioEnabled}
          onLoadedMetadata={(e) => watchAspect(`cdn-${hls?.url ?? ''}`, e.currentTarget)}
          className={`absolute inset-0 h-full w-full bg-black ${
            contentFit === 'contain' ? 'object-contain' : 'object-cover'
          } ${deliveryTier === 'cdn' && cdnPlaying ? '' : 'pointer-events-none opacity-0'}`}
        />
        {standbyActive && (
          <video
            key={standbyUrl}
            ref={standbyVideoRef}
            src={standbyUrl}
            autoPlay
            // Looping plus the modulo in `syncedPosition` is what keeps a short
            // fixture consistent across viewers however long the session runs.
            loop
            playsInline
            muted={!audioEnabled}
            onLoadedMetadata={(e) => watchAspect(`standby-${standbyUrl ?? ''}`, e.currentTarget)}
            className={`absolute inset-0 h-full w-full bg-black ${
              contentFit === 'contain' ? 'object-contain' : 'object-cover'
            }`}
          />
        )}
      </div>

      {/*
       * No scrim here: the room owns the top and bottom bands (`.scrim-top` /
       * `.scrim-bottom`) because that is where its title, poll, captions and controls
       * live, and two stacked scrims read as a dirty lens rather than a gradient.
       * These two chips carry their own `--chip` background instead.
       */}
      {(handingOver || standbyActive) && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-end p-3">
          <span className="on-video pill text-14">
            {handingOver ? 'Connecting' : STATE_LABEL['waiting-for-host']}
          </span>
        </div>
      )}

      {/*
       * One control for the whole stage. It is shown whenever there is something to
       * hear on any tier, so the answer to "why is this silent?" is always on screen
       * next to its fix, and it reads as the room's sound rather than one player's.
       */}
      {(standbyActive || activeState === 'playing') && (
        <button
          type="button"
          aria-label={audioEnabled ? 'Mute this live session' : 'Unmute this live session'}
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

      {/* Frame-shaped, not a spinner: the room already knows what shape it will be. */}
      {activeState !== 'playing' && !standbyActive && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-center">
          {activeState !== 'error' && (
            <span aria-hidden className="skeleton absolute inset-0 rounded-none" />
          )}
          <p className="relative text-14 font-medium text-t2">{STATE_LABEL[activeState]}</p>
          {error !== null && activeState === 'error' && (
            <p className="relative max-w-sm text-13 text-danger">{error}</p>
          )}
        </div>
      )}

      {overlay}
    </div>
  );
};
