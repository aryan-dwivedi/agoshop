import { useEffect, useRef, useState } from 'react';
import type { ChatEnvelope, SessionProductDto } from '@shop/shared';
import type { UseChatResult } from '../../hooks/useChat';
import { useSession } from '../../state/session';
import { SendIcon, UserIcon } from '../icons';
import { ChatProductCard } from './ChatProductCard';
import { avatarTone, nameTone, ROLE_TAG, ROLE_TAG_CLASS } from './chatIdentity';
const SenderAvatar = ({ displayName, host, moderation, }: {
    displayName: string;
    host: boolean;
    moderation: boolean;
}): JSX.Element => {
    const initial = displayName.trim().charAt(0).toUpperCase();
    return (<span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-11 font-semibold uppercase ${avatarTone({ host, moderation })}`}>
      {moderation || initial === '' ? <UserIcon className="h-3 w-3"/> : initial}
    </span>);
};
export const ChatPanel = ({ chat, canSend, signedIn, readOnly = false, showShard = false, emptyHint, onSelectMessage, selectedMessageId, shareProducts = [], seamless = false, className, }: {
    chat: UseChatResult;
    canSend: boolean;
    signedIn: boolean;
    readOnly?: boolean;
    showShard?: boolean;
    emptyHint?: string;
    onSelectMessage?: (message: ChatEnvelope) => void;
    selectedMessageId?: string | null;
    shareProducts?: SessionProductDto[];
    seamless?: boolean;
    className?: string;
}): JSX.Element => {
    const { user } = useSession();
    const [draft, setDraft] = useState('');
    const [productId, setProductId] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);
    const pinnedToBottomRef = useRef(true);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !pinnedToBottomRef.current)
            return;
        el.scrollTop = el.scrollHeight;
    }, [chat.messages]);
    const joining = chat.status === 'joining';
    const statusLabel = joining
        ? 'Joining chat…'
        : chat.status === 'ready'
            ? 'Connected'
            : chat.status === 'error'
                ? 'Reconnecting'
                : '';
    return (<section className={`flex min-h-0 flex-col overflow-hidden ${seamless ? '' : 'card'} ${className ?? ''}`}>
      {!seamless && (<header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-14 font-semibold text-t1">Chat</h2>
          {!readOnly && statusLabel !== '' && (<span className="inline-flex items-center gap-1.5 text-13 font-medium text-t3">
              <span className={`h-1.5 w-1.5 rounded-full ${chat.status === 'ready'
                    ? 'bg-success'
                    : chat.status === 'error'
                        ? 'bg-danger'
                        : 'bg-accent'}`}/>
              {statusLabel}
            </span>)}
        </header>)}

      <div ref={scrollRef} onScroll={(e) => {
            const el = e.currentTarget;
            pinnedToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }} className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {chat.historyLoading && (<div className="space-y-2">
            {[0, 1, 2].map((i) => (<div key={i} className="skeleton h-4 w-3/4"/>))}
          </div>)}

        {!chat.historyLoading && chat.messages.length === 0 && (<p className="px-1 text-13 leading-relaxed text-t3">
            {emptyHint ?? 'No messages yet. Ask the host about sizing, delivery or the live offer.'}
          </p>)}

        {chat.messages.map((message) => {
            const tag = ROLE_TAG[message.role];
            const selected = selectedMessageId === message.messageId;
            const own = user !== null && message.userId === user.id;
            const moderation = message.type === 'moderation';
            return (<div key={message.messageId} className={`flex items-start gap-2 rounded-ctl px-2 py-1 text-14 transition duration-ctl ${moderation ? 'italic text-t3' : own ? 'bg-surface text-t1' : 'text-t2'} ${selected ? 'ring-1 ring-accent' : ''}`}>
              <SenderAvatar displayName={message.displayName} host={tag !== undefined} moderation={moderation}/>
              <div className="min-w-0 flex-1">
                <button type="button" disabled={!onSelectMessage} onClick={() => onSelectMessage?.(message)} className={`text-left ${onSelectMessage ? 'hover:underline' : 'cursor-default'}`}>
                  <span className={`font-semibold ${nameTone({ host: tag !== undefined, moderation })}`}>
                    {message.displayName}
                  </span>
                  {tag !== undefined && <span className={ROLE_TAG_CLASS}>{tag}</span>}
                  {showShard && (<span className="tnum ml-1.5 text-11 text-t3">s{message.shardIndex}</span>)}
                </button>
                <span className="ml-2 break-words">{message.text}</span>
                {message.product !== undefined && (<ChatProductCard product={message.product} sessionId={message.sessionId} live={!readOnly} signedIn={signedIn} addable={false}/>)}
              </div>
            </div>);
        })}
      </div>

      {chat.blocked !== null && (<p className="border-t border-line px-4 py-2 text-13 font-medium text-danger">
          {chat.blocked}
        </p>)}

      {chat.error !== null && chat.blocked === null && (<p className="flex items-start gap-2 border-t border-line px-4 py-2 text-13 leading-relaxed text-t2">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"/>
          {chat.error}
        </p>)}

      {readOnly ? (<p className="border-t border-line px-4 py-2.5 text-13 text-t3">
          Read-only — no new messages can be sent here.
        </p>) : (<form className="sticky bottom-0 flex flex-col gap-2 border-t border-line bg-elev px-3 py-2.5" onSubmit={(event) => {
                event.preventDefault();
                const product = shareProducts.find((item) => item.productId === productId);
                const text = draft.trim() || (product === undefined ? '' : `Take a look at ${product.title}`);
                if (text === '')
                    return;
                setDraft('');
                setProductId('');
                pinnedToBottomRef.current = true;
                void chat.send(text, product === undefined ? undefined : { productId: product.productId });
            }}>
          {shareProducts.length > 0 && (<label className="flex items-center gap-2 text-12 font-medium text-t2">
              Share an item
              <select className="input h-8 min-w-0 flex-1 py-0 text-12" value={productId} onChange={(event) => setProductId(event.target.value)} disabled={!canSend || chat.sending}>
                <option value="">No item attached</option>
                {shareProducts.map((product) => (<option key={product.productId} value={product.productId}>
                    {product.title}
                  </option>))}
              </select>
            </label>)}
          <div className="flex items-center gap-2">
            <input className="input" value={draft} maxLength={240} onChange={(event) => setDraft(event.target.value)} placeholder={!signedIn
                ? 'Sign in to join the conversation'
                : chat.blocked !== null
                    ? 'You cannot send messages'
                    : productId === ''
                        ? 'Message the room…'
                        : 'Add a note, or send the item'} disabled={!canSend || chat.blocked !== null || !signedIn}/>
            <button type="submit" className="btn-commit shrink-0 px-3" aria-label="Send message" disabled={!canSend ||
                chat.sending ||
                (draft.trim().length === 0 && productId === '') ||
                chat.blocked !== null}>
              <SendIcon className="h-4 w-4"/>
            </button>
          </div>
        </form>)}
    </section>);
};
