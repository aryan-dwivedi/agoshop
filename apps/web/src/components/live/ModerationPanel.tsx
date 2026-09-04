import { useCallback, useMemo, useState } from 'react';

import type { ChatEnvelope } from '@shop/shared';

import { api, ApiError } from '../../lib/api';
import type { ModerationNotice } from '../../hooks/useLiveSession';

/**
 * Host moderation. Every action is a server call that writes the moderation log and
 * updates the ban/mute state consulted on the offender's next message — not on their
 * next token refresh.
 *
 * Destructive actions are never filled: that shape is reserved for `LIVE`, so a mute
 * or a ban is an outlined red control and a colour can never be mistaken for on-air.
 */

type Action = 'mute' | 'unmute' | 'ban' | 'delete_message';

const ACTION_LABEL: Record<Action, string> = {
  mute: 'Mute',
  unmute: 'Unmute',
  ban: 'Ban',
  delete_message: 'Delete message',
};

export const ModerationPanel = ({
  sessionId,
  messages,
  selected,
  onClearSelection,
  notice,
}: {
  sessionId: string;
  messages: ChatEnvelope[];
  /** The message clicked in the host's chat list, if any. */
  selected: ChatEnvelope | null;
  onClearSelection: () => void;
  notice: ModerationNotice | null;
}): JSX.Element => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<{ id: string; text: string }[]>([]);

  const participants = useMemo(() => {
    const byUser = new Map<string, { userId: string; displayName: string; messages: number }>();
    for (const message of messages) {
      const existing = byUser.get(message.userId);
      if (existing) existing.messages += 1;
      else
        byUser.set(message.userId, {
          userId: message.userId,
          displayName: message.displayName,
          messages: 1,
        });
    }
    return [...byUser.values()].sort((a, b) => b.messages - a.messages).slice(0, 12);
  }, [messages]);

  const act = useCallback(
    (
      action: Action,
      target: { targetUserId?: string; targetMessageId?: string; label: string },
    ) => {
      setBusy(`${action}:${target.targetUserId ?? target.targetMessageId ?? ''}`);
      setError(null);
      void api
        .post(`/api/sessions/${sessionId}/moderation`, {
          action,
          targetUserId: target.targetUserId,
          targetMessageId: target.targetMessageId,
        })
        .then(() => {
          setLog((current) =>
            [
              { id: `${Date.now()}-${action}`, text: `${ACTION_LABEL[action]} · ${target.label}` },
              ...current,
            ].slice(0, 8),
          );
          if (action === 'delete_message') onClearSelection();
        })
        .catch((err: unknown) => {
          setError(
            err instanceof ApiError
              ? `${ACTION_LABEL[action]} failed: ${err.message}`
              : 'Moderation failed.',
          );
        })
        .finally(() => setBusy(null));
    },
    [sessionId, onClearSelection],
  );

  return (
    <section className="card overflow-hidden">
      <header className="border-b border-line px-4 py-3">
        <h2 className="section-title">Moderation</h2>
      </header>

      {selected ? (
        <div className="animate-fade-in border-b border-line bg-surface px-4 py-3">
          <p className="eyebrow">Selected message</p>
          <p className="mt-1.5 text-14">
            <span className="font-semibold text-t1">{selected.displayName}</span>
            <span className="ml-2 text-t2">{selected.text}</span>
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-danger btn-xs"
              disabled={busy !== null}
              onClick={() =>
                act('delete_message', {
                  targetMessageId: selected.messageId,
                  targetUserId: selected.userId,
                  label: `message from ${selected.displayName}`,
                })
              }
            >
              Delete message
            </button>
            <button
              type="button"
              className="btn-danger btn-xs"
              disabled={busy !== null}
              onClick={() =>
                act('mute', { targetUserId: selected.userId, label: selected.displayName })
              }
            >
              Mute author
            </button>
            <button type="button" className="btn-quiet btn-xs" onClick={onClearSelection}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <p className="border-b border-line px-4 py-3 text-13 leading-relaxed text-t3">
          Select a message in chat to delete it or mute its author.
        </p>
      )}

      <div className="px-4 py-3">
        <p className="eyebrow">Most active participants</p>
        {participants.length === 0 ? (
          <p className="mt-2 text-13 text-t3">No chat activity yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-line">
            {participants.map((p) => (
              <li key={p.userId} className="flex items-center justify-between gap-2 py-2 text-14">
                <span className="min-w-0 truncate font-medium text-t1">
                  {p.displayName}
                  <span className="tnum ml-2 text-13 text-t3">{p.messages}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  {(['mute', 'unmute', 'ban'] as const).map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={action === 'unmute' ? 'btn-standard btn-xs' : 'btn-danger btn-xs'}
                      disabled={busy === `${action}:${p.userId}`}
                      onClick={() => act(action, { targetUserId: p.userId, label: p.displayName })}
                    >
                      {ACTION_LABEL[action]}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {(log.length > 0 || notice !== null) && (
        <div className="border-t border-line bg-surface px-4 py-3">
          <p className="eyebrow">Recent actions</p>
          <ul className="mt-2 space-y-1 text-13 text-t2">
            {log.map((entry) => (
              <li key={entry.id}>{entry.text}</li>
            ))}
            {notice !== null && log.length === 0 && (
              <li>
                {notice.action}
                {notice.targetUserId === undefined
                  ? ''
                  : ` · viewer ${notice.targetUserId.slice(0, 8)}`}
              </li>
            )}
          </ul>
          <p className="mt-2 text-11 text-t3">Full history lives in Audience.</p>
        </div>
      )}

      {error !== null && (
        <p className="border-t border-line px-4 py-2.5 text-13 font-medium text-danger">{error}</p>
      )}
    </section>
  );
};
