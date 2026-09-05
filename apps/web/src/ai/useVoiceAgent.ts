import type { UseTextAssistResult } from './useTextAssist';
import type { AiProductCard, CreateConversationDto, ServerEvent, Surface } from '@shop/shared';
import type { AgentState, RTCEngine, RTMEngine } from 'agora-agent-client-toolkit';
import type {
    IAgoraRTCClient,
    IAgoraRTCRemoteUser,
    IMicrophoneAudioTrack,
    IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';

import {
    AgoraVoiceAI,
    AgoraVoiceAIEvents,
    ChatMessageType,
    ChatMessagePriority,
    MessageType,
    TranscriptHelperMode,
    TurnStatus,
} from 'agora-agent-client-toolkit';
import AgoraRTC from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    EVENTS,
    LANGUAGE_AUTO,
    aiChannelForConversation,
    resolveSpokenLanguage,
} from '@shop/shared';

import { ApiError, api } from '../lib/api';
import { useServerEvents } from '../lib/useServerEvents';
import { useRtm } from '../realtime/RtmProvider';
import { useSession } from '../state/session';
import { useTextAssist } from './useTextAssist';
import { orderVoiceTranscript, voiceTranscriptKey } from './voiceTranscript';

export type VoiceAgentPhase =
    'idle' | 'starting' | 'active' | 'stopping' | 'human_waiting' | 'human_active' | 'error';
export type VoiceAgentMode = 'text' | 'voice';
export type AssistantLine = {
    key: string;
    role: 'user' | 'assistant';
    text: string;
    language: string;
    final: boolean;
    products: AiProductCard[];
    turnId: number | null;
};
type ActiveSession = {
    conversationId: string;
    rtcChannel: string;
    agentUid: number;
    client: IAgoraRTCClient;
    mic: IMicrophoneAudioTrack | null;
    toolkit: AgoraVoiceAI | null;
    releaseRtm: () => void;
    heartbeat: number | null;
    handoffOnly: boolean;
};
const VOICE_UNAVAILABLE = "Voice isn't available here — keep typing and I'll answer.";
const VOICE_BUSY = "Voice is busy right now — keep typing and I'll answer.";
const VOICE_FAILED = "Voice didn't connect — keep typing and I'll answer.";
const VOICE_DROPPED = "Voice dropped — keep typing and I'll answer.";
const ACTION_FAILED = "That didn't go through — try again.";
const TOOL_PROTOCOL_PREFIX = '<tool_call>';
export const isToolProtocolText = (text: string): boolean => {
    const normalized = text.trimStart().toLowerCase();
    return (
        normalized.length > 0 &&
        (TOOL_PROTOCOL_PREFIX.startsWith(normalized) ||
            normalized.startsWith(TOOL_PROTOCOL_PREFIX) ||
            normalized.startsWith('</tool_call>'))
    );
};
const HEARTBEAT_MS = 30000;
const HANDOFF_NOTICE =
    'Your request is in the support queue. Keep this window open and your microphone on.';
const HANDOFF_BUSY =
    'You are already waiting for a support agent. Keep this window open until someone joins.';
const DUCKED_VOLUME = 15;
const FULL_VOLUME = 100;
export type UseVoiceAgentResult = {
    phase: VoiceAgentPhase;
    mode: VoiceAgentMode;
    capacityNotice: string | null;
    handoffNotice: string | null;
    agentState: AgentState | null;
    lines: AssistantLine[];
    error: string | null;
    language: string;
    spokenLanguage: string;
    conversationId: string | null;
    available: boolean;
    micTrack: IMicrophoneAudioTrack | null;
    supportAudioReady: boolean;
    resumeSupportAudio: () => void;
    start: () => Promise<void>;
    stop: () => Promise<void>;
    sendText: (text: string) => Promise<void>;
    textPending: boolean;
    textAssist: UseTextAssistResult;
};
export const useVoiceAgent = (opts: {
    surface: Surface;
    liveSessionId?: string | null;
    productId?: string | null;
    duckTrack?: IRemoteAudioTrack | null;
}): UseVoiceAgentResult => {
    const { surface, liveSessionId, productId, duckTrack } = opts;
    const { config, user } = useSession();
    const rtm = useRtm();
    const rtmRef = useRef(rtm);
    rtmRef.current = rtm;
    const duckRef = useRef<IRemoteAudioTrack | null>(duckTrack ?? null);
    const sessionRef = useRef<ActiveSession | null>(null);
    const pendingBootstrapRef = useRef<Promise<ActiveSession> | null>(null);
    const pendingHandoffRef = useRef<Promise<void> | null>(null);
    const rtcChannelRef = useRef<string | null>(null);
    const viewerUidRef = useRef<number | null>(null);
    const contextRef = useRef({ surface, liveSessionId, productId });
    const supportAudioRef = useRef<IRemoteAudioTrack | null>(null);
    const supportUidRef = useRef<number | null>(null);
    contextRef.current = { surface, liveSessionId, productId };
    const [phase, setPhase] = useState<VoiceAgentPhase>('idle');
    const phaseRef = useRef<VoiceAgentPhase>('idle');
    phaseRef.current = phase;
    const [mode, setMode] = useState<VoiceAgentMode>('text');
    const [capacityNotice, setCapacityNotice] = useState<string | null>(null);
    const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
    const [agentState, setAgentState] = useState<AgentState | null>(null);
    const [voiceLines, setVoiceLines] = useState<AssistantLine[]>([]);
    const [textPending, setTextPending] = useState(false);
    const textPendingRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [supportAudioReady, setSupportAudioReady] = useState(false);
    const [micTrack, setMicTrack] = useState<IMicrophoneAudioTrack | null>(null);
    const language = LANGUAGE_AUTO;
    const languageRef = useRef(language);
    languageRef.current = language;
    const conversationIdRef = useRef<string | null>(null);
    const supportedLanguages = config?.supportedLanguages ?? [];
    const supportedRef = useRef<readonly string[]>(supportedLanguages);
    supportedRef.current = supportedLanguages;
    const lastUserTextRef = useRef<string | null>(null);
    const agoraAvailable = Boolean(config?.features.convoai && config?.agoraAppId);
    const resolveLanguage = useCallback(
        (): string =>
            resolveSpokenLanguage(languageRef.current, supportedRef.current, {
                text: lastUserTextRef.current,
                locale:
                    languageRef.current === LANGUAGE_AUTO &&
                    user &&
                    !user.isGuest &&
                    user.preferredLanguage
                        ? user.preferredLanguage
                        : navigator.language,
            }),
        [user],
    );
    const pendingTextCreateRef = useRef<Promise<string> | null>(null);
    const ensureTextConversation = useCallback(async (): Promise<string> => {
        const existing = conversationIdRef.current;
        if (existing) return existing;
        const inFlight = pendingTextCreateRef.current;
        if (inFlight) return inFlight;
        const create = (async (): Promise<string> => {
            try {
                const conversation = await api.post<CreateConversationDto>(
                    '/api/ai/conversations',
                    {
                        surface: contextRef.current.surface,
                        liveSessionId: contextRef.current.liveSessionId ?? null,
                        productId: contextRef.current.productId ?? null,
                        language: languageRef.current,
                    },
                );
                conversationIdRef.current = conversation.conversationId;
                rtcChannelRef.current = conversation.rtcChannel;
                viewerUidRef.current = conversation.viewerUid;
                setConversationId(conversation.conversationId);
                return conversation.conversationId;
            } finally {
                pendingTextCreateRef.current = null;
            }
        })();
        pendingTextCreateRef.current = create;
        return create;
    }, []);
    const joinSupportHandoffRef = useRef<() => Promise<void>>(async () => undefined);
    const textAssist = useTextAssist({
        ensureConversation: ensureTextConversation,
        resolveLanguage,
        onEscalated: () => {
            void joinSupportHandoffRef.current();
        },
    });
    let latestUserText: string | null = null;
    for (let i = voiceLines.length - 1; i >= 0; i -= 1) {
        const line = voiceLines[i];
        if (line?.role === 'user') {
            latestUserText = line.text;
            break;
        }
    }
    if (latestUserText === null) {
        for (let i = textAssist.messages.length - 1; i >= 0; i -= 1) {
            const message = textAssist.messages[i];
            if (message?.role === 'user') {
                latestUserText = message.text;
                break;
            }
        }
    }
    lastUserTextRef.current = latestUserText;
    const spokenLanguage = resolveLanguage();
    const spokenLanguageRef = useRef(spokenLanguage);
    spokenLanguageRef.current = spokenLanguage;
    const agoraLineCount = voiceLines.length;
    useEffect(() => {
        if (agoraLineCount > 0 || textAssist.messages.length > 0) setError(null);
    }, [agoraLineCount, textAssist.messages.length]);
    useEffect(() => {
        const previous = duckRef.current;
        if (previous && previous !== duckTrack) previous.setVolume(FULL_VOLUME);
        duckRef.current = duckTrack ?? null;
        if (duckTrack && sessionRef.current?.mic) duckTrack.setVolume(DUCKED_VOLUME);
    }, [duckTrack]);
    const bindClientHandlers = useCallback((client: IAgoraRTCClient): void => {
        client.on('user-published', (remote: IAgoraRTCRemoteUser, mediaType) => {
            if (mediaType !== 'audio') return;
            void (async () => {
                try {
                    await client.subscribe(remote, 'audio');
                    const track = remote.audioTrack;
                    track?.play();
                    if (
                        track &&
                        (phaseRef.current === 'human_waiting' ||
                            phaseRef.current === 'human_active')
                    ) {
                        supportAudioRef.current = track;
                        setSupportAudioReady(true);
                    }
                    if (phaseRef.current === 'human_waiting') {
                        phaseRef.current = 'human_active';
                        setPhase('human_active');
                        setHandoffNotice('Support audio is connected. You can speak now.');
                    }
                } catch {
                    if (
                        phaseRef.current === 'human_waiting' ||
                        phaseRef.current === 'human_active'
                    ) {
                        setHandoffNotice(
                            'The support agent joined, but their audio could not play. Check your speaker volume and reconnect.',
                        );
                    } else {
                        setError(VOICE_DROPPED);
                    }
                }
            })();
        });
        client.on('user-unpublished', (remote, mediaType) => {
            if (
                mediaType !== 'audio' ||
                supportUidRef.current === null ||
                String(remote.uid) !== String(supportUidRef.current)
            ) {
                return;
            }
            supportAudioRef.current = null;
            setSupportAudioReady(false);
            phaseRef.current = 'human_waiting';
            setPhase('human_waiting');
            setHandoffNotice('Support audio paused. Reconnecting the agent…');
        });
        client.on('user-left', (remote) => {
            if (
                supportUidRef.current === null ||
                String(remote.uid) !== String(supportUidRef.current)
            ) {
                return;
            }
            supportAudioRef.current = null;
            setSupportAudioReady(false);
            phaseRef.current = 'human_waiting';
            setPhase('human_waiting');
            setHandoffNotice('The support agent disconnected. Waiting for them to reconnect…');
        });
    }, []);
    const bindToolkitHandlers = useCallback((toolkit: AgoraVoiceAI): void => {
        toolkit.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (transcription) => {
            setVoiceLines(
                orderVoiceTranscript(transcription)
                    .filter(
                        (item) =>
                            item.metadata?.object === MessageType.USER_TRANSCRIPTION ||
                            !isToolProtocolText(item.text),
                    )
                    .map((item) => ({
                        key: voiceTranscriptKey(item),
                        role:
                            item.metadata?.object === MessageType.USER_TRANSCRIPTION
                                ? 'user'
                                : 'assistant',
                        text: item.text,
                        language: item.metadata?.language ?? spokenLanguageRef.current,
                        final: item.status === TurnStatus.END,
                        products: [],
                        turnId: item.turn_id,
                    })),
            );
        });
        toolkit.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_agentUserId, event) => {
            setAgentState(event.state);
        });
    }, []);
    const ensureAgoraSession = useCallback(
        async (opts: { withMic: boolean }): Promise<ActiveSession> => {
            const inFlight = pendingBootstrapRef.current;
            if (inFlight) return inFlight;
            const existing = sessionRef.current;
            if (existing) {
                if (opts.withMic && !existing.mic) {
                    const mic = await AgoraRTC.createMicrophoneAudioTrack({
                        AEC: true,
                        ANS: true,
                        AGC: true,
                        encoderConfig: 'speech_standard',
                    });
                    await existing.client.publish([mic]);
                    existing.mic = mic;
                    setMicTrack(mic);
                    duckRef.current?.setVolume(DUCKED_VOLUME);
                }
                if (opts.withMic) setMode('voice');
                return existing;
            }
            const appId = config?.agoraAppId;
            if (!appId) throw new Error('agora_unavailable');
            const bootstrap = (async (): Promise<ActiveSession> => {
                let client: IAgoraRTCClient | null = null;
                let mic: IMicrophoneAudioTrack | null = null;
                let releaseRtm: (() => void) | null = null;
                let toolkit: AgoraVoiceAI | null = null;
                let conversation: CreateConversationDto | null = null;
                try {
                    conversation = await api.post<CreateConversationDto>('/api/ai/conversations', {
                        surface: contextRef.current.surface,
                        liveSessionId: contextRef.current.liveSessionId ?? null,
                        productId: contextRef.current.productId ?? null,
                        language: resolveLanguage(),
                    });
                    conversationIdRef.current = conversation.conversationId;
                    rtcChannelRef.current = conversation.rtcChannel;
                    viewerUidRef.current = conversation.viewerUid;
                    setConversationId(conversation.conversationId);
                    const channel =
                        conversation.rtcChannel ||
                        aiChannelForConversation(conversation.conversationId);
                    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
                    bindClientHandlers(client);
                    await client.join(
                        appId,
                        channel,
                        conversation.rtcToken,
                        conversation.viewerUid,
                    );
                    if (opts.withMic) {
                        mic = await AgoraRTC.createMicrophoneAudioTrack({
                            AEC: true,
                            ANS: true,
                            AGC: true,
                            encoderConfig: 'speech_standard',
                        });
                        await client.publish([mic]);
                        setMicTrack(mic);
                        duckRef.current?.setVolume(DUCKED_VOLUME);
                    }
                    releaseRtm = await rtmRef.current.subscribe(channel, () => undefined);
                    const rtmClient = rtmRef.current.client;
                    if (!rtmClient) throw new Error('rtm_unavailable');
                    toolkit = await AgoraVoiceAI.init({
                        rtcEngine: client as RTCEngine,
                        rtmEngine: rtmClient as RTMEngine,
                        renderMode: TranscriptHelperMode.TEXT,
                    });
                    bindToolkitHandlers(toolkit);
                    toolkit.subscribeMessage(channel);
                    await api.post(`/api/ai/conversations/${conversation.conversationId}/start`);
                    const heartbeat = window.setInterval(() => {
                        void api
                            .post(
                                `/api/ai/conversations/${conversation?.conversationId}/heartbeat`,
                            )
                            .catch(() => undefined);
                    }, HEARTBEAT_MS);
                    const session: ActiveSession = {
                        conversationId: conversation.conversationId,
                        rtcChannel: channel,
                        agentUid: conversation.agentUid,
                        client,
                        mic,
                        toolkit,
                        releaseRtm,
                        heartbeat,
                        handoffOnly: false,
                    };
                    sessionRef.current = session;
                    setMode(opts.withMic ? 'voice' : 'text');
                    setPhase('active');
                    return session;
                } catch (err) {
                    if (toolkit) {
                        toolkit.removeAllEventListeners();
                        toolkit.unsubscribe();
                        toolkit.destroy();
                    }
                    releaseRtm?.();
                    if (client) {
                        client.removeAllListeners();
                        if (mic) {
                            try {
                                await client.unpublish([mic]);
                            } catch {}
                            mic.stop();
                            mic.close();
                        }
                        await client.leave().catch(() => undefined);
                    }
                    if (conversation) {
                        void api
                            .post(`/api/ai/conversations/${conversation.conversationId}/stop`)
                            .catch(() => undefined);
                        conversationIdRef.current = null;
                        setConversationId(null);
                    }
                    throw err;
                }
            })();
            pendingBootstrapRef.current = bootstrap;
            try {
                return await bootstrap;
            } finally {
                pendingBootstrapRef.current = null;
            }
        },
        [bindClientHandlers, bindToolkitHandlers, config?.agoraAppId, resolveLanguage],
    );
    const joinSupportHandoff = useCallback(async (): Promise<void> => {
        const inFlight = pendingHandoffRef.current;
        if (inFlight) {
            await inFlight;
            return;
        }
        if (phaseRef.current === 'human_waiting' || phaseRef.current === 'human_active') {
            setHandoffNotice(HANDOFF_BUSY);
            setMode('voice');
            return;
        }
        const conversationId = conversationIdRef.current;
        if (!conversationId) return;
        const appId = config?.agoraAppId;
        const run = (async (): Promise<void> => {
            setError(null);
            setHandoffNotice(HANDOFF_NOTICE);
            setMode('voice');
            phaseRef.current = 'human_waiting';
            setPhase('human_waiting');
            setAgentState(null);
            if (!appId) {
                setHandoffNotice(
                    'Your request is in the support queue. A support agent will join this chat shortly.',
                );
                return;
            }
            try {
                const existing = sessionRef.current;
                if (existing) {
                    if (!existing.mic) {
                        const mic = await AgoraRTC.createMicrophoneAudioTrack({
                            AEC: true,
                            ANS: true,
                            AGC: true,
                            encoderConfig: 'speech_standard',
                        });
                        await existing.client.publish([mic]);
                        existing.mic = mic;
                        setMicTrack(mic);
                        duckRef.current?.setVolume(DUCKED_VOLUME);
                    }
                    return;
                }
                const handoff = await api.get<{
                    conversationId: string;
                    rtcChannel: string;
                    rtcToken: string;
                    viewerUid: number;
                }>(`/api/ai/conversations/${conversationId}/handoff`);
                rtcChannelRef.current = handoff.rtcChannel;
                viewerUidRef.current = handoff.viewerUid;
                const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
                bindClientHandlers(client);
                await client.join(
                    appId,
                    handoff.rtcChannel,
                    handoff.rtcToken,
                    handoff.viewerUid,
                );
                const mic = await AgoraRTC.createMicrophoneAudioTrack({
                    AEC: true,
                    ANS: true,
                    AGC: true,
                    encoderConfig: 'speech_standard',
                });
                await client.publish([mic]);
                setMicTrack(mic);
                duckRef.current?.setVolume(DUCKED_VOLUME);
                const releaseRtm = await rtmRef.current.subscribe(handoff.rtcChannel, () => undefined);
                sessionRef.current = {
                    conversationId,
                    rtcChannel: handoff.rtcChannel,
                    agentUid: 0,
                    client,
                    mic,
                    toolkit: null,
                    releaseRtm,
                    heartbeat: null,
                    handoffOnly: true,
                };
            } catch {
                setHandoffNotice(
                    'Your request is queued, but voice could not connect. Keep this window open — a support agent can still join from the dashboard.',
                );
            }
        })();
        pendingHandoffRef.current = run;
        try {
            await run;
        } finally {
            pendingHandoffRef.current = null;
        }
    }, [bindClientHandlers, config?.agoraAppId]);
    joinSupportHandoffRef.current = joinSupportHandoff;
    const teardownMedia = useCallback(async (): Promise<void> => {
        const active = sessionRef.current;
        sessionRef.current = null;
        setMicTrack(null);
        supportAudioRef.current = null;
        supportUidRef.current = null;
        setSupportAudioReady(false);
        if (!active) return;
        if (active.heartbeat !== null) window.clearInterval(active.heartbeat);
        if (active.toolkit) {
            active.toolkit.removeAllEventListeners();
            active.toolkit.unsubscribe();
            active.toolkit.destroy();
        }
        active.releaseRtm();
        active.client.removeAllListeners();
        if (active.mic) {
            try {
                await active.client.unpublish([active.mic]);
            } catch {}
            active.mic.stop();
            active.mic.close();
        }
        try {
            await active.client.leave();
        } catch {}
        duckRef.current?.setVolume(FULL_VOLUME);
    }, []);
    const stop = useCallback(async (): Promise<void> => {
        const id = conversationIdRef.current;
        setPhase('stopping');
        await teardownMedia();
        if (id) {
            try {
                await api.post(`/api/ai/conversations/${id}/stop`);
            } catch {}
        }
        conversationIdRef.current = null;
        setConversationId(null);
        setAgentState(null);
        setCapacityNotice(null);
        setHandoffNotice(null);
        setMode('text');
        setPhase('idle');
        setVoiceLines([]);
    }, [teardownMedia]);
    const sendText = useCallback(
        async (text: string): Promise<void> => {
            const body = text.trim();
            if (body.length === 0 || textPendingRef.current) return;
            if (phaseRef.current === 'human_waiting' || phaseRef.current === 'human_active') {
                setHandoffNotice(HANDOFF_BUSY);
                return;
            }
            const voiceCallActive = Boolean(sessionRef.current?.mic);
            if (!agoraAvailable || !voiceCallActive) {
                await textAssist.send(body);
                return;
            }
            textPendingRef.current = true;
            setTextPending(true);
            setError(null);
            try {
                const session = sessionRef.current;
                if (!session?.toolkit) {
                    await textAssist.send(body);
                    return;
                }
                await session.toolkit.sendText(String(session.agentUid), {
                    messageType: ChatMessageType.TEXT,
                    priority: ChatMessagePriority.INTERRUPTED,
                    responseInterruptable: true,
                    text: body,
                });
            } catch (err) {
                const capacityExhausted =
                    err instanceof ApiError && err.status === 503 && err.code === 'ai_capacity';
                if (capacityExhausted) {
                    setCapacityNotice(VOICE_BUSY);
                    setPhase('idle');
                    await teardownMedia();
                    try {
                        await textAssist.send(body);
                        return;
                    } catch {
                        setError(ACTION_FAILED);
                        return;
                    }
                }
                setError(ACTION_FAILED);
            } finally {
                textPendingRef.current = false;
                setTextPending(false);
            }
        },
        [agoraAvailable, teardownMedia, textAssist],
    );
    const start = useCallback(async (): Promise<void> => {
        if (phase === 'starting') return;
        if (!config?.agoraAppId) {
            setError(VOICE_UNAVAILABLE);
            setPhase('error');
            return;
        }
        setError(null);
        setHandoffNotice(null);
        setCapacityNotice(null);
        if (sessionRef.current) {
            setPhase('starting');
            try {
                await ensureAgoraSession({ withMic: true });
                setPhase('active');
            } catch (err) {
                const capacityExhausted =
                    err instanceof ApiError && err.status === 503 && err.code === 'ai_capacity';
                if (capacityExhausted) {
                    setCapacityNotice(VOICE_BUSY);
                    setPhase('active');
                    return;
                }
                setError(VOICE_FAILED);
                setPhase('error');
            }
            return;
        }
        setPhase('starting');
        setVoiceLines([]);
        try {
            await ensureAgoraSession({ withMic: true });
        } catch (err) {
            setMode('text');
            const capacityExhausted =
                err instanceof ApiError && err.status === 503 && err.code === 'ai_capacity';
            if (capacityExhausted) {
                setCapacityNotice(VOICE_BUSY);
                setPhase('idle');
                return;
            }
            setError(VOICE_FAILED);
            setPhase('error');
        }
    }, [config?.agoraAppId, ensureAgoraSession, phase]);
    const startRef = useRef(start);
    startRef.current = start;
    const stopRef = useRef(stop);
    stopRef.current = stop;
    const resumeSupportAudio = useCallback((): void => {
        AgoraRTC.resumeAudioContext();
        supportAudioRef.current?.play();
    }, []);
    const onSupportEvent = useCallback(
        (event: ServerEvent) => {
            if (event.event === EVENTS.supportEscalated) {
                const data = event.data as {
                    conversationId?: string;
                };
                if (data.conversationId && data.conversationId !== conversationIdRef.current)
                    return;
                void joinSupportHandoff();
                return;
            }
            if (event.event === EVENTS.supportAgentJoined) {
                const data = event.data as {
                    conversationId?: string;
                    supportUid?: number;
                };
                if (data.conversationId && data.conversationId !== conversationIdRef.current)
                    return;
                supportUidRef.current = data.supportUid ?? null;
                if (phaseRef.current !== 'human_active') {
                    setHandoffNotice('A support agent joined. Connecting their audio…');
                }
                return;
            }
            if (event.event === EVENTS.supportCallEnded) {
                const data = event.data as {
                    conversationId?: string;
                };
                if (data.conversationId && data.conversationId !== conversationIdRef.current)
                    return;
                phaseRef.current = 'idle';
                conversationIdRef.current = null;
                setConversationId(null);
                setMode('text');
                setPhase('idle');
                setAgentState(null);
                setHandoffNotice(
                    'Your support call has ended. You can continue shopping or start a new chat.',
                );
                void teardownMedia();
            }
        },
        [joinSupportHandoff, teardownMedia],
    );
    useServerEvents({
        enabled: conversationId !== null,
        onEvent: onSupportEvent,
    });
    useEffect(() => {
        const onBeforeUnload = (): void => {
            const active = sessionRef.current;
            if (!active) return;
            void fetch(`/api/ai/conversations/${active.conversationId}/stop`, {
                method: 'POST',
                credentials: 'include',
                keepalive: true,
            }).catch(() => undefined);
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', onBeforeUnload);
            if (sessionRef.current) void stopRef.current();
        };
    }, []);
    const agoraActive =
        phase === 'starting' ||
        phase === 'active' ||
        phase === 'human_waiting' ||
        phase === 'human_active';
    const fallbackLines: AssistantLine[] = textAssist.messages.map((message) => ({
        key: message.id,
        role: message.role,
        text: message.text,
        language: message.language,
        final: true,
        products: message.products,
        turnId: null,
    }));
    const lines: AssistantLine[] =
        agoraActive || voiceLines.length > 0 ? voiceLines : fallbackLines;
    return {
        phase,
        mode,
        capacityNotice,
        handoffNotice,
        agentState,
        lines,
        error: error ?? textAssist.error,
        language,
        spokenLanguage,
        supportAudioReady,
        resumeSupportAudio,
        conversationId,
        available: agoraAvailable,
        micTrack,
        start,
        stop,
        sendText,
        textPending,
        textAssist,
    };
};
