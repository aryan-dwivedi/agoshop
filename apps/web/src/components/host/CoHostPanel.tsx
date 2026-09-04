import type { LiveSessionDto } from '@shop/shared';

import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';

import { useInviteCohost, useRemoveCohost } from '../../lib/sellerApi';

export const CoHostPanel = ({
    session,
    onSessionUpdated,
}: {
    session: LiveSessionDto;
    onSessionUpdated: (session: LiveSessionDto) => void;
}): JSX.Element => {
    const [email, setEmail] = useState('');
    const invite = useInviteCohost();
    const remove = useRemoveCohost();
    const busy = invite.isPending || remove.isPending;
    return (
        <section
            className="border-t border-line p-3"
            aria-label="Co-host"
        >
            <h2 className="eyebrow">Co-host</h2>
            <p className="mt-1 text-13 text-t3">
                A second camera on stage. They can publish video and audio but cannot end the show
                or moderate chat.
            </p>

            {session.coHostName !== null ? (
                <div className="mt-3 flex items-center gap-2 rounded-ctl border border-line px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-14 text-t1">
                        {session.coHostName}
                    </span>
                    <button
                        type="button"
                        className="btn-quiet btn-xs"
                        disabled={busy}
                        onClick={() =>
                            void remove
                                .mutateAsync(session.id)
                                .then((updated) => onSessionUpdated(updated))
                        }
                    >
                        <X
                            className="h-3.5 w-3.5"
                            strokeWidth={1.8}
                        />
                        Remove
                    </button>
                </div>
            ) : (
                <form
                    className="mt-3 flex gap-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = email.trim();
                        if (trimmed.length === 0) return;
                        void invite
                            .mutateAsync({ sessionId: session.id, email: trimmed })
                            .then((updated) => {
                                onSessionUpdated(updated);
                                setEmail('');
                            });
                    }}
                >
                    <input
                        type="email"
                        className="input flex-1 text-14"
                        placeholder="co-host@example.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        disabled={busy}
                        aria-label="Co-host email"
                    />
                    <button
                        type="submit"
                        className="btn-standard btn-sm shrink-0"
                        disabled={busy}
                    >
                        <UserPlus
                            className="h-4 w-4"
                            strokeWidth={1.8}
                        />
                        Invite
                    </button>
                </form>
            )}

            {(invite.error ?? remove.error) !== null && (
                <p className="mt-2 text-13 text-danger">
                    {invite.error?.message ?? remove.error?.message}
                </p>
            )}
        </section>
    );
};
