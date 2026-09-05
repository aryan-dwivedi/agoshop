import type { AssistantLine, UseVoiceAgentResult } from '../../ai/useVoiceAgent';
import type { UseChatResult } from '../../hooks/useChat';
import type { ChatEnvelope } from '@shop/shared';

import { AgentState } from 'agora-agent-client-toolkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { languageLabel } from '@shop/shared';

import { AssistantProducts } from '../../ai/AssistantProducts';
import { AssistantText } from '../../ai/AssistantText';
import { useAssistantEvents } from '../../ai/useAssistantEvents';
import { useSession } from '../../state/session';
import {
    AskIcon,
    ChatIcon,
    ChevronDown,
    CloseIcon,
    LockIcon,
    MicIcon,
    QuoteIcon,
    SendIcon,
    SoundOnIcon,
    StopIcon,
    UserIcon,
} from '../icons';
import { ChatProductCard } from './ChatProductCard';
import { ROLE_TAG, ROLE_TAG_CLASS, avatarTone, nameTone } from './chatIdentity';

export type ComposerMode = 'chat' | 'ai';
export type QuotedLine = {
    author: string;
    text: string;
    source: 'chat' | 'caption';
};
const AGENT_STATE: Record<
    AgentState,
    {
        label: string;
        dot: string;
        live: boolean;
    }
> = {
    [AgentState.IDLE]: { label: 'Ready', dot: 'bg-t3', live: false },
    [AgentState.LISTENING]: { label: 'Listening', dot: 'bg-accent', live: true },
    [AgentState.THINKING]: { label: 'Thinking', dot: 'bg-accent', live: true },
    [AgentState.SPEAKING]: { label: 'Speaking', dot: 'bg-success', live: true },
    [AgentState.SILENT]: { label: 'Silent', dot: 'bg-t3', live: false },
};
const EXAMPLES = [
    'What is the host showing right now?',
    'Does it deliver to 560001 with COD?',
    'Add the featured item to my cart.',
] as const;
const TypingDots = ({ className }: { className?: string }): JSX.Element => (
    <span
        className={`inline-flex items-center gap-[3px] align-middle ${className ?? ''}`}
        aria-hidden="true"
    >
        <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:180ms]" />
        <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:360ms]" />
    </span>
);
type ChatItem = {
    kind: 'chat';
    ts: number;
    key: string;
    message: ChatEnvelope;
};
type AiItem = {
    kind: 'ai';
    ts: number;
    key: string;
    line: AssistantLine;
};
type Group =
    | {
          kind: 'chat';
          key: string;
          message: ChatEnvelope;
      }
    | {
          kind: 'ai';
          key: string;
          items: AiItem[];
      };
export const RoomConversation = ({
    chat,
    agent,
    canSend,
    signedIn,
    readOnly = false,
    emptyHint,
    mode,
    onModeChange,
    quoted,
    onQuotedChange,
    onAskAbout,
    assistantEnabled = true,
    contextNote,
    liveSessionId,
    className,
}: {
    chat: UseChatResult;
    agent: UseVoiceAgentResult;
    canSend: boolean;
    signedIn: boolean;
    readOnly?: boolean;
    emptyHint?: string;
    mode: ComposerMode;
    onModeChange: (mode: ComposerMode) => void;
    quoted: QuotedLine | null;
    onQuotedChange: (quoted: QuotedLine | null) => void;
    onAskAbout?: (quoted: QuotedLine) => void;
    assistantEnabled?: boolean;
    contextNote?: string;
    liveSessionId: string | null;
    className?: string;
}): JSX.Element => {
    const { user, config } = useSession();
    const [draft, setDraft] = useState('');
    const [atBottom, setAtBottom] = useState(true);
    const [unread, setUnread] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pinnedRef = useRef(true);
    const { lines } = useAssistantEvents({
        conversationId: agent.conversationId,
        lines: agent.lines,
    });
    const stampsRef = useRef(new Map<string, number>());
    const clockRef = useRef(0);
    const aiItems = useMemo<AiItem[]>(() => {
        const stamps = stampsRef.current;
        const items: AiItem[] = [];
        for (const line of lines) {
            let ts = stamps.get(line.key);
            if (ts === undefined) {
                ts = Math.max(Date.now(), clockRef.current + 1);
                clockRef.current = ts;
                stamps.set(line.key, ts);
            }
            items.push({ kind: 'ai', ts, key: `ai-${line.key}`, line });
        }
        return items;
    }, [lines]);
    const groups = useMemo<Group[]>(() => {
        const items: (ChatItem | AiItem)[] = [
            ...chat.messages.map((message): ChatItem => ({
                kind: 'chat',
                ts: message.ts,
                key: `chat-${message.messageId}`,
                message,
            })),
            ...aiItems,
        ].sort((a, b) => a.ts - b.ts);
        const out: Group[] = [];
        for (const item of items) {
            const last = out[out.length - 1];
            if (item.kind === 'ai' && last?.kind === 'ai') {
                last.items.push(item);
                continue;
            }
            out.push(
                item.kind === 'ai'
                    ? { kind: 'ai', key: item.key, items: [item] }
                    : { kind: 'chat', key: item.key, message: item.message },
            );
        }
        return out;
    }, [chat.messages, aiItems]);
    const lastKey = groups[groups.length - 1]?.key ?? '';
    const aiTail = aiItems[aiItems.length - 1]?.line.text ?? '';
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        if (pinnedRef.current) {
            el.scrollTop = el.scrollHeight;
            return;
        }
        setUnread((count) => count + 1);
    }, [lastKey, aiTail]);
    const jumpToLatest = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        pinnedRef.current = true;
        setAtBottom(true);
        setUnread(0);
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, []);
    const quoteInto = useCallback(
        (next: QuotedLine) => {
            if (onAskAbout !== undefined) {
                onAskAbout(next);
                return;
            }
            onQuotedChange(next);
            onModeChange('ai');
            window.setTimeout(() => inputRef.current?.focus(), 0);
        },
        [onAskAbout, onModeChange, onQuotedChange],
    );
    const humanWaiting = agent.mode === 'voice' && agent.phase === 'human_waiting';
    const humanLive = agent.mode === 'voice' && agent.phase === 'human_active';
    const voiceConnecting = agent.phase === 'starting' || humanWaiting;
    const voiceLive = agent.mode === 'voice' && (agent.phase === 'active' || humanLive);
    const dictation = agent.textAssist.dictation;
    const aiMode = assistantEnabled && mode === 'ai';
    const state =
        agent.phase === 'active' && agent.agentState ? AGENT_STATE[agent.agentState] : null;
    const submit = async (): Promise<void> => {
        const text = draft.trim();
        if (text.length === 0) return;
        setDraft('');
        pinnedRef.current = true;
        if (!aiMode) {
            await chat.send(text);
            return;
        }
        const question =
            quoted === null
                ? text
                : `About this ${quoted.source === 'chat' ? 'chat message' : 'thing the host said'} — ${quoted.author}: "${quoted.text}"\n\n${text}`;
        onQuotedChange(null);
        await agent.sendText(question);
    };
    const composerDisabled = aiMode
        ? agent.textPending || agent.textAssist.pending
        : !canSend || chat.blocked !== null || !signedIn;
    return (
        <section className={`relative flex min-h-0 flex-col ${className ?? ''}`}>
            <div
                ref={scrollRef}
                onScroll={(e) => {
                    const el = e.currentTarget;
                    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                    pinnedRef.current = bottom;
                    setAtBottom(bottom);
                    if (bottom) setUnread(0);
                }}
                className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-6"
            >
                {chat.historyLoading && (
                    <div className="space-y-2 px-1">
                        {[0, 1, 2].map((i) => (
                            <div
                                key={i}
                                className="skeleton h-4"
                                style={{ width: `${80 - i * 18}%` }}
                            />
                        ))}
                    </div>
                )}

                {!chat.historyLoading && groups.length === 0 && (
                    <div className="animate-fade-in space-y-3 px-1 pt-1">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6f1fc] text-accent-text">
                            <ChatIcon className="h-5 w-5" />
                        </span>
                        <p className="text-19 leading-relaxed text-t1">
                            {emptyHint ??
                                (assistantEnabled
                                    ? 'Say hello to the room — or ask privately about anything on screen.'
                                    : 'Live chat is open. Be the first to say hello.')}
                        </p>
                        {assistantEnabled && (
                            <ul className="flex flex-col items-start gap-1.5">
                                {EXAMPLES.map((example) => (
                                    <li
                                        key={example}
                                        className="max-w-full"
                                    >
                                        <button
                                            type="button"
                                            className="chip max-w-full text-left"
                                            disabled={agent.textPending || agent.textAssist.pending}
                                            onClick={() => {
                                                onModeChange('ai');
                                                pinnedRef.current = true;
                                                void agent.sendText(example);
                                            }}
                                        >
                                            <AskIcon className="h-3.5 w-3.5 shrink-0" />
                                            <span className="min-w-0 truncate">{example}</span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {groups.map((group) =>
                    group.kind === 'chat' ? (
                        <ChatRow
                            key={group.key}
                            message={group.message}
                            own={user !== null && group.message.userId === user.id}
                            canQuote
                            onQuote={quoteInto}
                            signedIn={signedIn}
                            liveSessionId={liveSessionId}
                        />
                    ) : (
                        <AssistantBlock
                            key={group.key}
                            items={group.items}
                            liveSessionId={liveSessionId}
                        />
                    ),
                )}

                {(agent.textPending || agent.textAssist.pending) && (
                    <div className="flex items-center gap-2 px-3 py-1 text-13 text-t2">
                        <AskIcon className="h-3.5 w-3.5" />
                        Checking the catalog
                        <TypingDots />
                    </div>
                )}

                {dictation.interim.length > 0 && (
                    <p className="px-3 py-1 text-right text-13 italic text-t3">
                        {dictation.interim}
                        <TypingDots className="ml-1.5" />
                    </p>
                )}
            </div>

            {!atBottom && unread > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center">
                    <button
                        type="button"
                        onClick={jumpToLatest}
                        className="btn-standard btn-xs pointer-events-auto animate-slide-up rounded-full bg-elev"
                    >
                        <ChevronDown className="h-3.5 w-3.5" />
                        {unread} new
                    </button>
                </div>
            )}

            {chat.blocked !== null && (
                <p className="border-t border-line px-4 py-2 text-13 font-medium text-danger">
                    {chat.blocked}
                </p>
            )}
            {chat.error !== null && chat.blocked === null && !aiMode && (
                <p className="flex items-start gap-2 border-t border-line px-4 py-2 text-13 leading-relaxed text-t2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {chat.error}
                </p>
            )}
            {aiMode && agent.handoffNotice !== null && (
                <p
                    role="status"
                    className="border-t border-line bg-accent-wash px-4 py-2 text-13 text-accent"
                >
                    {agent.handoffNotice}
                </p>
            )}
            {aiMode && agent.capacityNotice !== null && (
                <p
                    role="status"
                    className="border-t border-line px-4 py-2 text-13 text-t2"
                >
                    {agent.capacityNotice}
                </p>
            )}
            {aiMode && agent.error !== null && (
                <p className="border-t border-line px-4 py-2 text-13 text-danger">{agent.error}</p>
            )}

            {readOnly ? (
                <p className="border-t border-line px-4 py-3 text-13 text-t3">
                    Read-only — this room is closed. The replay carries the full conversation.
                </p>
            ) : (
                <div className="shrink-0 border-t border-line bg-white p-3">
                    {assistantEnabled && (
                        <div className="flex items-center gap-2">
                            <div
                                role="radiogroup"
                                aria-label="Where your message goes"
                                className="relative flex flex-1 rounded-full bg-surface p-0.5"
                            >
                                <span
                                    aria-hidden
                                    className={`absolute inset-y-0.5 w-[calc(50%-2px)] rounded-full transition-all duration-ctl ease-out ${aiMode ? 'left-[calc(50%+1px)] bg-accent' : 'left-0.5 bg-elev'}`}
                                />
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={!aiMode}
                                    onClick={() => onModeChange('chat')}
                                    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-14 font-medium transition-colors duration-ctl ${aiMode ? 'text-t2 hover:text-t1' : 'text-t1'}`}
                                >
                                    Chat
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={aiMode}
                                    title="Ask Ago privately about this room"
                                    onClick={() => onModeChange('ai')}
                                    className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-14 font-medium transition-colors duration-ctl disabled:cursor-not-allowed disabled:opacity-50 ${aiMode ? 'text-accent-ink' : 'text-t2 hover:text-t1'}`}
                                >
                                    <AskIcon className="h-3.5 w-3.5" />
                                    Ask
                                </button>
                            </div>
                        </div>
                    )}

                    {aiMode && (
                        <p className="mt-2 flex items-center gap-1.5 px-1 text-11 leading-tight text-t3">
                            <LockIcon className="h-3 w-3 shrink-0" />
                            Private to you · reads this room&apos;s captions, live chat
                            {contextNote !== undefined ? ` and ${contextNote}` : ''}
                        </p>
                    )}

                    {quoted !== null && (
                        <div className="mt-2 flex animate-slide-down items-start gap-2 rounded-ctl border-l-2 border-accent bg-surface px-2.5 py-1.5">
                            <QuoteIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-t3" />
                            <p className="min-w-0 flex-1 text-13 leading-snug text-t2">
                                <span className="font-semibold text-t1">{quoted.author}</span>{' '}
                                <span className="line-clamp-2">{quoted.text}</span>
                            </p>
                            <button
                                type="button"
                                aria-label="Remove quote"
                                className="shrink-0 rounded-full p-0.5 text-t3 transition duration-ctl hover:text-t1"
                                onClick={() => onQuotedChange(null)}
                            >
                                <CloseIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    )}

                    <form
                        className="flex items-center gap-2 rounded-full border border-line bg-white p-2 shadow-[0_4px_18px_rgb(0_30_96/0.1)]"
                        onSubmit={(e) => {
                            e.preventDefault();
                            void submit();
                        }}
                    >
                        <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
                            <input
                                ref={inputRef}
                                className="h-10 min-w-0 flex-1 bg-transparent px-1 text-14 text-t1 outline-none placeholder:text-t3"
                                value={draft}
                                maxLength={aiMode ? 2000 : 240}
                                onChange={(e) => setDraft(e.target.value)}
                                aria-label={aiMode ? 'Ask about this room' : 'Message the room'}
                                placeholder={
                                    aiMode
                                        ? voiceLive || voiceConnecting
                                            ? 'Type instead — this ends the voice call'
                                            : 'Ask Ago about what is on screen…'
                                        : !signedIn
                                          ? 'Sign in to join the conversation'
                                          : chat.blocked !== null
                                            ? 'You cannot send messages here'
                                            : 'Say something to the room…'
                                }
                                disabled={composerDisabled}
                            />
                            {aiMode && dictation.supported && (
                                <button
                                    type="button"
                                    aria-label={
                                        dictation.listening
                                            ? 'Stop dictation'
                                            : 'Dictate your question'
                                    }
                                    aria-pressed={dictation.listening}
                                    title={
                                        dictation.listening
                                            ? 'Stop dictation'
                                            : `Dictate your question (${languageLabel(agent.spokenLanguage)})`
                                    }
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition duration-ctl ${
                                        dictation.listening
                                            ? 'bg-live text-live-ink'
                                            : 'text-t3 hover:bg-surface hover:text-t1'
                                    }`}
                                    onClick={() =>
                                        dictation.listening ? dictation.stop() : dictation.start()
                                    }
                                >
                                    <MicIcon
                                        className={`h-4 w-4 ${dictation.listening ? 'animate-breathe' : ''}`}
                                    />
                                </button>
                            )}
                        </div>

                        <button
                            type="submit"
                            aria-label={aiMode ? 'Ask about this room' : 'Send to the room'}
                            title={aiMode ? 'Ask about this room' : 'Send to the room'}
                            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition duration-ctl ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                                aiMode
                                    ? 'bg-accent text-accent-ink hover:bg-accent-press'
                                    : 'bg-[#001e60] text-white hover:bg-[#003b73]'
                            }`}
                            disabled={composerDisabled || draft.trim().length === 0 || chat.sending}
                        >
                            <SendIcon className="h-4 w-4" />
                        </button>
                    </form>

                    {aiMode && agent.available && (
                        <div className="mt-2 flex items-center gap-1.5">
                            {voiceLive ? (
                                <>
                                    <span className={humanLive ? 'badge-live' : 'badge-neutral'}>
                                        <span
                                            aria-hidden
                                            className={`h-1.5 w-1.5 rounded-full ${humanLive ? 'animate-breathe bg-success' : (state?.dot ?? 'bg-t3')} ${state?.live === true ? 'animate-breathe' : ''}`}
                                        />
                                        {humanLive ? 'Support live' : (state?.label ?? 'Voice')}
                                    </span>
                                    <span className="min-w-0 flex-1 text-12 text-t2">
                                        {humanLive
                                            ? 'Private support call connected. Speak normally.'
                                            : 'Speak naturally; Ago responds when you pause.'}
                                    </span>
                                    {humanLive && agent.supportAudioReady ? (
                                        <button
                                            type="button"
                                            className="btn-standard btn-xs"
                                            onClick={agent.resumeSupportAudio}
                                        >
                                            Play audio
                                        </button>
                                    ) : null}
                                    <button
                                        type="button"
                                        aria-label={
                                            humanLive
                                                ? 'End the support call'
                                                : 'End the voice conversation'
                                        }
                                        className="btn-danger btn-xs"
                                        onClick={() => void agent.stop()}
                                    >
                                        <StopIcon className="h-3 w-3" />
                                        End
                                    </button>
                                </>
                            ) : (
                                <button
                                    type="button"
                                    className="btn-standard btn-sm w-full"
                                    disabled={voiceConnecting || agent.phase === 'stopping'}
                                    onClick={() => void agent.start()}
                                >
                                    <SoundOnIcon className="h-3.5 w-3.5" />
                                    {humanWaiting
                                        ? 'Waiting for a support agent…'
                                        : voiceConnecting
                                          ? 'Connecting voice…'
                                          : 'Talk instead of typing'}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}
        </section>
    );
};
const ChatRow = ({
    message,
    own,
    canQuote,
    signedIn,
    liveSessionId,
    onQuote,
}: {
    message: ChatEnvelope;
    own: boolean;
    canQuote: boolean;
    signedIn: boolean;
    liveSessionId: string | null;
    onQuote: (quoted: QuotedLine) => void;
}): JSX.Element => {
    const tag = ROLE_TAG[message.role];
    const host = tag !== undefined;
    const initial = message.displayName.trim().charAt(0).toUpperCase();
    const text = message.text ?? '';
    return (
        <div
            className={`group/row relative flex items-start gap-2.5 py-1 ${own ? 'flex-row-reverse' : ''}`}
        >
            <span
                aria-hidden
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-12 font-semibold uppercase ${avatarTone({ host })}`}
            >
                {initial === '' ? <UserIcon className="h-4 w-4" /> : initial}
            </span>

            <div
                className={`flex min-w-0 max-w-[88%] flex-col ${own ? 'items-end' : 'items-start'}`}
            >
                <p className={`mb-1 px-1 text-11 font-semibold ${nameTone({ host })}`}>
                    {message.displayName}
                    {host && <span className={ROLE_TAG_CLASS}>{tag}</span>}
                </p>
                <div
                    className={`min-w-0 rounded-[18px] px-4 py-3 text-14 leading-relaxed ${
                        own
                            ? 'rounded-br-md bg-[#001e60] text-white'
                            : 'rounded-tl-md border border-[#d5e5f5] bg-[#e6f1fc] text-t1 shadow-sm'
                    }`}
                >
                    <p className="break-words">{text}</p>
                    {message.product !== undefined && (
                        <ChatProductCard
                            product={message.product}
                            sessionId={message.sessionId}
                            live={liveSessionId !== null}
                            signedIn={signedIn}
                            addable
                        />
                    )}
                </div>
            </div>

            {canQuote && (
                <button
                    type="button"
                    aria-label={`Ask about ${message.displayName}'s message`}
                    title="Ask about this"
                    onClick={() => onQuote({ author: message.displayName, text, source: 'chat' })}
                    className={`absolute top-0 inline-flex shrink-0 items-center gap-1 rounded-full border border-line-ctl bg-elev px-2 py-0.5 text-11 font-medium text-t2 transition duration-ctl hover:border-accent hover:text-t1 md:pointer-events-none md:opacity-0 md:group-hover/row:pointer-events-auto md:group-hover/row:opacity-100 md:focus-visible:pointer-events-auto md:focus-visible:opacity-100 ${own ? 'left-1' : 'right-1'}`}
                >
                    <QuoteIcon className="h-3 w-3" />
                    Ask
                </button>
            )}
        </div>
    );
};
const AssistantBlock = ({
    items,
    liveSessionId,
}: {
    items: AiItem[];
    liveSessionId: string | null;
}): JSX.Element => (
    <div className="animate-fade-in my-1.5 rounded-ctl border-l-2 border-accent bg-surface py-2 pl-2.5 pr-2">
        <p className="mb-1.5 flex items-center gap-1.5 text-11 font-semibold uppercase tracking-[0.08em] text-t3">
            <AskIcon className="h-3 w-3" />
            Ask Ago
            <span className="inline-flex items-center gap-1 rounded-full bg-elev px-1.5 py-px text-11 font-medium normal-case tracking-normal text-t3">
                <LockIcon className="h-2.5 w-2.5" />
                only you
            </span>
        </p>

        <div className="space-y-1.5">
            {items.map(({ key, line }) => (
                <div
                    key={key}
                    className="space-y-1.5"
                >
                    <div
                        className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                        <div
                            className={`max-w-[92%] rounded-ctl px-3 py-1.5 text-14 ${line.role === 'user' ? 'bg-accent text-accent-ink' : 'bg-elev text-t1'}`}
                        >
                            {line.role === 'user' ? line.text : <AssistantText text={line.text} />}
                            {!line.final && (
                                <TypingDots
                                    className={`ml-1.5 ${line.role === 'user' ? 'text-accent-ink' : 'text-t3'}`}
                                />
                            )}
                        </div>
                    </div>

                    {line.products.length > 0 && (
                        <AssistantProducts
                            products={line.products}
                            liveSessionId={liveSessionId}
                        />
                    )}
                </div>
            ))}
        </div>
    </div>
);
