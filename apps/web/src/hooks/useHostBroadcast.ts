import { useCallback, useEffect, useRef, useState } from 'react';
import AgoraRTC, {
  type ConnectionState,
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ILocalAudioTrack,
  type ILocalVideoTrack,
  type IRemoteAudioTrack,
  type IRemoteVideoTrack,
} from 'agora-rtc-sdk-ng';

import { liveChannelForSlug, type SessionStatus } from '@shop/shared';

import { api } from '../lib/api';
import type { CaptionLine } from './useLiveSession';
import { parseAgoraRttCaption, type AgoraRttCaptionSegment } from './agoraRttCaption';
import { useHostRecorder, type UseHostRecorderResult } from './useHostRecorder';
import type { ObsIngestDto } from '../components/host/ObsIngestPanel';

/**
 * The host's publish path.
 *
 * Preview first (so nobody goes live into a black frame), then `POST /start` — which
 * is where the server freezes the chat shard count and starts recording, RTT and
 * Media Push — then `setClientRole('host')` and publish. Browser recording runs over
 * the *same* tracks that are published, so the replay is what viewers actually saw.
 *
 * Captions: Agora's Real-Time STT publishes into the RTC channel as stream messages
 * (gzip'd JSON when `enableJsonProtocol:true`), which only an RTC peer can receive.
 * The host inflates them, renders them locally, and forwards coalesced interim updates
 * within 150 ms. The server republishes every update over SSE for both viewer tiers
 * and persists only finalized segments for replay.
 *
 * Transport life-cycle, which the control room renders as designed states rather
 * than as errors: `connectionState` is published verbatim, a lapsing publishing pass
 * is renewed silently (only a failed renewal is surfaced, as `tokenNotice`), `rejoin`
 * repairs a dropped transport without ending the show, and `publishVideo(false)`
 * drops to audio only so a bad uplink costs the picture instead of the room. The
 * client itself is exposed so `useStreamHealth` samples this uplink rather than
 * opening a second one beside it.
 */

/**
 * Two publish sources, both first-class:
 *
 *   `camera` — microphone + webcam, the real broadcaster path.
 *   `file`   — a video file played into `<video>.captureStream()` and published as
 *              custom RTC tracks. Same channel, same tokens, same publish call, same
 *              browser recording, so a demo needs no camera and viewers still receive
 *              genuine RTC media.
 *
 * The source can only change while not live: swapping tracks mid-broadcast would
 * renegotiate the publish on every viewer, which is not what this switch is for.
 */
export type BroadcastSource = 'camera' | 'file' | 'obs';

/**
 * What pre-flight decided, handed to the broadcast room.
 *
 * It lives in `sessionStorage` rather than on the server because none of it is a fact
 * about the show — it is a fact about *this device and this attempt*: which camera,
 * whether the seller acknowledged recording, and whether they were late enough to
 * skip the checks. A refresh keeps it; a new tab correctly starts over.
 */
export type PreflightHandoff = {
  /** Recording was acknowledged on pre-flight, so the room needs no consent gate. */
  consent: boolean;
  /** Pre-flight's "Hold to go live" completed: the room publishes without a second gesture. */
  autoGoLive: boolean;
  /** The checks were skipped, so the room shows the health ribbon expanded at first. */
  skipped: boolean;
  source: BroadcastSource | null;
  cameraId: string | null;
  microphoneId: string | null;
};

export const EMPTY_HANDOFF: PreflightHandoff = {
  consent: false,
  autoGoLive: false,
  skipped: false,
  source: null,
  cameraId: null,
  microphoneId: null,
};

export const readPreflightHandoff = (slug: string | undefined): PreflightHandoff => {
  if (slug === undefined) return EMPTY_HANDOFF;
  try {
    const raw = window.sessionStorage.getItem(`broadcast-preflight:${slug}`);
    if (raw === null) return EMPTY_HANDOFF;
    return { ...EMPTY_HANDOFF, ...(JSON.parse(raw) as Partial<PreflightHandoff>) };
  } catch {
    // A malformed or unavailable store means pre-flight simply did not happen.
    return EMPTY_HANDOFF;
  }
};

export const writePreflightHandoff = (
  slug: string | undefined,
  handoff: PreflightHandoff,
): void => {
  if (slug === undefined) return;
  try {
    window.sessionStorage.setItem(`broadcast-preflight:${slug}`, JSON.stringify(handoff));
  } catch {
    // Private-mode storage refusals cost the handoff, not the show.
  }
};

/**
 * `HTMLMediaElement.captureStream()` ships in Chromium and Safari 16+ but is still
 * missing from `lib.dom`, and Firefox only has the `moz` prefix. Absent both, the file
 * source refuses out loud instead of publishing a black frame.
 */
type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

export type BroadcastState =
  'idle' | 'preview' | 'starting' | 'live' | 'ending' | 'ended' | 'error';

type TranscriptLineInput = {
  captionId: string;
  text: string;
  language: string;
  startMs: number;
  speaker: string;
  finalized: boolean;
};

/** Coalesces rapid mutable STT updates without adding perceptible caption latency. */
const CAPTION_FORWARD_MS = 150;
const MAX_CAPTIONS = 40;

/**
 * A second publisher in the channel — the co-host the owner invited. Video playback is
 * deliberately left to the consumer: the console owns the layout, so it decides which
 * container each uid renders into. Audio is played here, because a co-host nobody can
 * hear is a bug in every layout.
 */
export type RemotePublisher = {
  /** Stringified RTC uid: React keys and container lookups need a string. */
  uid: string;
  videoTrack: IRemoteVideoTrack | null;
  audioTrack: IRemoteAudioTrack | null;
};

export type UseHostBroadcastResult = {
  state: BroadcastState;
  error: string | null;
  captions: CaptionLine[];
  /** Set when captions arrive in a format this client cannot decode. */
  captionFormatNotice: string | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  /** Which media the console will publish, and whether it can still be changed. */
  source: BroadcastSource;
  setSource: (next: BroadcastSource) => Promise<void>;
  recorder: UseHostRecorderResult;
  startPreview: (element: HTMLElement) => Promise<void>;
  goLive: () => Promise<void>;
  endSession: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  /**
   * The publishing client itself, so telemetry (`useStreamHealth`) samples the uplink
   * that is actually carrying the show instead of opening a second one beside it.
   */
  client: IAgoraRTCClient | null;
  /**
   * The transport's own state, first-class rather than folded into `error`: a room
   * that is reconnecting is still live, and the console has a designed state for it.
   */
  connectionState: ConnectionState;
  /** Set only when refreshing this room's publishing permission failed. */
  tokenNotice: string | null;
  /** False after the host drops to audio only. The mic keeps publishing. */
  videoPublished: boolean;
  publishVideo: (next: boolean) => Promise<void>;
  /** Re-mints, re-joins and re-publishes after the transport dropped for good. */
  rejoin: () => Promise<void>;
  /**
   * Width / height of the source being published, read from the track. The monitor
   * sizes itself from this so a 9:16 phone camera gets no letterbox.
   */
  frameAspect: number | null;
  /** Co-host publishers in the channel, for the console to render beside the preview. */
  remotePublishers: RemotePublisher[];
  /** Media Gateway RTMP credentials, set after go-live in OBS mode. */
  obsIngest: ObsIngestDto | null;
  /** True once the OBS publisher uid is rendering video in the monitor. */
  obsFeedConnected: boolean;
};

export const useHostBroadcast = (opts: {
  appId: string | null;
  slug: string | undefined;
  sessionId: string | null;
  /**
   * The session's server-side status. A session created with `startNow`, or one a
   * premiere flipped live on schedule, is already past `scheduled -> live`, so the
   * console must publish into it without re-running that transition.
   */
  sessionStatus: SessionStatus | null;
  /** Epoch ms of `startedAt`, so caption `startMs` is relative to the session. */
  startedAtMs: number | null;
  /** The file the `file` source publishes. Without it only the camera is offered. */
  fileUrl?: string | null;
  /**
   * The devices pre-flight settled on. Omitted, the browser's defaults are used —
   * which is also what happens when a seller walks straight into the room.
   */
  cameraId?: string | null;
  microphoneId?: string | null;
  onEnded?: () => void;
}): UseHostBroadcastResult => {
  const {
    appId,
    slug,
    sessionId,
    sessionStatus,
    startedAtMs,
    fileUrl = null,
    cameraId = null,
    microphoneId = null,
    onEnded,
  } = opts;

  const [state, setState] = useState<BroadcastState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captions, setCaptions] = useState<CaptionLine[]>([]);
  const [captionFormatNotice, setCaptionFormatNotice] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [source, setSourceState] = useState<BroadcastSource>('camera');
  const [remotePublishers, setRemotePublishers] = useState<RemotePublisher[]>([]);
  const [obsIngest, setObsIngest] = useState<ObsIngestDto | null>(null);
  const [obsFeedConnected, setObsFeedConnected] = useState(false);
  const [client, setClient] = useState<IAgoraRTCClient | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [tokenNotice, setTokenNotice] = useState<string | null>(null);
  const [videoPublished, setVideoPublished] = useState(false);
  const [frameAspect, setFrameAspect] = useState<number | null>(null);

  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const micRef = useRef<ILocalAudioTrack | null>(null);
  const cameraRef = useRef<ILocalVideoTrack | null>(null);
  /** The `<video>` the file source decodes into, kept out of the document. */
  const fileElementRef = useRef<CapturableVideo | null>(null);
  /** The preview container, so switching source re-renders into the same box. */
  const previewElementRef = useRef<HTMLElement | null>(null);
  /**
   * The uid this console joined with. A renewed pass has to be minted for the same
   * channel and uid or it is a pass for somebody else.
   */
  const uidRef = useRef<number | null>(null);
  const pendingLinesRef = useRef<Map<string, TranscriptLineInput>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(startedAtMs);
  startedAtRef.current = startedAtMs;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /**
   * Mirrors `remotePublishers` so the unmount cleanup — which must not re-run on every
   * subscription change — can still stop the audio it started.
   */
  const remotePublishersRef = useRef<RemotePublisher[]>([]);
  remotePublishersRef.current = remotePublishers;
  /** The Media Gateway publisher uid we are waiting to monitor in OBS mode. */
  const obsGatewayUidRef = useRef<string | null>(null);
  const sourceRef = useRef<BroadcastSource>(source);
  sourceRef.current = source;

  const recorder = useHostRecorder({ sessionId });
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const flushCaptions = useCallback(async (): Promise<void> => {
    const id = sessionIdRef.current;
    if (pendingLinesRef.current.size === 0 || !id) return;
    const lines = [...pendingLinesRef.current.values()];
    pendingLinesRef.current.clear();
    try {
      await api.post(`/api/sessions/${id}/transcript`, { lines });
    } catch {
      // Caption transport is best-effort: a failed update must not stop the broadcast.
    }
  }, []);

  const ingestCaption = useCallback(
    (segment: AgoraRttCaptionSegment) => {
      const startMs = Math.max(
        0,
        segment.absoluteMs - (startedAtRef.current ?? segment.absoluteMs),
      );

      const line: CaptionLine = {
        id: segment.id,
        text: segment.text,
        language: segment.language,
        startMs,
        speaker: 'host',
      };
      setCaptions((current) => {
        const index = current.findIndex((caption) => caption.id === line.id);
        if (index < 0) return [...current, line].slice(-MAX_CAPTIONS);
        const next = current.slice();
        next[index] = line;
        return next;
      });

      pendingLinesRef.current.set(segment.id, {
        captionId: segment.id,
        text: segment.text,
        language: segment.language,
        startMs,
        speaker: 'host',
        finalized: segment.finalized,
      });
      if (flushTimerRef.current === null) {
        flushTimerRef.current = window.setTimeout(() => {
          flushTimerRef.current = null;
          void flushCaptions();
        }, CAPTION_FORWARD_MS);
      }
    },
    [flushCaptions],
  );

  const handleStreamMessage = useCallback(
    (payload: Uint8Array) => {
      void (async () => {
        try {
          const segments = await parseAgoraRttCaption(payload);
          for (const segment of segments) ingestCaption(segment);
        } catch {
          setCaptionFormatNotice(
            'Captions are arriving in a binary protocol this client cannot decode — the transcription task was not started with the JSON protocol.',
          );
        }
      })();
    },
    [ingestCaption],
  );

  /** Releases whatever is currently captured, so a source switch leaves nothing running. */
  const releaseTracks = useCallback((): void => {
    micRef.current?.stop();
    micRef.current?.close();
    cameraRef.current?.stop();
    cameraRef.current?.close();
    micRef.current = null;
    cameraRef.current = null;
    const file = fileElementRef.current;
    fileElementRef.current = null;
    if (file) {
      file.pause();
      file.removeAttribute('src');
      file.load();
    }
  }, []);

  /**
   * Drops every co-host subscription. Remote audio is playing through this client, so
   * it has to be stopped explicitly — leaving the channel alone would let a co-host's
   * voice outlive the console.
   */
  const releaseRemotes = useCallback((): void => {
    for (const publisher of remotePublishersRef.current) publisher.audioTrack?.stop();
    remotePublishersRef.current = [];
    setRemotePublishers([]);
  }, []);

  /**
   * The published frame's own aspect ratio, straight off the track settings. The
   * monitor is sized from this instead of the layout, so nothing is letterboxed and
   * `fit: 'cover'` becomes lossless — the box already matches the frame.
   */
  const readAspect = useCallback((width: number, height: number): void => {
    if (width > 0 && height > 0) setFrameAspect(width / height);
  }, []);

  /**
   * Captures the current source into a publishable pair. The file branch decodes into
   * an off-document `<video>` and publishes its `captureStream()` tracks, so the RTC
   * publish path, the recorder and the viewer subscription are identical either way.
   */
  const captureTracks = useCallback(
    async (kind: BroadcastSource): Promise<void> => {
      if (kind === 'obs') return;

      if (kind === 'camera') {
        const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks(
          microphoneId === null ? {} : { microphoneId },
          cameraId === null ? {} : { cameraId },
        );
        micRef.current = mic;
        cameraRef.current = camera;
        const settings = camera.getMediaStreamTrack().getSettings();
        readAspect(settings.width ?? 0, settings.height ?? 0);
        return;
      }

      if (!fileUrl) throw new Error('No file feed is configured for this deployment.');

      const element = document.createElement('video') as CapturableVideo;
      element.src = fileUrl;
      element.loop = true;
      element.playsInline = true;
      // Local playback stays silent; `captureStream` still carries the decoded audio.
      element.muted = true;
      element.crossOrigin = 'anonymous';
      fileElementRef.current = element;

      await element.play();

      const capture = element.captureStream ?? element.mozCaptureStream;
      if (capture === undefined) {
        throw new Error(
          'This browser cannot capture a video element — publish the camera instead.',
        );
      }
      const stream = capture.call(element);
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];
      if (videoTrack === undefined) throw new Error('The file feed produced no video track.');

      cameraRef.current = AgoraRTC.createCustomVideoTrack({
        mediaStreamTrack: videoTrack,
        width: element.videoWidth || 1280,
        height: element.videoHeight || 720,
        frameRate: 30,
      });
      readAspect(element.videoWidth || 1280, element.videoHeight || 720);
      // A file without an audio stream is publishable; the room simply has no host audio.
      micRef.current =
        audioTrack === undefined
          ? null
          : AgoraRTC.createCustomAudioTrack({ mediaStreamTrack: audioTrack });
    },
    [fileUrl, readAspect, cameraId, microphoneId],
  );

  const startPreview = useCallback(
    async (element: HTMLElement): Promise<void> => {
      previewElementRef.current = element;
      try {
        if (source === 'obs') {
          setState((current) => (current === 'live' ? current : 'preview'));
          setError(null);
          return;
        }
        if (!cameraRef.current) await captureTracks(source);
        cameraRef.current?.play(element, { fit: 'cover' });
        setState((current) => (current === 'live' ? current : 'preview'));
        setError(null);
      } catch (err) {
        setState('error');
        setError(
          err instanceof Error
            ? source === 'file'
              ? `File feed unavailable: ${err.message}`
              : `Camera or microphone unavailable: ${err.message}`
            : 'devices_unavailable',
        );
      }
    },
    [captureTracks, source],
  );

  const setSource = useCallback(
    async (next: BroadcastSource): Promise<void> => {
      if (next === source) return;
      if (state === 'live' || state === 'starting' || state === 'ending') {
        setError('End the session before changing the publish source.');
        return;
      }
      releaseTracks();
      setSourceState(next);
      setMicEnabled(true);
      setCameraEnabled(true);
      setError(null);
      setObsIngest(null);
      setObsFeedConnected(false);
      obsGatewayUidRef.current = null;
      setState('idle');

      const element = previewElementRef.current;
      if (element === null) return;
      if (next === 'obs') {
        setState('preview');
        return;
      }
      try {
        await captureTracks(next);
        cameraRef.current?.play(element, { fit: 'cover' });
        setState('preview');
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'source_switch_failed');
      }
    },
    [captureTracks, releaseTracks, source, state],
  );

  /**
   * Co-host subscription, registered before `join`: a publisher already in the channel
   * fires `user-published` during the join handshake, so a listener attached afterwards
   * never hears about them.
   */
  const attachRemoteHandlers = useCallback(
    (target: IAgoraRTCClient): void => {
      const merge = (uid: string, patch: Partial<RemotePublisher>): void => {
        setRemotePublishers((current) => {
          const index = current.findIndex((publisher) => publisher.uid === uid);
          if (index < 0) return [...current, { uid, videoTrack: null, audioTrack: null, ...patch }];
          const next = [...current];
          next[index] = { ...current[index]!, ...patch };
          return next;
        });
      };

      const forget = (uid: string): void => {
        remotePublishersRef.current.find((publisher) => publisher.uid === uid)?.audioTrack?.stop();
        setRemotePublishers((current) => current.filter((publisher) => publisher.uid !== uid));
      };

      target.on('user-published', (remote: IAgoraRTCRemoteUser, mediaType) => {
        void (async () => {
          try {
            const remoteUid = String(remote.uid);
            const isObsFeed = sourceRef.current === 'obs' && remoteUid === obsGatewayUidRef.current;

            await target.subscribe(remote, mediaType);

            if (isObsFeed && mediaType === 'video' && remote.videoTrack) {
              const element = previewElementRef.current;
              if (element) remote.videoTrack.play(element, { fit: 'cover' });
              const settings = remote.videoTrack.getMediaStreamTrack().getSettings();
              readAspect(settings.width ?? 1280, settings.height ?? 720);
              setObsFeedConnected(true);
              setVideoPublished(true);
              return;
            }
            if (isObsFeed && mediaType === 'audio') {
              remote.audioTrack?.play();
              return;
            }

            if (mediaType === 'audio') {
              // Audio has no layout, so it plays here; video is handed to the console.
              remote.audioTrack?.play();
              merge(String(remote.uid), { audioTrack: remote.audioTrack ?? null });
              return;
            }
            merge(String(remote.uid), { videoTrack: remote.videoTrack ?? null });
          } catch (err) {
            setError(err instanceof Error ? err.message : 'cohost_subscribe_failed');
          }
        })();
      });

      target.on('user-unpublished', (remote: IAgoraRTCRemoteUser, mediaType) => {
        const uid = String(remote.uid);
        if (mediaType === 'audio') {
          remotePublishersRef.current
            .find((publisher) => publisher.uid === uid)
            ?.audioTrack?.stop();
        }
        setRemotePublishers((current) =>
          current.flatMap((publisher) => {
            if (publisher.uid !== uid) return [publisher];
            const next: RemotePublisher =
              mediaType === 'audio'
                ? { ...publisher, audioTrack: null }
                : { ...publisher, videoTrack: null };
            // Neither track left: drop the tile instead of leaving an empty black box.
            return next.audioTrack === null && next.videoTrack === null ? [] : [next];
          }),
        );
      });

      target.on('user-left', (remote: IAgoraRTCRemoteUser) => forget(String(remote.uid)));
    },
    [readAspect],
  );

  /**
   * A publishing pass for this room, minted server-side. The uid is pinned on the
   * first mint so a renewal renews this publisher rather than adding a second one.
   */
  const mintPass = useCallback(
    async (channel: string): Promise<{ uid: number; rtcToken: string }> => {
      const minted = await api.post<{
        channel: string;
        uid: number;
        role: string;
        rtcToken: string;
      }>('/api/rtc/token', {
        channel,
        role: 'host',
        ...(uidRef.current === null ? {} : { uid: uidRef.current }),
      });
      // The server downgrades a non-host to a subscriber pass rather than refusing,
      // so publishing would fail later with a far less obvious error.
      if (minted.role !== 'host' && minted.role !== 'publisher') {
        throw new Error('You are not authorized to publish in this session.');
      }
      uidRef.current = minted.uid;
      return { uid: minted.uid, rtcToken: minted.rtcToken };
    },
    [],
  );

  const mintMonitorPass = useCallback(
    async (channel: string): Promise<{ uid: number; rtcToken: string }> => {
      const minted = await api.post<{
        channel: string;
        uid: number;
        role: string;
        rtcToken: string;
      }>('/api/rtc/token', {
        channel,
        role: 'audience',
        ...(uidRef.current === null ? {} : { uid: uidRef.current }),
      });
      uidRef.current = minted.uid;
      return { uid: minted.uid, rtcToken: minted.rtcToken };
    },
    [],
  );

  /**
   * A publishing pass has a TTL and the SDK warns 30 seconds before it lapses. Until
   * now nothing listened, so a long show simply stopped being delivered. Renewal is
   * silent on purpose — the host is on camera and has nothing to do about it — and
   * only a failed renewal is ever surfaced.
   */
  const renewPass = useCallback(async (): Promise<void> => {
    const active = clientRef.current;
    if (!active || !slug) return;
    try {
      const channel = liveChannelForSlug(slug);
      const { rtcToken } =
        sourceRef.current === 'obs' ? await mintMonitorPass(channel) : await mintPass(channel);
      await active.renewToken(rtcToken);
      setTokenNotice(null);
    } catch {
      setTokenNotice(
        'This room’s publishing permission could not be renewed. If the picture stops, end the show and start it again.',
      );
    }
  }, [mintPass, mintMonitorPass, slug]);

  /**
   * Transport state is not an error. A reconnecting room is still live, still has
   * chat, and has a designed state of its own; folding it into `error` is what made a
   * two-second blip look like a crash.
   */
  const attachConnectionHandlers = useCallback(
    (target: IAgoraRTCClient): void => {
      target.on('connection-state-change', (current) => setConnectionState(current));
      target.on('token-privilege-will-expire', () => void renewPass());
      target.on('token-privilege-did-expire', () => void renewPass());
    },
    [renewPass],
  );

  /** Mint, join, publish. Shared by the first go-live and by every repair after it. */
  const joinAndPublish = useCallback(
    async (channel: string): Promise<void> => {
      if (!appId) throw new Error('This deployment has no live video configured.');
      const camera = cameraRef.current;
      const mic = micRef.current;
      if (!camera) throw new Error('Start the preview before publishing.');

      const { uid, rtcToken } = await mintPass(channel);
      const target = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      clientRef.current = target;
      // Real-Time STT captions arrive here, and nowhere else.
      target.on('stream-message', (_uid, payload: Uint8Array) => handleStreamMessage(payload));
      attachRemoteHandlers(target);
      attachConnectionHandlers(target);
      await target.setClientRole('host');
      await target.join(appId, channel, rtcToken, uid);
      // Publish a low-bitrate simulcast so viewers on constrained networks can choose
      // Data saver without leaving the live room.
      await target.enableDualStream();
      await target.publish(mic === null ? [camera] : [mic, camera]);

      setClient(target);
      setConnectionState(target.connectionState);
      setVideoPublished(true);
      setTokenNotice(null);
    },
    [appId, mintPass, handleStreamMessage, attachRemoteHandlers, attachConnectionHandlers],
  );

  const joinAsMonitor = useCallback(
    async (channel: string, gatewayUid: number): Promise<void> => {
      if (!appId) throw new Error('This deployment has no live video configured.');

      obsGatewayUidRef.current = String(gatewayUid);
      const { uid, rtcToken } = await mintMonitorPass(channel);
      const target = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
      clientRef.current = target;
      target.on('stream-message', (_uid, payload: Uint8Array) => handleStreamMessage(payload));
      attachRemoteHandlers(target);
      attachConnectionHandlers(target);
      await target.setClientRole('audience');
      await target.join(appId, channel, rtcToken, uid);

      setClient(target);
      setConnectionState(target.connectionState);
      setTokenNotice(null);
    },
    [appId, mintMonitorPass, handleStreamMessage, attachRemoteHandlers, attachConnectionHandlers],
  );

  const goLive = useCallback(async (): Promise<void> => {
    if (!appId || !slug || !sessionId) return;

    if (source === 'obs') {
      setState('starting');
      setError(null);
      try {
        if (sessionStatus === 'scheduled') await api.post(`/api/sessions/${sessionId}/start`);
        const ingest = await api.post<ObsIngestDto>(`/api/sessions/${sessionId}/obs-ingest`);
        setObsIngest(ingest);
        await joinAsMonitor(liveChannelForSlug(slug), ingest.uid);
        await recorderRef.current.reportUnsupported();
        setState('live');
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'go_live_failed');
      }
      return;
    }

    const mic = micRef.current;
    const camera = cameraRef.current;
    // A file feed without an audio stream still publishes; a missing video track means
    // nothing was captured yet.
    if (!camera) {
      setError('Start the preview before going live.');
      return;
    }

    setState('starting');
    setError(null);
    try {
      // Server transition first: it is what freezes the chat fan-out and starts the
      // recording / transcription / Media Push side services. Only `scheduled`
      // sessions need it — the CAS has already happened for anything else.
      if (sessionStatus === 'scheduled') await api.post(`/api/sessions/${sessionId}/start`);

      await joinAndPublish(liveChannelForSlug(slug));

      const recording = recorderRef.current;
      if (recording.supported) {
        const tracks = [camera.getMediaStreamTrack()];
        if (mic !== null) tracks.push(mic.getMediaStreamTrack());
        recording.start(new MediaStream(tracks));
      } else {
        await recording.reportUnsupported();
      }

      setState('live');
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'go_live_failed');
    }
  }, [appId, slug, sessionId, sessionStatus, source, joinAndPublish, joinAsMonitor]);

  /**
   * The transport dropped for good. Re-mint, re-join, re-publish: the session is
   * still `live` server-side, so this repairs a connection instead of starting a new
   * show. The local recording is untouched — it captures the tracks, not the channel.
   */
  const rejoin = useCallback(async (): Promise<void> => {
    if (!slug) return;
    setError(null);
    const previous = clientRef.current;
    clientRef.current = null;
    setClient(null);
    if (previous) {
      previous.removeAllListeners();
      await previous.leave().catch(() => undefined);
    }
    releaseRemotes();
    try {
      if (sourceRef.current === 'obs' && obsIngest !== null) {
        await joinAsMonitor(liveChannelForSlug(slug), obsIngest.uid);
      } else {
        await joinAndPublish(liveChannelForSlug(slug));
      }
      setState('live');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'rejoin_failed');
    }
  }, [slug, joinAndPublish, joinAsMonitor, releaseRemotes, obsIngest]);

  /**
   * Audio only, and back again. Talking through a bad uplink beats a dead room, so
   * the camera is unpublished while the mic keeps going. The track stays captured, so
   * resuming costs one publish call and no second permission prompt.
   */
  const publishVideo = useCallback(async (next: boolean): Promise<void> => {
    const active = clientRef.current;
    const camera = cameraRef.current;
    if (!active || !camera) return;
    try {
      if (next) await active.publish([camera]);
      else await active.unpublish([camera]);
      setVideoPublished(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish_change_failed');
    }
  }, []);

  const endSession = useCallback(async (): Promise<void> => {
    if (!sessionId) return;
    setState('ending');
    try {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      await flushCaptions();
      await recorderRef.current.stopAndUpload();
      await api.post(`/api/sessions/${sessionId}/end`);

      const active = clientRef.current;
      clientRef.current = null;
      setClient(null);
      setConnectionState('DISCONNECTED');
      setVideoPublished(false);
      if (active) {
        active.removeAllListeners();
        await active.unpublish().catch(() => undefined);
        await active.leave().catch(() => undefined);
      }
      releaseTracks();
      releaseRemotes();
      setObsIngest(null);
      setObsFeedConnected(false);
      obsGatewayUidRef.current = null;

      setState('ended');
      onEnded?.();
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'end_session_failed');
    }
  }, [sessionId, flushCaptions, releaseTracks, releaseRemotes, onEnded]);

  const toggleMic = useCallback(async (): Promise<void> => {
    const mic = micRef.current;
    if (!mic) return;
    const next = !mic.enabled;
    await mic.setEnabled(next);
    setMicEnabled(next);
  }, []);

  const toggleCamera = useCallback(async (): Promise<void> => {
    const camera = cameraRef.current;
    if (!camera) return;
    const next = !camera.enabled;
    await camera.setEnabled(next);
    setCameraEnabled(next);
  }, []);

  // Leaving the console must not leave a camera light on, a file decoding, or a
  // channel joined.
  useEffect(
    () => () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current);
      const active = clientRef.current;
      clientRef.current = null;
      if (active) {
        active.removeAllListeners();
        void active.leave().catch(() => undefined);
      }
      releaseTracks();
      releaseRemotes();
    },
    [releaseTracks, releaseRemotes],
  );

  return {
    state,
    error,
    captions,
    captionFormatNotice,
    micEnabled,
    cameraEnabled,
    source,
    setSource,
    recorder,
    startPreview,
    goLive,
    endSession,
    toggleMic,
    toggleCamera,
    client,
    connectionState,
    tokenNotice,
    videoPublished,
    publishVideo,
    rejoin,
    frameAspect,
    remotePublishers,
    obsIngest,
    obsFeedConnected,
  };
};
