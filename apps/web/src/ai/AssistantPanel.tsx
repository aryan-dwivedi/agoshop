import type { AssistantLine } from './useVoiceAgent';
import type { Surface } from '@shop/shared';
import type { IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

import { AgentState } from 'agora-agent-client-toolkit';
import { useEffect, useRef, useState } from 'react';

import { AgoAvatar, type AgoAvatarState } from './AgoAvatar';
import { AssistantHistoryDrawer } from './AssistantHistoryDrawer';
import { AssistantMessageList } from './AssistantMessageList';
import { AssistantVoiceDock } from './AssistantVoiceDock';
import { ASSISTANT_EXAMPLES } from './browseExamples';
import { MicWaveform } from './MicWaveform';
import { useAssistantEvents } from './useAssistantEvents';
import { isToolProtocolText, useVoiceAgent } from './useVoiceAgent';

import {
    AudioLinesIcon,
    CloseIcon,
    HistoryIcon,
    LockIcon,
    MicIcon,
    SendIcon,
} from '../components/icons';
import { useSession } from '../state/session';

const STILL_LOOKING_MS = 4000;
const MAX_SESSION_HISTORY_LINES = 100;

const isAssistantLine = (value: unknown): value is AssistantLine => {
    if (value === null || typeof value !== 'object') return false;
    const line = value as Partial<AssistantLine>;
    return (
        typeof line.key === 'string' &&
        (line.role === 'user' || line.role === 'assistant') &&
        typeof line.text === 'string' &&
        (line.role !== 'assistant' || !isToolProtocolText(line.text)) &&
        typeof line.language === 'string' &&
        typeof line.final === 'boolean' &&
        Array.isArray(line.products) &&
        (line.turnId === null || typeof line.turnId === 'number')
    );
};
const readSessionHistory = (key: string): AssistantLine[] => {
    try {
        const parsed: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? '[]');
        return Array.isArray(parsed)
            ? parsed.filter(isAssistantLine).slice(-MAX_SESSION_HISTORY_LINES)
            : [];
    } catch {
        return [];
    }
};
const mergeSessionHistory = (
    existing: readonly AssistantLine[],
    incoming: readonly AssistantLine[],
): AssistantLine[] => {
    const merged = [...existing];
    const indexByKey = new Map(merged.map((line, index) => [line.key, index]));
    for (const line of incoming) {
        const index = indexByKey.get(line.key);
        if (index === undefined) {
            indexByKey.set(line.key, merged.length);
            merged.push(line);
        } else {
            merged[index] = line;
        }
    }
    return merged.slice(-MAX_SESSION_HISTORY_LINES);
};
const writeSessionHistory = (key: string, lines: readonly AssistantLine[]): void => {
    try {
        window.sessionStorage.setItem(key, JSON.stringify(lines));
    } catch {}
};
const headerAvatarState = (
    thinking: boolean,
    listening: boolean,
    voiceCall: boolean,
    agentState: AgentState | null,
): AgoAvatarState => {
    if (thinking || agentState === AgentState.THINKING) return 'thinking';
    if (listening || agentState === AgentState.LISTENING) return 'listening';
    if (voiceCall && agentState === AgentState.SPEAKING) return 'speaking';
    return 'idle';
};
const statusLabel = ({
    thinking,
    listening,
    voiceConnecting,
    humanWaiting,
    humanActive,
    agentState,
}: {
    thinking: boolean;
    listening: boolean;
    voiceConnecting: boolean;
    humanWaiting: boolean;
    humanActive: boolean;
    agentState: AgentState | null;
}): string => {
    if (humanWaiting) return 'Finding support';
    if (humanActive) return 'Support live';
    if (voiceConnecting) return 'Connecting';
    if (thinking) return 'Thinking';
    if (listening) return 'Listening';
    if (agentState === AgentState.SPEAKING) return 'Speaking';
    return 'Ready';
};

export const AssistantPanel = ({
    surface,
    liveSessionId,
    productId,
    duckTrack,
    contextLabel,
    onClose,
    className,
    seamless = false,
    seedPrompt,
    onSeedPromptConsumed,
    examples,
}: {
    surface: Surface;
    liveSessionId?: string | null;
    productId?: string | null;
    duckTrack?: IRemoteAudioTrack | null;
    contextLabel?: string;
    onClose?: () => void;
    className?: string;
    seamless?: boolean;
    seedPrompt?: string | null;
    onSeedPromptConsumed?: () => void;
    examples?: readonly string[];
}): JSX.Element => {
    const { user } = useSession();
    const [draft, setDraft] = useState('');
    const [historyOpen, setHistoryOpen] = useState(false);
    const transcriptRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const contextScope =
        contextLabel ??
        (surface === 'live' ? 'This show' : surface === 'replay' ? 'This replay' : null);
    const scoped = contextScope !== null;
    const historyScope = liveSessionId ? `session:${liveSessionId}` : `surface:${surface}`;
    const historyKey = `ask-ago-history:v1:${user?.id ?? 'guest'}:${historyScope}`;

    const agent = useVoiceAgent({
        surface,
        liveSessionId: scoped ? liveSessionId : null,
        productId: scoped ? productId : null,
        duckTrack,
    });
    const dictation = agent.textAssist.dictation;
    const { lines: activeLines } = useAssistantEvents({
        conversationId: agent.conversationId,
        lines: agent.lines,
    });
    const [sessionHistory, setSessionHistory] = useState<{
        key: string;
        lines: AssistantLine[];
    }>(() => ({ key: historyKey, lines: readSessionHistory(historyKey) }));
    const lines = sessionHistory.key === historyKey ? sessionHistory.lines : [];

    useEffect(() => {
        setSessionHistory((current) =>
            current.key === historyKey
                ? current
                : { key: historyKey, lines: readSessionHistory(historyKey) },
        );
    }, [historyKey]);
    useEffect(() => {
        if (activeLines.length === 0) return;
        setSessionHistory((current) => ({
            key: historyKey,
            lines: mergeSessionHistory(
                current.key === historyKey ? current.lines : readSessionHistory(historyKey),
                activeLines,
            ),
        }));
    }, [activeLines, historyKey]);
    useEffect(() => {
        if (sessionHistory.key === historyKey) {
            writeSessionHistory(historyKey, sessionHistory.lines);
        }
    }, [historyKey, sessionHistory]);

    const firstName =
        user !== null && !user.isGuest
            ? (user.displayName.trim().split(/\s+/)[0] ?? 'there')
            : 'there';
    const starterPrompts = examples ?? ASSISTANT_EXAMPLES[surface];
    const recentPrompts = lines
        .filter((line) => line.role === 'user')
        .slice(-8)
        .reverse();

    const humanWaiting = agent.phase === 'human_waiting';
    const humanActive = agent.phase === 'human_active';
    const voiceConnecting =
        agent.phase === 'starting' || humanWaiting;
    const voiceBusy =
        humanWaiting ||
        humanActive ||
        (agent.mode === 'voice' &&
            (agent.phase === 'starting' || agent.phase === 'active'));
    const voiceCall = agent.mode === 'voice' && (agent.phase === 'active' || humanActive);
    const micLive = voiceBusy || dictation.listening;
    const thinking =
        agent.textPending ||
        agent.textAssist.pending ||
        (agent.phase === 'active' && agent.agentState === AgentState.THINKING);
    const listening =
        dictation.listening ||
        (voiceBusy && (agent.agentState === null || agent.agentState === AgentState.LISTENING));

    const [stillLooking, setStillLooking] = useState(false);
    useEffect(() => {
        if (!thinking) {
            setStillLooking(false);
            return undefined;
        }
        const timer = window.setTimeout(() => setStillLooking(true), STILL_LOOKING_MS);
        return () => window.clearTimeout(timer);
    }, [thinking]);

    const [callStartedAt, setCallStartedAt] = useState<number | null>(null);
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        setCallStartedAt(voiceCall ? Date.now() : null);
    }, [voiceCall]);
    useEffect(() => {
        if (callStartedAt === null) {
            setElapsed(0);
            return undefined;
        }
        const tick = window.setInterval(() => {
            setElapsed(Math.floor((Date.now() - callStartedAt) / 1000));
        }, 500);
        return () => window.clearInterval(tick);
    }, [callStartedAt]);

    useEffect(() => {
        const el = transcriptRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [lines, thinking, voiceBusy, dictation.interim]);

    useEffect(() => {
        if (!seedPrompt) return;
        setDraft(seedPrompt);
        onSeedPromptConsumed?.();
    }, [seedPrompt, onSeedPromptConsumed]);
    useEffect(() => {
        inputRef.current?.focus({ preventScroll: true });
    }, []);

    const stopMic = (): void => {
        if (dictation.listening) dictation.stop();
        if (voiceBusy) void agent.stop();
    };
    const escapeRef = useRef<() => void>(() => undefined);
    escapeRef.current = () => {
        if (historyOpen) {
            setHistoryOpen(false);
            return;
        }
        if (micLive) {
            stopMic();
            return;
        }
        onClose?.();
    };
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') escapeRef.current();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    const spokenBase = agent.spokenLanguage.toLowerCase().split('-')[0] ?? 'en';
    const notice = agent.capacityNotice ?? agent.handoffNotice ?? agent.error;
    const sendText = async (text: string): Promise<void> => {
        if (text.trim().length === 0 || agent.textPending || agent.textAssist.pending) return;
        await agent.sendText(text);
    };
    const clearHistory = (): void => {
        setSessionHistory({ key: historyKey, lines: [] });
        writeSessionHistory(historyKey, []);
        setHistoryOpen(false);
    };

    const avatarState = headerAvatarState(thinking, listening, voiceCall, agent.agentState);
    const status = statusLabel({
        thinking,
        listening,
        voiceConnecting,
        humanWaiting,
        humanActive,
        agentState: agent.agentState,
    });
    const voiceDockPhase =
        agent.phase === 'human_waiting' ||
        agent.phase === 'human_active' ||
        agent.phase === 'starting' ||
        agent.phase === 'active'
            ? agent.phase
            : null;

    return (
        <section
            className={`relative flex min-h-0 flex-col overflow-hidden ${seamless ? 'bg-white' : 'card bg-white'} ${className ?? ''}`}
        >
            <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
                <AgoAvatar
                    size="md"
                    state={avatarState}
                />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <h2 className="font-display text-19 font-bold tracking-[-0.02em] text-t1">
                            Ask Ago
                        </h2>
                        {contextScope && (
                            <span className="max-w-[12rem] truncate rounded-full bg-surface px-2 py-0.5 text-11 font-medium text-t2">
                                {contextScope}
                            </span>
                        )}
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-12 text-t3">
                        <span
                            aria-hidden
                            className={`h-1.5 w-1.5 rounded-full ${
                                thinking || listening || voiceCall
                                    ? 'animate-breathe bg-accent'
                                    : 'bg-t3'
                            }`}
                        />
                        {status}
                        {(surface === 'live' || surface === 'replay') && (
                            <>
                                <span className="text-line-ctl">·</span>
                                <LockIcon className="h-3 w-3" />
                                Only you
                            </>
                        )}
                    </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                    <button
                        type="button"
                        aria-label="Conversation history"
                        aria-expanded={historyOpen}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-t2 transition hover:bg-surface hover:text-t1"
                        onClick={() => setHistoryOpen((open) => !open)}
                    >
                        <HistoryIcon className="h-5 w-5" />
                    </button>
                    {onClose && (
                        <button
                            type="button"
                            aria-label="Close"
                            title="Close (Esc)"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-t2 transition hover:bg-surface hover:text-t1"
                            onClick={() => {
                                if (micLive) stopMic();
                                onClose();
                            }}
                        >
                            <CloseIcon className="h-5 w-5" />
                        </button>
                    )}
                </div>
            </header>

            {voiceBusy && voiceDockPhase ? (
                <AssistantVoiceDock
                    phase={voiceDockPhase}
                    agentState={agent.agentState}
                    humanWaiting={humanWaiting}
                    humanActive={humanActive}
                    elapsed={elapsed}
                    micTrack={agent.micTrack}
                    handoffNotice={
                        humanWaiting || humanActive ? agent.handoffNotice : null
                    }
                    supportAudioReady={agent.supportAudioReady}
                    onResumeSupportAudio={agent.resumeSupportAudio}
                    onEnd={() => void agent.stop()}
                    ducking={Boolean(duckTrack)}
                />
            ) : null}

            <div
                ref={transcriptRef}
                aria-live="polite"
                className="min-h-0 flex-1 overflow-y-auto px-4 py-5 scroll-thin"
            >
                <AssistantMessageList
                    lines={lines}
                    firstName={firstName}
                    starterPrompts={starterPrompts}
                    spokenBase={spokenBase}
                    thinking={thinking}
                    stillLooking={stillLooking}
                    dictationInterim={dictation.interim}
                    scoped={scoped}
                    surface={surface}
                    liveSessionId={liveSessionId}
                    onPrompt={(text) => void sendText(text)}
                    promptsDisabled={agent.textPending || agent.textAssist.pending}
                    showPrivateHint={surface === 'live' || surface === 'replay'}
                />
            </div>

            {notice && !voiceBusy && (
                <p
                    role="status"
                    className="mx-4 mb-2 shrink-0 rounded-ctl border border-[#f5d97a] bg-[#fff8df] px-3 py-2 text-13 text-t2"
                >
                    {notice}
                </p>
            )}

            <form
                className="m-3 mt-0 flex shrink-0 flex-col gap-2"
                onSubmit={(event) => {
                    event.preventDefault();
                    const text = draft;
                    setDraft('');
                    void sendText(text);
                }}
            >
                <div className="flex items-end gap-2 rounded-[1.25rem] border border-line bg-white p-2 shadow-[0_8px_24px_rgb(0_30_96/0.08)]">
                    <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
                        <input
                            ref={inputRef}
                            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-14 text-t1 outline-none placeholder:text-t3"
                            aria-label="Ask Ago anything"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder={
                                dictation.listening
                                    ? 'Listening…'
                                    : voiceBusy
                                      ? 'Type to switch from voice…'
                                      : 'Ask about products, delivery, or your cart…'
                            }
                        />
                    </div>

                    {(agent.available || dictation.supported) && (
                        <button
                            type="button"
                            aria-label={
                                micLive
                                    ? 'Stop voice'
                                    : agent.available
                                      ? 'Start voice chat'
                                      : 'Dictate a question'
                            }
                            title={
                                agent.available
                                    ? 'Start live voice'
                                    : 'Dictate your question'
                            }
                            aria-pressed={micLive}
                            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition ${
                                micLive
                                    ? 'bg-accent text-accent-ink'
                                    : 'border border-line-ctl text-accent hover:bg-accent-wash'
                            }`}
                            onClick={() => {
                                if (micLive) {
                                    stopMic();
                                    return;
                                }
                                if (agent.available) void agent.start();
                                else dictation.start();
                            }}
                        >
                            {dictation.listening ? (
                                <MicWaveform
                                    track={agent.micTrack}
                                    className="text-accent-ink"
                                />
                            ) : agent.available ? (
                                <AudioLinesIcon className="h-5 w-5" />
                            ) : (
                                <MicIcon className="h-5 w-5" />
                            )}
                        </button>
                    )}

                    <button
                        type="submit"
                        aria-label="Send"
                        title="Send"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#001e60] text-white transition hover:bg-[#003b73] disabled:cursor-not-allowed disabled:bg-[#c7ced8]"
                        disabled={
                            agent.textPending ||
                            agent.textAssist.pending ||
                            draft.trim().length === 0
                        }
                    >
                        <SendIcon className="h-5 w-5" />
                    </button>
                </div>

                {agent.available && !voiceBusy && (
                    <p className="px-2 text-center text-11 text-t3">
                        Tap the waveform to talk instead of typing
                    </p>
                )}
            </form>

            <AssistantHistoryDrawer
                open={historyOpen}
                prompts={recentPrompts}
                onSelect={(text) => {
                    setDraft(text);
                    inputRef.current?.focus();
                }}
                onClose={() => setHistoryOpen(false)}
                onClear={clearHistory}
            />
        </section>
    );
};
