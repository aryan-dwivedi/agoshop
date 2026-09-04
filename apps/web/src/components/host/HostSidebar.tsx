import type { useChat } from '../../hooks/useChat';
import type { ModerationNotice } from '../../hooks/useLiveSession';
import type { ChatEnvelope, LiveSessionDto, SessionProductDto } from '@shop/shared';

import { ChatPanel } from '../live/ChatPanel';
import { ModerationPanel } from '../live/ModerationPanel';
import { CoHostPanel } from './CoHostPanel';
import { ShowReadout } from './ShowReadout';

type Chat = ReturnType<typeof useChat>;
export const HostSidebar = ({
    tab,
    onTabChange,
    degradedChat,
    chat,
    isLive,
    user,
    products,
    sessionId,
    selectedMessage,
    onSelectMessage,
    onClearSelection,
    moderationNotice,
    session,
    isOwner,
    onSessionUpdated,
}: {
    tab: 'chat' | 'moderation';
    onTabChange: (tab: 'chat' | 'moderation') => void;
    degradedChat: ChatEnvelope[];
    chat: Chat;
    isLive: boolean;
    user: {
        role: string;
    } | null;
    products: SessionProductDto[];
    sessionId: string;
    selectedMessage: ChatEnvelope | null;
    onSelectMessage: (message: ChatEnvelope) => void;
    onClearSelection: () => void;
    moderationNotice: ModerationNotice | null;
    session: LiveSessionDto;
    isOwner: boolean;
    onSessionUpdated: (session: LiveSessionDto) => void;
}): JSX.Element => (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line">
        {isOwner && (
            <div className="p-3 pb-0">
                <div
                    role="tablist"
                    aria-label="Audience"
                    className="flex h-ctl items-stretch gap-1 rounded-ctl border border-line p-1"
                >
                    {(
                        [
                            { id: 'chat', label: 'Chat' },
                            { id: 'moderation', label: 'Moderation' },
                        ] as const
                    ).map((segment) => (
                        <button
                            key={segment.id}
                            type="button"
                            role="tab"
                            aria-selected={tab === segment.id}
                            onClick={() => onTabChange(segment.id)}
                            className={`flex-1 rounded-chip text-14 font-medium transition duration-ctl ${tab === segment.id ? 'bg-surface text-t1' : 'text-t2 hover:text-t1'}`}
                        >
                            {segment.label}
                        </button>
                    ))}
                </div>
            </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col p-3">
            {degradedChat.length > 0 && (
                <p className="mb-2 text-14 text-t2">Chat is running on a backup route</p>
            )}

            {tab === 'chat' || !isOwner ? (
                <ChatPanel
                    chat={chat}
                    canSend={isLive && chat.status === 'ready'}
                    signedIn={user !== null}
                    shareProducts={products}
                    seamless
                    onSelectMessage={
                        isOwner
                            ? (message) => {
                                  onSelectMessage(message);
                                  onTabChange('moderation');
                              }
                            : undefined
                    }
                    selectedMessageId={selectedMessage?.messageId ?? null}
                    emptyHint="No viewer messages yet."
                    className="min-h-0 flex-1"
                />
            ) : (
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                    <ModerationPanel
                        sessionId={sessionId}
                        messages={chat.messages}
                        selected={selectedMessage}
                        onClearSelection={onClearSelection}
                        notice={moderationNotice}
                    />
                </div>
            )}
        </div>

        {isOwner && (
            <ShowReadout
                sessionId={sessionId}
                products={products}
                live={isLive}
            />
        )}

        {isOwner && (
            <CoHostPanel
                session={session}
                onSessionUpdated={onSessionUpdated}
            />
        )}
    </aside>
);
