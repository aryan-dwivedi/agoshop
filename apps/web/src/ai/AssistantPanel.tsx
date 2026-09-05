import type { AssistantLine } from './useVoiceAgent';
import type { Surface } from '@shop/shared';
import type { ILocalAudioTrack, IRemoteAudioTrack } from 'agora-rtc-sdk-ng';

import { AgentState } from 'agora-agent-client-toolkit';
import { useEffect, useRef, useState } from 'react';

import { languageLabel } from '@shop/shared';

import {
    AudioLinesIcon,
    CloseIcon,
    HistoryIcon,
    LockIcon,
    MicIcon,
    SendIcon,
    SparklesIcon,
} from '../components/icons';
import { useSession } from '../state/session';
import { AssistantProducts } from './AssistantProducts';
import { AssistantText } from './AssistantText';
import { ASSISTANT_EXAMPLES } from './browseExamples';
import { useAssistantEvents } from './useAssistantEvents';
import { useMicLevel } from './useMicLevel';
import { isToolProtocolText, useVoiceAgent } from './useVoiceAgent';

type PanelState = 'collapsed' | 'expanded' | 'listening' | 'thinking' | 'voice-call';
const AGENT_WORD: Record<AgentState, string> = {
    [AgentState.IDLE]: 'Idle',
    [AgentState.LISTENING]: 'Listening',
    [AgentState.THINKING]: 'Thinking',
    [AgentState.SPEAKING]: 'Speaking',
    [AgentState.SILENT]: 'Idle',
};
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
const MicMeter = ({ track }: { track: ILocalAudioTrack | null }): JSX.Element => {
    const level = useMicLevel(track);
    if (level === null) return <MicIcon className="h-4 w-4" />;
    return (
        <span
            className="flex items-center gap-[3px]"
            aria-hidden="true"
        >
            {[2.4, 3.2, 1.9].map((gain, index) => (
                <span
                    key={index}
                    className="h-4 w-[3px] rounded-full bg-current"
                    style={{
                        transform: `scaleY(${Math.max(0.14, Math.min(1, level * gain))})`,
                    }}
                />
            ))}
        </span>
    );
};
const AgoMark = ({ className = 'h-9 w-9' }: { className?: string }): JSX.Element => (
    <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-full bg-[#ffc220] text-[#001e60] shadow-sm ${className}`}
    >
        <svg
            viewBox="0 0 32 32"
            className="h-3/4 w-3/4"
            fill="none"
        >
            <circle
                cx="11"
                cy="12"
                r="1.7"
                fill="currentColor"
            />
            <circle
                cx="21"
                cy="12"
                r="1.7"
                fill="currentColor"
            />
            <path
                d="M9 19c2.2 3.5 11.8 3.5 14 0"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
            />
            <path
                d="M16 3v3M4.7 7.7l2.2 2.1M27.3 7.7l-2.2 2.1"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
            />
        </svg>
    </span>
);
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
    const { config, user } = useSession();
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
        .slice(-6)
        .reverse();
    let latestAssistantLine: (typeof lines)[number] | null = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (line?.role === 'assistant') {
            latestAssistantLine = line;
            break;
        }
    }
    const humanWaiting = agent.phase === 'human_waiting';
    const humanActive = agent.phase === 'human_active';
    const voiceBusy =
        humanWaiting ||
        humanActive ||
        (agent.mode === 'voice' &&
            (agent.phase === 'starting' ||
                agent.phase === 'active'));
    const voiceCall = agent.mode === 'voice' && (agent.phase === 'active' || humanActive);
    const micLive = voiceBusy || dictation.listening;
    const thinking =
        agent.textPending ||
        agent.textAssist.pending ||
        (agent.phase === 'active' && agent.agentState === AgentState.THINKING);
    const listening =
        dictation.listening ||
        (voiceBusy && (agent.agentState === null || agent.agentState === AgentState.LISTENING));
    const state: PanelState = thinking
        ? 'thinking'
        : listening
          ? 'listening'
          : voiceCall
            ? 'voice-call'
            : 'expanded';
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
    }, [lines, thinking, voiceBusy]);
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
    const spokenBase = agent.spokenLanguage.toLowerCase().split('-')[0];
    const notice = agent.capacityNotice ?? agent.handoffNotice ?? agent.error;
    const sendText = async (text: string): Promise<void> => {
        if (text.trim().length === 0 || agent.textPending || agent.textAssist.pending) return;
        await agent.sendText(text);
    };
    const minutes = Math.floor(elapsed / 60)
        .toString()
        .padStart(2, '0');
    const seconds = (elapsed % 60).toString().padStart(2, '0');
    return (
        <section
            data-state={state}
            className={`relative flex min-h-0 flex-col overflow-hidden ${seamless ? 'bg-white' : 'card bg-white'} ${className ?? ''}`}
        >
            <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line px-4">
                <h2 className="shrink-0 font-display text-19 font-bold tracking-[-0.02em] text-t1">
                    Ask Ago
                </h2>
                <span className="inline-flex items-center gap-1 rounded-md bg-[#e6f1fc] px-2 py-1 text-13 font-semibold text-accent-text">
                    <SparklesIcon className="h-3.5 w-3.5" />
                    AI
                </span>
                {(surface === 'live' || surface === 'replay') && (
                    <span className="hidden items-center gap-1 text-11 text-t3 sm:inline-flex">
                        <LockIcon className="h-3 w-3" />
                        Only you
                    </span>
                )}
                <span className="min-w-0 flex-1" />
                <button
                    type="button"
                    aria-label="Conversation history"
                    aria-expanded={historyOpen}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-t1 transition hover:bg-surface"
                    onClick={() => setHistoryOpen((open) => !open)}
                >
                    <HistoryIcon className="h-6 w-6" />
                </button>
                {onClose && (
                    <button
                        type="button"
                        aria-label="Close"
                        title="Close (Esc)"
                        className="flex h-10 w-10 items-center justify-center rounded-full text-t1 transition hover:bg-surface"
                        onClick={() => {
                            if (micLive) stopMic();
                            onClose();
                        }}
                    >
                        <CloseIcon className="h-6 w-6" />
                    </button>
                )}
            </header>

            {historyOpen && (
                <aside className="absolute inset-x-3 top-[4.5rem] z-30 max-h-72 overflow-y-auto rounded-panel border border-line bg-white p-2 shadow-sheet">
                    <div className="flex items-center justify-between px-2 py-1.5">
                        <p className="text-13 font-bold text-t1">Recent questions</p>
                        <button
                            type="button"
                            className="text-13 font-semibold text-accent-text"
                            onClick={() => setHistoryOpen(false)}
                        >
                            Done
                        </button>
                    </div>
                    {recentPrompts.length === 0 ? (
                        <p className="px-2 py-5 text-center text-13 text-t3">
                            Your questions will appear here.
                        </p>
                    ) : (
                        <ul className="space-y-1">
                            {recentPrompts.map((line) => (
                                <li key={line.key}>
                                    <button
                                        type="button"
                                        className="w-full rounded-ctl px-3 py-2 text-left text-13 text-t2 hover:bg-surface hover:text-t1"
                                        onClick={() => {
                                            setDraft(line.text);
                                            setHistoryOpen(false);
                                            inputRef.current?.focus();
                                        }}
                                    >
                                        <span className="line-clamp-2">{line.text}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </aside>
            )}

            {voiceBusy ? (
                <div className="relative flex min-h-0 flex-1 flex-col items-center overflow-hidden bg-[radial-gradient(circle_at_50%_38%,#e6f1fc_0%,#ffffff_58%,#fff8df_100%)] px-6 py-8">
                    <div className="text-center">
                        <p className="tnum text-13 font-semibold text-t3">
                            {agent.phase === 'starting'
                                ? 'Connecting'
                                : humanWaiting
                                  ? 'Waiting for support'
                                  : `${minutes}:${seconds}`}
                        </p>
                        <h3 className="mt-2 font-display text-23 font-bold text-t1">
                            {agent.phase === 'starting'
                                ? 'Starting voice chat…'
                                : humanWaiting
                                  ? 'Finding a support agent'
                                  : humanActive
                                    ? 'Support agent connected'
                                    : agent.agentState === null
                                      ? 'I’m listening'
                                      : AGENT_WORD[agent.agentState]}
                        </h3>
                        <p className="mt-1 text-13 text-t2">
                            {humanWaiting
                                ? 'Keep this window open. Your microphone stays ready for the handoff.'
                                : humanActive
                                  ? 'You are on a private voice call. Speak normally.'
                                  : 'Speak naturally — I’ll respond when you pause.'}
                        </p>
                        {(humanWaiting || humanActive) && agent.handoffNotice ? (
                            <div
                                role="status"
                                className="mt-4 rounded-panel bg-white/85 px-4 py-3 text-13 font-semibold text-accent shadow-sm"
                            >
                                <p>{agent.handoffNotice}</p>
                                {agent.supportAudioReady ? (
                                    <button
                                        type="button"
                                        className="btn-standard btn-sm mt-2"
                                        onClick={agent.resumeSupportAudio}
                                    >
                                        Play support audio
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <div className="relative my-auto flex h-56 w-56 items-center justify-center">
                        <span className="absolute inset-0 animate-pulse rounded-full bg-[#0071dc]/10" />
                        <span className="absolute inset-6 animate-breathe rounded-full bg-[#7fbdf4]/20" />
                        <span className="absolute inset-12 rounded-full bg-gradient-to-br from-[#0071dc] via-[#4d9de0] to-[#8b5cf6] shadow-[0_24px_70px_rgb(0_113_220/0.34)]" />
                        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/95 text-accent">
                            <MicMeter track={agent.micTrack} />
                        </span>
                    </div>

                    {lines.some((line) => line.turnId !== null) && (
                        <div
                            ref={transcriptRef}
                            aria-live="polite"
                            className="mb-6 max-h-[45%] w-full space-y-3 overflow-y-auto rounded-panel bg-white/80 p-4 shadow-sm backdrop-blur scroll-thin"
                        >
                            {lines
                                .filter((line) => line.turnId !== null)
                                .map((line) => (
                                    <div
                                        key={line.key}
                                        className={
                                            line.role === 'user'
                                                ? 'text-right text-t1'
                                                : 'text-left text-t2'
                                        }
                                    >
                                        <p className="text-11 font-bold uppercase tracking-wide text-t3">
                                            {line.role === 'user' ? 'You' : 'Ago'}
                                        </p>
                                        {line.role === 'assistant' ? (
                                            <div className="text-14">
                                                <AssistantText text={line.text} />
                                            </div>
                                        ) : (
                                            <p className="text-14">{line.text}</p>
                                        )}
                                        {line.products.length > 0 && (
                                            <AssistantProducts
                                                products={line.products}
                                                liveSessionId={
                                                    scoped && surface === 'live'
                                                        ? liveSessionId
                                                        : null
                                                }
                                            />
                                        )}
                                    </div>
                                ))}
                        </div>
                    )}

                    <button
                        type="button"
                        className="h-12 rounded-full bg-[#001e60] px-8 text-14 font-bold text-white transition hover:bg-[#003b73]"
                        onClick={() => void agent.stop()}
                    >
                        {humanWaiting || humanActive ? 'End support call' : 'End voice'}
                    </button>
                    {duckTrack && <p className="mt-3 text-11 text-t3">Show audio is lowered</p>}
                </div>
            ) : (
                <>
                    <div
                        ref={transcriptRef}
                        aria-live="polite"
                        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-6 scroll-thin"
                    >
                        {lines.length === 0 && (
                            <div className="animate-fade-in">
                                <p className="text-19 leading-relaxed text-t1">
                                    Hi {firstName},
                                    <br />
                                    What would you like to do today?
                                </p>
                                <ul className="mt-6 flex flex-col items-stretch gap-3">
                                    {starterPrompts.map((example) => (
                                        <li
                                            key={example}
                                            className="max-w-full"
                                        >
                                            <button
                                                type="button"
                                                className="group flex min-h-14 w-full items-center gap-3 rounded-full bg-gradient-to-r from-[#fff4ce] to-[#fff9e9] p-2 pr-4 text-left text-14 font-bold text-[#231f20] transition hover:-translate-y-0.5 hover:shadow-md"
                                                disabled={agent.textPending || agent.textAssist.pending}
                                                onClick={() => void sendText(example)}
                                            >
                                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-accent shadow-sm">
                                                    <SparklesIcon className="h-5 w-5" />
                                                </span>
                                                <span className="min-w-0">{example}</span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {lines.map((line) =>
                            line.role === 'user' ? (
                                <div
                                    key={line.key}
                                    className="flex flex-col items-end gap-1"
                                >
                                    <p className="animate-slide-up max-w-[88%] rounded-[18px] rounded-br-md bg-[#001e60] px-4 py-3 text-14 leading-relaxed text-white">
                                        {line.text}
                                    </p>
                                    {line.language &&
                                        line.language.toLowerCase().split('-')[0] !==
                                            spokenBase && (
                                            <span className="text-11 text-t3">
                                                Read as {languageLabel(line.language)}
                                            </span>
                                        )}
                                </div>
                            ) : (
                                <div
                                    key={line.key}
                                    className="flex items-start gap-2.5"
                                >
                                    <AgoMark />
                                    <div className="min-w-0 flex-1">
                                        <div className="animate-slide-up rounded-[18px] rounded-tl-md bg-surface px-4 py-3 text-14 leading-relaxed text-t1">
                                            <AssistantText text={line.text} />
                                        </div>
                                        {line.products.length > 0 && (
                                            <div className="mt-2">
                                                <AssistantProducts
                                                    products={line.products}
                                                    liveSessionId={
                                                        scoped && surface === 'live'
                                                            ? liveSessionId
                                                            : null
                                                    }
                                                />
                                            </div>
                                        )}
                                        {line.language &&
                                            line.language.toLowerCase().split('-')[0] !==
                                                spokenBase && (
                                                <span className="mt-1 block text-11 text-t3">
                                                    Answered in {languageLabel(line.language)}
                                                </span>
                                            )}
                                    </div>
                                </div>
                            ),
                        )}

                        {agent.textPending || agent.textAssist.pending ? (
                            <div className="animate-fade-in flex items-start gap-2.5 py-2">
                                <AgoMark />
                                <div>
                                    <p className="text-14 font-bold text-t1">
                                        {stillLooking
                                            ? 'Taking a closer look'
                                            : 'Working behind the scenes'}
                                    </p>
                                    <span
                                        className="mt-3 flex items-center gap-2"
                                        aria-label="Ask Ago is thinking"
                                    >
                                        {[0, 1, 2, 3].map((index) => (
                                            <span
                                                key={index}
                                                className="h-2 w-2 animate-breathe rounded-full bg-accent"
                                                style={{ animationDelay: `${index * 140}ms` }}
                                            />
                                        ))}
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        {dictation.interim.length > 0 && (
                            <p className="px-1 text-right text-14 italic text-t3">
                                {dictation.interim}
                            </p>
                        )}
                    </div>

                    {notice && (
                        <p
                            role="status"
                            className="mx-4 mb-2 shrink-0 rounded-ctl bg-[#fff4ce] px-3 py-2 text-13 text-t2"
                        >
                            {notice}
                        </p>
                    )}

                    <form
                        className="m-3 flex shrink-0 items-center gap-2 rounded-full border border-line bg-white p-2 shadow-[0_4px_18px_rgb(0_30_96/0.1)]"
                        onSubmit={(event) => {
                            event.preventDefault();
                            const text = draft;
                            setDraft('');
                            void sendText(text);
                        }}
                    >
                        <AgoMark className="h-10 w-10" />
                        <input
                            ref={inputRef}
                            className="h-10 min-w-0 flex-1 bg-transparent px-1 text-14 text-t1 outline-none placeholder:text-t3"
                            aria-label="Ask Ago anything"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            placeholder={dictation.listening ? 'Listening…' : 'Ask me anything'}
                        />

                        {(agent.available || dictation.supported) && (
                            <button
                                type="button"
                                aria-label={
                                    dictation.listening ? 'Stop listening' : 'Start voice mode'
                                }
                                title={agent.available ? 'Start live voice' : 'Dictate a question'}
                                aria-pressed={micLive}
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition ${dictation.listening ? 'bg-accent text-white' : 'text-accent hover:bg-accent-wash'}`}
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
                                    <MicMeter track={agent.micTrack} />
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
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#001e60] text-white transition hover:bg-[#003b73] disabled:cursor-not-allowed disabled:bg-[#c7ced8]"
                            disabled={agent.textPending || agent.textAssist.pending || draft.trim().length === 0}
                        >
                            <SendIcon className="h-5 w-5" />
                        </button>
                    </form>
                </>
            )}
        </section>
    );
};
