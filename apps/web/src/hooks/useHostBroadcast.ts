import type { ObsIngestDto } from '../components/host/ObsIngestPanel';
import type { AgoraRttCaptionSegment } from './agoraRttCaption';
import type { UseHostRecorderResult } from './useHostRecorder';
import type { CaptionLine } from './useLiveSession';
import type { SessionStatus } from '@shop/shared';
import type {
    ConnectionState,
    IAgoraRTCClient,
    IAgoraRTCRemoteUser,
    ILocalAudioTrack,
    ILocalVideoTrack,
    IRemoteAudioTrack,
    IRemoteVideoTrack,
} from 'agora-rtc-sdk-ng';

import AgoraRTC from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';

import { liveChannelForSlug } from '@shop/shared';

import { api } from '../lib/api';
import { parseAgoraRttCaption } from './agoraRttCaption';
import { useHostRecorder } from './useHostRecorder';

export type BroadcastSource = 'camera' | 'file' | 'obs';
export type PreflightHandoff = {
    consent: boolean;
    autoGoLive: boolean;
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
        return {
            ...EMPTY_HANDOFF,
            ...(JSON.parse(raw) as Partial<PreflightHandoff>),
        };
    } catch {
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
    } catch {}
};
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
    translatedText: Record<string, string>;
};
const CAPTION_FORWARD_MS = 150;
const MAX_CAPTIONS = 40;
export type RemotePublisher = {
    uid: string;
    videoTrack: IRemoteVideoTrack | null;
    audioTrack: IRemoteAudioTrack | null;
};
export type UseHostBroadcastResult = {
    state: BroadcastState;
    error: string | null;
    captions: CaptionLine[];
    captionFormatNotice: string | null;
    micEnabled: boolean;
    cameraEnabled: boolean;
    source: BroadcastSource;
    setSource: (next: BroadcastSource) => Promise<void>;
    recorder: UseHostRecorderResult;
    startPreview: (element: HTMLElement) => Promise<void>;
    goLive: () => Promise<void>;
    endSession: () => Promise<void>;
    toggleMic: () => Promise<void>;
    toggleCamera: () => Promise<void>;
    client: IAgoraRTCClient | null;
    connectionState: ConnectionState;
    tokenNotice: string | null;
    videoPublished: boolean;
    publishVideo: (next: boolean) => Promise<void>;
    rejoin: () => Promise<void>;
    frameAspect: number | null;
    remotePublishers: RemotePublisher[];
    obsIngest: ObsIngestDto | null;
    obsFeedConnected: boolean;
};
export const useHostBroadcast = (opts: {
    appId: string | null;
    slug: string | undefined;
    sessionId: string | null;
    sessionStatus: SessionStatus | null;
    startedAtMs: number | null;
    fileUrl?: string | null;
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
    const fileElementRef = useRef<CapturableVideo | null>(null);
    const previewElementRef = useRef<HTMLElement | null>(null);
    const uidRef = useRef<number | null>(null);
    const pendingLinesRef = useRef<Map<string, TranscriptLineInput>>(new Map());
    const flushTimerRef = useRef<number | null>(null);
    const startedAtRef = useRef(startedAtMs);
    startedAtRef.current = startedAtMs;
    const sessionIdRef = useRef(sessionId);
    sessionIdRef.current = sessionId;
    const remotePublishersRef = useRef<RemotePublisher[]>([]);
    remotePublishersRef.current = remotePublishers;
    const obsGatewayUidRef = useRef<string | null>(null);
    const endingRef = useRef(false);
    const onEndedRef = useRef(onEnded);
    onEndedRef.current = onEnded;
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
        } catch (err) {
            console.warn('caption forward failed', err);
        }
    }, []);
    const ingestCaption = useCallback(
        (segment: AgoraRttCaptionSegment) => {
            const startMs = Math.max(
                0,
                segment.absoluteMs - (startedAtRef.current ?? segment.absoluteMs),
            );
            const existingPending = pendingLinesRef.current.get(segment.id);
            const translatedText =
                segment.kind === 'translation'
                    ? {
                          ...(existingPending?.translatedText ?? {}),
                          [segment.language]: segment.text,
                      }
                    : (existingPending?.translatedText ?? {});
            const text =
                segment.kind === 'translation'
                    ? (existingPending?.text ?? segment.text)
                    : segment.text;
            const language =
                segment.kind === 'translation'
                    ? (existingPending?.language ?? segment.language)
                    : segment.language;
            const finalized =
                segment.kind === 'translation'
                    ? (existingPending?.finalized ?? segment.finalized)
                    : segment.finalized;
            const line: CaptionLine = {
                id: segment.id,
                text,
                language,
                startMs: existingPending?.startMs ?? startMs,
                speaker: 'host',
                ...(Object.keys(translatedText).length > 0 ? { translatedText } : {}),
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
                text: line.text,
                language: line.language,
                startMs: line.startMs,
                speaker: 'host',
                finalized,
                translatedText,
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
    const releaseRemotes = useCallback((): void => {
        for (const publisher of remotePublishersRef.current) publisher.audioTrack?.stop();
        remotePublishersRef.current = [];
        setRemotePublishers([]);
    }, []);
    const disconnect = useCallback(async (): Promise<void> => {
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
    }, [releaseTracks, releaseRemotes]);
    const readAspect = useCallback((width: number, height: number): void => {
        if (width > 0 && height > 0) setFrameAspect(width / height);
    }, []);
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
    const attachRemoteHandlers = useCallback(
        (target: IAgoraRTCClient): void => {
            const merge = (uid: string, patch: Partial<RemotePublisher>): void => {
                setRemotePublishers((current) => {
                    const index = current.findIndex((publisher) => publisher.uid === uid);
                    if (index < 0)
                        return [...current, { uid, videoTrack: null, audioTrack: null, ...patch }];
                    const next = [...current];
                    next[index] = { ...current[index]!, ...patch };
                    return next;
                });
            };
            const forget = (uid: string): void => {
                remotePublishersRef.current
                    .find((publisher) => publisher.uid === uid)
                    ?.audioTrack?.stop();
                setRemotePublishers((current) =>
                    current.filter((publisher) => publisher.uid !== uid),
                );
            };
            target.on('user-published', (remote: IAgoraRTCRemoteUser, mediaType) => {
                void (async () => {
                    try {
                        const remoteUid = String(remote.uid);
                        const isObsFeed =
                            sourceRef.current === 'obs' && remoteUid === obsGatewayUidRef.current;
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
                            remote.audioTrack?.play();
                            merge(String(remote.uid), {
                                audioTrack: remote.audioTrack ?? null,
                            });
                            return;
                        }
                        merge(String(remote.uid), {
                            videoTrack: remote.videoTrack ?? null,
                        });
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
                        return next.audioTrack === null && next.videoTrack === null ? [] : [next];
                    }),
                );
            });
            target.on('user-left', (remote: IAgoraRTCRemoteUser) => forget(String(remote.uid)));
        },
        [readAspect],
    );
    const mintPass = useCallback(
        async (
            channel: string,
        ): Promise<{
            uid: number;
            rtcToken: string;
        }> => {
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
            if (minted.role !== 'host' && minted.role !== 'publisher') {
                throw new Error('You are not authorized to publish in this session.');
            }
            uidRef.current = minted.uid;
            return { uid: minted.uid, rtcToken: minted.rtcToken };
        },
        [],
    );
    const mintMonitorPass = useCallback(
        async (
            channel: string,
        ): Promise<{
            uid: number;
            rtcToken: string;
        }> => {
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
    const renewPass = useCallback(async (): Promise<void> => {
        const active = clientRef.current;
        if (!active || !slug) return;
        try {
            const channel = liveChannelForSlug(slug);
            const { rtcToken } =
                sourceRef.current === 'obs'
                    ? await mintMonitorPass(channel)
                    : await mintPass(channel);
            await active.renewToken(rtcToken);
            setTokenNotice(null);
        } catch {
            setTokenNotice(
                'This room’s publishing permission could not be renewed. If the picture stops, end the show and start it again.',
            );
        }
    }, [mintPass, mintMonitorPass, slug]);
    const attachConnectionHandlers = useCallback(
        (target: IAgoraRTCClient): void => {
            target.on('connection-state-change', (current) => setConnectionState(current));
            target.on('token-privilege-will-expire', () => void renewPass());
            target.on('token-privilege-did-expire', () => void renewPass());
        },
        [renewPass],
    );
    const joinAndPublish = useCallback(
        async (channel: string): Promise<void> => {
            if (!appId) throw new Error('This deployment has no live video configured.');
            const camera = cameraRef.current;
            const mic = micRef.current;
            if (!camera) throw new Error('Start the preview before publishing.');
            const { uid, rtcToken } = await mintPass(channel);
            const target = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' });
            clientRef.current = target;
            target.on('stream-message', (_uid, payload: Uint8Array) =>
                handleStreamMessage(payload),
            );
            attachRemoteHandlers(target);
            attachConnectionHandlers(target);
            await target.setClientRole('host');
            await target.join(appId, channel, rtcToken, uid);
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
            target.on('stream-message', (_uid, payload: Uint8Array) =>
                handleStreamMessage(payload),
            );
            attachRemoteHandlers(target);
            attachConnectionHandlers(target);
            await target.setClientRole('audience');
            await target.join(appId, channel, rtcToken, uid);
            setClient(target);
            setConnectionState(target.connectionState);
            setTokenNotice(null);
        },
        [
            appId,
            mintMonitorPass,
            handleStreamMessage,
            attachRemoteHandlers,
            attachConnectionHandlers,
        ],
    );
    const goLive = useCallback(async (): Promise<void> => {
        if (!appId || !slug || !sessionId) return;
        if (source === 'obs') {
            setState('starting');
            setError(null);
            try {
                if (sessionStatus === 'scheduled')
                    await api.post(`/api/sessions/${sessionId}/start`);
                const ingest = await api.post<ObsIngestDto>(
                    `/api/sessions/${sessionId}/obs-ingest`,
                );
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
        if (!camera) {
            setError('Start the preview before going live.');
            return;
        }
        setState('starting');
        setError(null);
        try {
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
        endingRef.current = true;
        setState('ending');
        try {
            if (flushTimerRef.current !== null) {
                window.clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            const endRequest = api.post(`/api/sessions/${sessionId}/end`);
            const captionsFlush = flushCaptions();
            const recordingUpload = recorderRef.current.stopAndUpload();
            await disconnect();
            await endRequest;
            await Promise.all([captionsFlush, recordingUpload]);
            setState('ended');
            onEndedRef.current?.();
        } catch (err) {
            endingRef.current = false;
            setState('error');
            setError(err instanceof Error ? err.message : 'end_session_failed');
        }
    }, [sessionId, flushCaptions, disconnect]);
    useEffect(() => {
        if (sessionStatus !== 'ended') return;
        void disconnect().finally(() => {
            setState('ended');
            if (!endingRef.current) onEndedRef.current?.();
        });
    }, [sessionStatus, disconnect]);
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
