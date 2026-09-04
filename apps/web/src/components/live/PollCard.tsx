import type { PollDto } from '../../hooks/useLiveSession';

import { useCallback, useState } from 'react';

import { ApiError, api } from '../../lib/api';

export const PollCard = ({
    poll,
    onPollChange,
    canVote,
    canClose,
}: {
    poll: PollDto;
    onPollChange?: (poll: PollDto) => void;
    canVote: boolean;
    canClose?: boolean;
}): JSX.Element => {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const voted = poll.myOptionId !== null;
    const closed = poll.status === 'closed';
    const showResults = voted || closed || Boolean(canClose);
    const vote = useCallback(
        (optionId: string) => {
            setBusy(true);
            setError(null);
            void api
                .post(`/api/polls/${poll.id}/vote`, { optionId })
                .then(() => {
                    onPollChange?.({
                        ...poll,
                        myOptionId: optionId,
                        totalVotes: poll.totalVotes + 1,
                        options: poll.options.map((o) =>
                            o.id === optionId ? { ...o, votes: o.votes + 1 } : o,
                        ),
                    });
                })
                .catch((err: unknown) => {
                    setError(
                        err instanceof ApiError && err.status === 409
                            ? 'You have already voted in this poll.'
                            : 'Vote could not be recorded.',
                    );
                })
                .finally(() => setBusy(false));
        },
        [poll, onPollChange],
    );
    const close = useCallback(() => {
        setBusy(true);
        void api
            .post(`/api/polls/${poll.id}/close`)
            .then(() => onPollChange?.({ ...poll, status: 'closed' }))
            .catch(() => setError('Could not close the poll.'))
            .finally(() => setBusy(false));
    }, [poll, onPollChange]);
    return (
        <div className="card animate-slide-up p-4">
            <div className="flex items-start justify-between gap-3">
                <h3 className="text-14 font-semibold text-t1">{poll.question}</h3>
                <span className={`shrink-0 ${closed ? 'badge-neutral' : 'badge-accent'}`}>
                    {closed ? 'Closed' : 'Open'}
                </span>
            </div>

            <ul className="mt-3 space-y-2">
                {poll.options.map((option) => {
                    const share =
                        poll.totalVotes === 0
                            ? 0
                            : Math.round((option.votes / poll.totalVotes) * 100);
                    const mine = poll.myOptionId === option.id;
                    return (
                        <li key={option.id}>
                            {showResults ? (
                                <div className="space-y-1">
                                    <div className="flex items-baseline justify-between gap-3 text-13">
                                        <span
                                            className={
                                                mine ? 'font-semibold text-accent' : 'text-t2'
                                            }
                                        >
                                            {option.label}
                                            {mine && ' · your vote'}
                                        </span>
                                        <span className="tnum shrink-0 font-semibold text-t3">
                                            {share}% · {option.votes}
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                                        <div
                                            className={`h-full rounded-full ${mine ? 'bg-accent' : 'bg-line-ctl'}`}
                                            style={{
                                                width: `${share}%`,
                                                transition: 'width var(--d-panel) var(--ease-out)',
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="btn-standard w-full justify-start text-left"
                                    disabled={!canVote || busy}
                                    onClick={() => vote(option.id)}
                                >
                                    {option.label}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-13 text-t3">
                <span className="tnum font-semibold">
                    {poll.totalVotes === 1 ? '1 vote' : `${poll.totalVotes} votes`}
                </span>
                {canClose && !closed && (
                    <button
                        type="button"
                        className="btn-quiet btn-sm"
                        disabled={busy}
                        onClick={close}
                    >
                        Close poll
                    </button>
                )}
            </div>

            {error !== null && <p className="mt-2 text-13 font-medium text-danger">{error}</p>}
            {!canVote && !closed && !canClose && (
                <p className="mt-2 text-13 text-t3">Sign in to vote in this poll.</p>
            )}
        </div>
    );
};
