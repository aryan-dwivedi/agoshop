import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  MessageType,
  TranscriptHelperMode,
  TurnStatus,
  type RTCEngine,
  type RTMEngine,
} from 'agora-agent-client-toolkit';
import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type IMicrophoneAudioTrack,
  type IRemoteAudioTrack,
} from 'agora-rtc-sdk-ng';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aiChannelForConversation,
  EVENTS,
  LANGUAGE_AUTO,
  resolveSpokenLanguage,
  type AiProductCard,
  type CreateConversationDto,
  type ServerEvent,
  type Surface,
} from '@shop/shared';

import { api, ApiError } from '../lib/api';
import { useServerEvents } from '../lib/useServerEvents';
import { useRtm } from '../realtime/RtmProvider';
import { useSession } from '../state/session';
import { useTextAssist, type UseTextAssistResult } from './useTextAssist';
import { orderVoiceTranscript, voiceTranscriptKey } from './voiceTranscript';

/**
 * The voice assistant client — the core of the exercise.
 *
 * Text and voice are both first-class here. The hook starts in `mode:'text'`, where a
 * turn costs nothing but an HTTP round-trip, and only touches RTC when the shopper
 * asks for a live voice conversation. `capacityNotice` therefore means one specific
 * thing: a voice conversation was requested and ConvoAI refused a slot, so the
 * shopper is on text against their wishes.
 *
 * The conversation runs in its OWN RTC channel (`ai-<conversationId>`), where the
 * viewer publishes a mic as host and ConvoAI's agent joins with
 * `remote_rtc_uids:[viewerUid]`. That is what makes the conversation private while
 * the shopper stays an audience member of the live channel — and why the live stream's
 * remote audio is ducked to 15 while the agent is speaking (decision 1).
 *
 * The order below is not incidental:
 *   1. `POST /api/ai/conversations`   — server allocates uids, channel and tokens
 *   2. RTC join + mic publish         — the agent needs a peer to talk to
 *   3. `RtmProvider.subscribe(channel)` — BEFORE `/start`, or the greeting transcript
 *      is published before anyone is listening and is lost forever
 *   4. `AgoraVoiceAI.init` + handlers + `subscribeMessage`
 *   5. `POST /start`                  — only now does the agent exist
 *   6. agent audio is subscribed when `user-published` fires
 *
 * There is exactly one RTM client in the browser (decision 2): this hook borrows it
 * from `RtmProvider` and, on stop, releases only its own channel — chat subscriptions
 * and the RTM login survive.
 */

export type VoiceAgentPhase =
  'idle' | 'starting' | 'active' | 'stopping' | 'human_waiting' | 'human_active' | 'error';
/** Which channel the shopper is talking on right now. Text until voice is asked for. */
export type VoiceAgentMode = 'text' | 'voice';

export type AssistantLine = {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  language: string;
  final: boolean;
  /**
   * Products this turn surfaced. A text turn carries them inline; a voice turn learns
   * them from the `ai.products_shown` event, matched on `turnId`.
   */
  products: AiProductCard[];
  /** Agora's turn id for a voice line; `null` for a text turn, which needs no key. */
  turnId: number | null;
};

type ActiveSession = {
  conversationId: string;
  rtcChannel: string;
  client: IAgoraRTCClient;
  mic: IMicrophoneAudioTrack;
  toolkit: AgoraVoiceAI;
  releaseRtm: () => void;
  heartbeat: number;
};

/**
 * What the shopper is told. A transport code names the thing that broke; this names
 * the thing they can still do, which is why every voice failure ends the same way.
 */
const VOICE_UNAVAILABLE = "Voice isn't available here — keep typing and I'll answer.";
const VOICE_BUSY = "Voice is busy right now — keep typing and I'll answer.";
const VOICE_FAILED = "Voice didn't connect — keep typing and I'll answer.";
const VOICE_DROPPED = "Voice dropped — keep typing and I'll answer.";
const ACTION_FAILED = "That didn't go through — try again.";
/** Matches server `CONVOAI_FAILURE_MESSAGE` — spoken when managed LLM / MCP fails. */
const CONVOAI_CATALOG_FAILURE = "couldn't reach the catalog";

const TOOL_PROTOCOL_PREFIX = '<tool_call>';

/** Tool protocol is neither a caption nor speech, even if a provider emits it as text. */
export const isToolProtocolText = (text: string): boolean => {
  const normalized = text.trimStart().toLowerCase();
  return (
    normalized.length > 0 &&
    (TOOL_PROTOCOL_PREFIX.startsWith(normalized) ||
      normalized.startsWith(TOOL_PROTOCOL_PREFIX) ||
      normalized.startsWith('</tool_call>'))
  );
};

const HEARTBEAT_MS = 30_000;
const DUCKED_VOLUME = 15;
const FULL_VOLUME = 100;

export type UseVoiceAgentResult = {
  phase: VoiceAgentPhase;
  mode: VoiceAgentMode;
  /** Set only when a voice slot was refused; the shopper stays on text. */
  capacityNotice: string | null;
  /** Human support joined after AI escalation. */
  handoffNotice: string | null;
  agentState: AgentState | null;
  lines: AssistantLine[];
  error: string | null;
  /** The shopper's choice, possibly the `auto` sentinel. */
  language: string;
  /** The concrete code auto resolved to — what ASR is actually configured with. */
  spokenLanguage: string;
  conversationId: string | null;
  available: boolean;
  /** The published mic, while a voice call is up — what the level meter measures. */
  micTrack: IMicrophoneAudioTrack | null;
  /** A subscribed human-support track is available for manual autoplay recovery. */
  supportAudioReady: boolean;
  resumeSupportAudio: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  textAssist: UseTextAssistResult;
};

export const useVoiceAgent = (opts: {
  surface: Surface;
  liveSessionId?: string | null;
  productId?: string | null;
  /** The live stream's remote audio, ducked while the agent holds the floor. */
  duckTrack?: IRemoteAudioTrack | null;
}): UseVoiceAgentResult => {
  const { surface, liveSessionId, productId, duckTrack } = opts;
  const { config, user } = useSession();
  const rtm = useRtm();

  const rtmRef = useRef(rtm);
  rtmRef.current = rtm;
  const duckRef = useRef<IRemoteAudioTrack | null>(duckTrack ?? null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const llmFallbackAttemptedRef = useRef(false);
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
  /** How many text turns preceded the current voice block, for ordered merging. */
  const [voiceAnchor, setVoiceAnchor] = useState(0);
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
  /** Latest thing the shopper typed — the strongest hint auto-detect has. */
  const lastUserTextRef = useRef<string | null>(null);
  const textCountRef = useRef(0);

  /**
   * Stable by construction — it reads refs — so the text hook's own callbacks stay
   * stable while still seeing the current choice, supported set and typed history.
   */
  const resolveLanguage = useCallback(
    (): string =>
      resolveSpokenLanguage(languageRef.current, supportedRef.current, {
        text: lastUserTextRef.current,
        locale:
          languageRef.current === LANGUAGE_AUTO && user && !user.isGuest && user.preferredLanguage
            ? user.preferredLanguage
            : navigator.language,
      }),
    [user],
  );

  const pendingTextCreateRef = useRef<Promise<string> | null>(null);

  /**
   * The text conversation is allocated on the first turn, never when the panel opens:
   * an idle panel must not cost a conversation row or an admission lease.
   */
  const ensureTextConversation = useCallback(async (): Promise<string> => {
    const existing = conversationIdRef.current;
    if (existing) return existing;
    // Two quick sends must not each allocate a row, so the create in flight is shared.
    const inFlight = pendingTextCreateRef.current;
    if (inFlight) return inFlight;

    const create = (async (): Promise<string> => {
      try {
        const conversation = await api.post<CreateConversationDto>('/api/ai/conversations', {
          surface: contextRef.current.surface,
          liveSessionId: contextRef.current.liveSessionId ?? null,
          productId: contextRef.current.productId ?? null,
          // The sentinel travels verbatim: the server resolves a reply language per
          // turn, which is strictly better than freezing one guess at create time.
          language: languageRef.current,
          transport: 'text',
        });
        conversationIdRef.current = conversation.conversationId;
        setConversationId(conversation.conversationId);
        return conversation.conversationId;
      } finally {
        pendingTextCreateRef.current = null;
      }
    })();
    pendingTextCreateRef.current = create;
    return create;
  }, []);

  const textAssist = useTextAssist({
    ensureConversation: ensureTextConversation,
    resolveLanguage,
  });

  let latestUserText: string | null = null;
  for (let i = textAssist.messages.length - 1; i >= 0; i -= 1) {
    const message = textAssist.messages[i];
    if (message?.role === 'user') {
      latestUserText = message.text;
      break;
    }
  }
  lastUserTextRef.current = latestUserText;
  textCountRef.current = textAssist.messages.length;
  const spokenLanguage = resolveLanguage();
  const spokenLanguageRef = useRef(spokenLanguage);
  spokenLanguageRef.current = spokenLanguage;

  // A failed voice attempt must not keep shouting over a working text conversation:
  // the moment a text turn exists, the text transport owns the error banner.
  const textTurnCount = textAssist.messages.length;
  useEffect(() => {
    if (textTurnCount > 0) setError(null);
  }, [textTurnCount]);

  // Ducking follows the live track: a tier handoff swaps the track mid-conversation.
  useEffect(() => {
    const previous = duckRef.current;
    if (previous && previous !== duckTrack) previous.setVolume(FULL_VOLUME);
    duckRef.current = duckTrack ?? null;
    if (duckTrack && sessionRef.current) duckTrack.setVolume(DUCKED_VOLUME);
  }, [duckTrack]);

  /** Tears down media + toolkit + this hook's RTM channel. Never touches the login. */
  const teardownMedia = useCallback(async (): Promise<void> => {
    const active = sessionRef.current;
    sessionRef.current = null;
    setMicTrack(null);
    supportAudioRef.current = null;
    supportUidRef.current = null;
    setSupportAudioReady(false);
    if (!active) return;

    window.clearInterval(active.heartbeat);
    active.toolkit.removeAllEventListeners();
    active.toolkit.unsubscribe();
    active.toolkit.destroy();
    active.releaseRtm();

    active.client.removeAllListeners();
    try {
      await active.client.unpublish([active.mic]);
    } catch {
      // The channel may already be gone; closing the track below is what matters.
    }
    active.mic.stop();
    active.mic.close();
    try {
      await active.client.leave();
    } catch {
      // Leaving a dead connection is not an error worth surfacing.
    }
    duckRef.current?.setVolume(FULL_VOLUME);
  }, []);

  const stop = useCallback(async (): Promise<void> => {
    const id = conversationIdRef.current;
    setPhase('stopping');
    await teardownMedia();
    if (id) {
      try {
        // Also the right call for a text conversation: it closes the row.
        await api.post(`/api/ai/conversations/${id}/stop`);
      } catch {
        // The lease sweeper reclaims the slot even if this call never lands.
      }
    }
    conversationIdRef.current = null;
    setConversationId(null);
    setAgentState(null);
    setCapacityNotice(null);
    setHandoffNotice(null);
    setMode('text');
    setPhase('idle');
  }, [teardownMedia]);

  const start = useCallback(async (): Promise<void> => {
    if (sessionRef.current || phase === 'starting') return;
    const appId = config?.agoraAppId;
    if (!appId) {
      setError(VOICE_UNAVAILABLE);
      setPhase('error');
      return;
    }

    setPhase('starting');
    setMode('voice');
    setError(null);
    setHandoffNotice(null);
    setCapacityNotice(null);
    setVoiceLines([]);
    llmFallbackAttemptedRef.current = false;
    // The voice transcript arrives as one contiguous block, so remembering how many
    // text turns preceded it is enough to interleave both sources in real order.
    setVoiceAnchor(textCountRef.current);

    // A conversation already open on text — deliberate, or left behind by a refused
    // voice slot — holds a row and a lease. Voice needs its own row for
    // the tokens and uids that only a create response carries, so release that one
    // rather than leaving it for the sweeper.
    const superseded = conversationIdRef.current;
    if (superseded) {
      conversationIdRef.current = null;
      setConversationId(null);
      await api.post(`/api/ai/conversations/${superseded}/stop`).catch(() => undefined);
    }

    let client: IAgoraRTCClient | null = null;
    let mic: IMicrophoneAudioTrack | null = null;
    let releaseRtm: (() => void) | null = null;
    let toolkit: AgoraVoiceAI | null = null;
    let conversation: CreateConversationDto | null = null;

    try {
      // 1. Allocation. This endpoint assumes nothing about a browser — a PSTN
      //    gateway would call exactly the same one.
      conversation = await api.post<CreateConversationDto>('/api/ai/conversations', {
        surface: contextRef.current.surface,
        liveSessionId: contextRef.current.liveSessionId ?? null,
        productId: contextRef.current.productId ?? null,
        // Voice cannot wait for a first turn to detect a language: ASR has to be
        // configured before a word is spoken, so auto is resolved to a concrete code.
        language: resolveLanguage(),
      });
      conversationIdRef.current = conversation.conversationId;
      setConversationId(conversation.conversationId);
      const channel =
        conversation.rtcChannel || aiChannelForConversation(conversation.conversationId);

      // 2. Private RTC channel: publish the mic as host.
      client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });

      // Registered before the agent can possibly join, so the subscribe genuinely
      // happens on `user-published` and never races the agent's arrival.
      client.on('user-published', (remote: IAgoraRTCRemoteUser, mediaType) => {
        if (mediaType !== 'audio') return;
        void (async () => {
          try {
            await client?.subscribe(remote, 'audio');
            const track = remote.audioTrack;
            track?.play();
            if (
              track &&
              (phaseRef.current === 'human_waiting' || phaseRef.current === 'human_active')
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
            if (phaseRef.current === 'human_waiting' || phaseRef.current === 'human_active') {
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

      // Pin the speech path instead of inheriting device/browser music defaults:
      // mono voice encoding plus AEC/ANS/AGC gives ASR a stable, echo-free signal.
      mic = await AgoraRTC.createMicrophoneAudioTrack({
        AEC: true,
        ANS: true,
        AGC: true,
        encoderConfig: 'speech_standard',
      });
      await client.join(appId, channel, conversation.rtcToken, conversation.viewerUid);
      await client.publish([mic]);

      // 3. Subscribe the transcript channel BEFORE /start. The agent publishes its
      //    greeting to an RTM channel named exactly the RTC channel; subscribing
      //    afterwards would drop it. The payloads themselves are consumed by the
      //    toolkit's own RTM listener — this call is what makes the channel live.
      releaseRtm = await rtmRef.current.subscribe(channel, () => undefined);

      const rtmClient = rtmRef.current.client;
      if (!rtmClient) throw new Error('rtm_unavailable');

      // 4. Toolkit: transcripts and agent state, bound before the agent exists.
      toolkit = await AgoraVoiceAI.init({
        rtcEngine: client as RTCEngine,
        rtmEngine: rtmClient as RTMEngine,
        renderMode: TranscriptHelperMode.TEXT,
      });

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
              role: item.metadata?.object === MessageType.USER_TRANSCRIPTION ? 'user' : 'assistant',
              text: item.text,
              language: item.metadata?.language ?? spokenLanguageRef.current,
              final: item.status === TurnStatus.END,
              products: [],
              turnId: item.turn_id,
            })),
        );

        const failed = transcription.some(
          (item) =>
            item.metadata?.object !== MessageType.USER_TRANSCRIPTION &&
            item.status === TurnStatus.END &&
            item.text.includes(CONVOAI_CATALOG_FAILURE),
        );
        const conversationId = conversationIdRef.current;
        if (failed && conversationId && !llmFallbackAttemptedRef.current) {
          llmFallbackAttemptedRef.current = true;
          void api
            .post<{ agentId: string; llmMode: string }>(
              `/api/ai/conversations/${conversationId}/llm-fallback`,
            )
            .catch(() => undefined);
        }
      });

      toolkit.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_agentUserId, event) => {
        setAgentState(event.state);
      });

      toolkit.subscribeMessage(channel);

      // 5. Only now does an agent join the channel.
      await api.post(`/api/ai/conversations/${conversation.conversationId}/start`);

      const heartbeat = window.setInterval(() => {
        void api
          .post(`/api/ai/conversations/${conversation?.conversationId}/heartbeat`)
          .catch(() => undefined);
      }, HEARTBEAT_MS);

      sessionRef.current = {
        conversationId: conversation.conversationId,
        rtcChannel: channel,
        client,
        mic,
        toolkit,
        releaseRtm,
        heartbeat,
      };

      duckRef.current?.setVolume(DUCKED_VOLUME);
      // The meter reads this track directly, so it starts moving the moment the mic
      // is live rather than when the agent first answers.
      setMicTrack(mic);
      setPhase('active');
    } catch (err) {
      // Unwind whatever was established, in reverse order.
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
          } catch {
            // Ignored: the join may never have completed.
          }
        }
        await client.leave().catch(() => undefined);
      }
      mic?.stop();
      mic?.close();
      // Nothing is speaking, so the shopper is back on the transport that always works.
      setMode('text');

      const capacityExhausted =
        err instanceof ApiError && err.status === 503 && err.code === 'ai_capacity';
      if (capacityExhausted && conversation) {
        // The row survives as this shopper's text conversation; only voice was refused.
        setCapacityNotice(VOICE_BUSY);
        setPhase('idle');
        return;
      }

      if (conversation) {
        // The row was allocated but no agent will ever run against it.
        void api
          .post(`/api/ai/conversations/${conversation.conversationId}/stop`)
          .catch(() => undefined);
        conversationIdRef.current = null;
        setConversationId(null);
      }
      setError(VOICE_FAILED);
      setPhase('error');
    }
  }, [config?.agoraAppId, phase, resolveLanguage]);

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
        const data = event.data as { conversationId?: string };
        if (data.conversationId && data.conversationId !== conversationIdRef.current) return;
        phaseRef.current = 'human_waiting';
        setHandoffNotice(
          'Your request is in the support queue. Keep this window open and your microphone on.',
        );
        setPhase('human_waiting');
        setAgentState(null);
        return;
      }
      if (event.event === EVENTS.supportAgentJoined) {
        const data = event.data as { conversationId?: string; supportUid?: number };
        if (data.conversationId && data.conversationId !== conversationIdRef.current) return;
        supportUidRef.current = data.supportUid ?? null;
        if (phaseRef.current !== 'human_active') {
          setHandoffNotice('A support agent joined. Connecting their audio…');
        }
        return;
      }
      if (event.event === EVENTS.supportCallEnded) {
        const data = event.data as { conversationId?: string };
        if (data.conversationId && data.conversationId !== conversationIdRef.current) return;
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
    [teardownMedia],
  );

  useServerEvents({ enabled: conversationId !== null, onEvent: onSupportEvent });

  // Unmount and tab close must both release the agent slot and the AI channel.
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

  const textLines: AssistantLine[] = textAssist.messages.map((message) => ({
    key: message.id,
    role: message.role,
    text: message.text,
    language: message.language,
    final: true,
    products: message.products,
    turnId: null,
  }));

  // One transcript for both transports: the voice block sits where it happened,
  // between the text turns that preceded it and any typed afterwards.
  const lines: AssistantLine[] =
    voiceLines.length === 0
      ? textLines
      : [...textLines.slice(0, voiceAnchor), ...voiceLines, ...textLines.slice(voiceAnchor)];

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
    available: Boolean(config?.features.convoai && config?.agoraAppId),
    micTrack,
    start,
    stop,
    textAssist,
  };
};
