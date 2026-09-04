import type { useVoiceAgent } from '../../ai/useVoiceAgent';
import type { useChat } from '../../hooks/useChat';
import type { useLiveSession } from '../../hooks/useLiveSession';
import type { ComposerMode, QuotedLine } from './RoomConversation';
import type { LiveSessionDto } from '@shop/shared';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { PanelRightClose } from 'lucide-react';
import { forwardRef, useRef } from 'react';

import { AssistantPanel } from '../../ai/AssistantPanel';
import { AskIcon, ChatIcon, GridIcon } from '../icons';
import { RoomConversation } from './RoomConversation';
import { SessionProductRail } from './SessionProductRail';

type LiveSession = ReturnType<typeof useLiveSession>;
type Chat = ReturnType<typeof useChat>;
type Agent = ReturnType<typeof useVoiceAgent>;
export type RoomTab = 'chat' | 'products' | 'ask';
const SEGMENTS: readonly {
    id: RoomTab;
    label: string;
    icon: JSX.Element;
}[] = [
    { id: 'chat', label: 'Chat', icon: <ChatIcon className="h-4 w-4" /> },
    { id: 'products', label: 'Shop', icon: <GridIcon className="h-4 w-4" /> },
    { id: 'ask', label: 'Ask Ago', icon: <AskIcon className="h-4 w-4" /> },
];
export const LiveRoomSidebar = forwardRef<
    HTMLElement,
    {
        session: LiveSessionDto;
        live: LiveSession;
        isLive: boolean;
        offline: boolean;
        readOnly: boolean;
        chat: Chat;
        agent: Agent;
        user: unknown;
        tab: RoomTab;
        onTabChange: (tab: RoomTab) => void;
        chatCollapsed: boolean;
        onChatCollapsedChange: (collapsed: boolean) => void;
        composerMode: ComposerMode;
        onComposerModeChange: (mode: ComposerMode) => void;
        quoted: QuotedLine | null;
        onQuotedChange: (quoted: QuotedLine | null) => void;
        onAskAbout: (quoted: QuotedLine) => void;
        assistantSeedPrompt: string | null;
        onAssistantSeedPromptConsumed: () => void;
        liveAssistantExamples: string[];
        duckTrack: Parameters<typeof AssistantPanel>[0]['duckTrack'];
        chatState: string;
        chatDot: string;
    }
>(function LiveRoomSidebar(
    {
        session,
        live,
        isLive,
        offline,
        readOnly,
        chat,
        agent,
        user,
        tab,
        onTabChange,
        chatCollapsed,
        onChatCollapsedChange,
        composerMode,
        onComposerModeChange,
        quoted,
        onQuotedChange,
        onAskAbout,
        assistantSeedPrompt,
        onAssistantSeedPromptConsumed,
        liveAssistantExamples,
        duckTrack,
        chatState,
        chatDot,
    },
    ref,
): JSX.Element {
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const tabIndex = SEGMENTS.findIndex((segment) => segment.id === tab);
    const onSegmentKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const step =
            event.key === 'ArrowRight'
                ? 1
                : event.key === 'ArrowLeft'
                  ? -1
                  : event.key === 'Home'
                    ? -tabIndex
                    : event.key === 'End'
                      ? SEGMENTS.length - 1 - tabIndex
                      : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = (tabIndex + step + SEGMENTS.length) % SEGMENTS.length;
        const target = SEGMENTS[next];
        if (target === undefined) return;
        onTabChange(target.id);
        tabRefs.current[next]?.focus();
    };
    return (
        <aside
            ref={ref}
            className={`absolute inset-x-0 bottom-0 z-50 max-h-[75%] min-h-[24rem] min-w-0 flex-col rounded-t-panel border-t border-line bg-surface shadow-float lg:static lg:max-h-none lg:min-h-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none ${chatCollapsed ? 'hidden' : 'flex'}`}
        >
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
                <p className="text-14 font-semibold text-t1">Live room</p>
                <div className="flex items-center gap-3">
                    {chatState !== '' && (
                        <span className="flex items-center gap-1.5 text-12 font-medium text-t3">
                            <span
                                className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-danger' : chatDot}`}
                            />
                            {chatState}
                        </span>
                    )}
                    <button
                        type="button"
                        aria-label="Collapse room sidebar"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-t2 hover:bg-canvas lg:hidden"
                        onClick={() => onChatCollapsedChange(true)}
                    >
                        <PanelRightClose className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5">
                <div
                    role="tablist"
                    aria-label="Live room panels"
                    onKeyDown={onSegmentKeyDown}
                    className="relative flex min-w-0 flex-1"
                >
                    {SEGMENTS.map((segment, index) => (
                        <button
                            key={segment.id}
                            ref={(node) => {
                                tabRefs.current[index] = node;
                            }}
                            type="button"
                            role="tab"
                            id={`room-tab-${segment.id}`}
                            aria-selected={tab === segment.id}
                            aria-controls={`room-panel-${segment.id}`}
                            tabIndex={tab === segment.id ? 0 : -1}
                            onClick={() => onTabChange(segment.id)}
                            className={`flex h-11 flex-1 items-center justify-center gap-1.5 px-2 text-13 font-medium transition-colors duration-ctl ${tab === segment.id ? 'text-t1' : 'text-t2 hover:text-t1'}`}
                        >
                            {segment.icon}
                            <span className="truncate">{segment.label}</span>
                            {segment.id === 'products' && live.pinnedProductId !== null && (
                                <span
                                    aria-label="a product is featured now"
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                                />
                            )}
                        </button>
                    ))}
                    <span
                        aria-hidden
                        className="absolute bottom-0 left-0 h-0.5 bg-accent transition-transform duration-ctl ease-out"
                        style={{
                            width: `${100 / SEGMENTS.length}%`,
                            transform: `translateX(${tabIndex * 100}%)`,
                        }}
                    />
                </div>
                {chatState !== '' && (
                    <span className="flex shrink-0 items-center gap-1.5 pr-1 text-12 font-medium text-t3 lg:hidden">
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${offline ? 'bg-danger' : chatDot}`}
                        />
                        {chatState}
                    </span>
                )}
            </div>

            <div
                role="tabpanel"
                id="room-panel-chat"
                aria-labelledby="room-tab-chat"
                hidden={tab !== 'chat'}
                className={`min-h-0 flex-1 ${tab === 'chat' ? 'flex' : 'hidden'}`}
            >
                <RoomConversation
                    chat={chat}
                    agent={agent}
                    canSend={isLive && Boolean(user) && chat.status === 'ready' && !offline}
                    signedIn={Boolean(user)}
                    readOnly={readOnly}
                    mode={composerMode}
                    onModeChange={onComposerModeChange}
                    quoted={quoted}
                    onQuotedChange={onQuotedChange}
                    assistantEnabled={false}
                    onAskAbout={onAskAbout}
                    contextNote={`the ${session.products.length} product${session.products.length === 1 ? '' : 's'} in this show`}
                    liveSessionId={isLive ? session.id : null}
                    emptyHint={
                        offline
                            ? 'You are offline. The room reopens as soon as the connection is back.'
                            : isLive
                              ? undefined
                              : session.status === 'scheduled'
                                ? 'Chat opens when the host goes live.'
                                : 'Chat from this show is in the replay.'
                    }
                    className="min-h-0 w-full flex-1"
                />
            </div>
            <div
                role="tabpanel"
                id="room-panel-ask"
                aria-labelledby="room-tab-ask"
                hidden={tab !== 'ask'}
                className={`min-h-0 flex-1 ${tab === 'ask' ? 'flex' : 'hidden'}`}
            >
                {tab === 'ask' && (
                    <AssistantPanel
                        surface="live"
                        liveSessionId={session.id}
                        productId={live.pinnedProductId}
                        duckTrack={duckTrack}
                        contextLabel={session.title}
                        examples={liveAssistantExamples}
                        seamless
                        seedPrompt={assistantSeedPrompt}
                        onSeedPromptConsumed={onAssistantSeedPromptConsumed}
                        onClose={() => onTabChange('chat')}
                        className="min-h-0 w-full flex-1"
                    />
                )}
            </div>

            <div
                role="tabpanel"
                id="room-panel-products"
                aria-labelledby="room-tab-products"
                hidden={tab !== 'products'}
                className={`scroll-thin min-h-0 flex-1 overflow-y-auto px-2.5 ${tab === 'products' ? 'block' : 'hidden'}`}
            >
                {tab === 'products' && (
                    <SessionProductRail
                        sessionId={session.id}
                        products={session.products}
                        pinnedProductId={live.pinnedProductId}
                        live={isLive}
                        signedIn={Boolean(user)}
                        variant="responsive"
                        seamless
                    />
                )}
            </div>
        </aside>
    );
});
