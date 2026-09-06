import type { LiveSessionDto } from '@shop/shared';

import { Copy, Link2, RefreshCw, X } from 'lucide-react';
import { useState } from 'react';

import { sellerUrl } from '../../lib/origins';
import { useCreateCohostInvite, useRemoveCohost } from '../../lib/sellerApi';

export const CoHostPanel = ({
    session,
    onSessionUpdated,
}: {
    session: LiveSessionDto;
    onSessionUpdated: (session: LiveSessionDto) => void;
}): JSX.Element => {
    const [inviteLink, setInviteLink] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [copyError, setCopyError] = useState<string | null>(null);
    const createInvite = useCreateCohostInvite();
    const remove = useRemoveCohost();
    const busy = createInvite.isPending || remove.isPending;
    const createLink = (): void => {
        void createInvite.mutateAsync(session.id).then(({ token }) => {
            setInviteLink(
                sellerUrl(`/live/${session.slug}/preflight?cohost=${encodeURIComponent(token)}`),
            );
            setCopied(false);
            setCopyError(null);
        });
    };
    const copyLink = async (): Promise<void> => {
        if (inviteLink === null) return;
        try {
            await navigator.clipboard.writeText(inviteLink);
            setCopied(true);
            setCopyError(null);
        } catch {
            setCopyError('Clipboard access failed. Select the link and copy it manually.');
        }
    };
    return (
        <section
            className="border-t border-line p-3"
            aria-label="Co-host"
        >
            <h2 className="eyebrow">Co-host</h2>
            <p className="mt-1 text-13 text-t3">
                Create a private link for the second camera. Anyone with the link can join; no
                seller account is required.
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
                            void remove.mutateAsync(session.id).then((updated) => {
                                onSessionUpdated(updated);
                                setInviteLink(null);
                            })
                        }
                    >
                        <X
                            className="h-3.5 w-3.5"
                            strokeWidth={1.8}
                        />
                        Remove
                    </button>
                </div>
            ) : inviteLink === null ? (
                <button
                    type="button"
                    className="btn-standard btn-sm mt-3"
                    disabled={busy}
                    onClick={createLink}
                >
                    <Link2
                        className="h-4 w-4"
                        strokeWidth={1.8}
                    />
                    {createInvite.isPending ? 'Creating…' : 'Create join link'}
                </button>
            ) : (
                <div className="mt-3 space-y-2">
                    <input
                        className="input w-full text-13"
                        aria-label="Co-host join link"
                        readOnly
                        value={inviteLink}
                        onFocus={(event) => event.currentTarget.select()}
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className="btn-standard btn-sm"
                            onClick={() => void copyLink()}
                        >
                            <Copy
                                className="h-4 w-4"
                                strokeWidth={1.8}
                            />
                            {copied ? 'Copied' : 'Copy link'}
                        </button>
                        <button
                            type="button"
                            className="btn-quiet btn-sm"
                            disabled={busy}
                            onClick={createLink}
                        >
                            <RefreshCw
                                className="h-4 w-4"
                                strokeWidth={1.8}
                            />
                            New link
                        </button>
                    </div>
                    <p className="text-12 text-t3">The link expires in 24 hours and works once.</p>
                </div>
            )}

            {(createInvite.error ?? remove.error) !== null && (
                <p className="mt-2 text-13 text-danger">
                    {createInvite.error?.message ?? remove.error?.message}
                </p>
            )}
            {copyError !== null && <p className="mt-2 text-13 text-danger">{copyError}</p>}
        </section>
    );
};
