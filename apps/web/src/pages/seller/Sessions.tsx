import type { EditableShow } from '../../components/seller/SessionScheduler';
import type { SellerSessionRow } from '../../lib/sellerApi';
import type { LiveSessionDto, SessionStatus } from '@shop/shared';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { formatInr } from '@shop/shared';

import { RoleGate } from '../../components/seller/RoleGate';
import { SessionScheduler, uploadSourceVideo } from '../../components/seller/SessionScheduler';
import { api } from '../../lib/api';
import { customerUrl } from '../../lib/origins';
import { useSellerSessions } from '../../lib/sellerApi';
import { useSession } from '../../state/session';

type BroadcastFlags = {
    autoStart: boolean;
    hasUploadedVideo: boolean;
};
type FailedUpload = {
    sessionId: string;
    message: string;
    file: File;
};
const nf = new Intl.NumberFormat('en-IN');
const dateTime = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
});
const FILTERS: {
    key: SessionStatus | 'all';
    label: string;
}[] = [
    { key: 'all', label: 'All' },
    { key: 'live', label: 'Live' },
    { key: 'scheduled', label: 'Scheduled' },
    { key: 'ended', label: 'Ended' },
];
const RetryRow = ({
    failure,
    onRetried,
}: {
    failure: FailedUpload;
    onRetried: () => void;
}): JSX.Element => {
    const queryClient = useQueryClient();
    const [message, setMessage] = useState(failure.message);
    const retry = useMutation({
        mutationFn: () => uploadSourceVideo(failure.sessionId, failure.file),
        onSuccess: async () => {
            onRetried();
            await queryClient.invalidateQueries({ queryKey: ['sessions'] });
            await queryClient.invalidateQueries({ queryKey: ['session'] });
        },
        onError: (err) =>
            setMessage(err instanceof Error ? err.message : 'The video upload failed again.'),
    });
    return (
        <tr className="bg-live-wash">
            <td
                colSpan={8}
                className="px-3 py-2"
            >
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-13 text-t1">
                        This show is saved, but{' '}
                        <span className="font-medium">{failure.file.name}</span> did not upload:{' '}
                        {message} Nothing plays in the room until a video lands.
                    </span>
                    <button
                        type="button"
                        className="btn-standard btn-sm"
                        disabled={retry.isPending}
                        onClick={() => retry.mutate()}
                    >
                        {retry.isPending ? 'Retrying…' : 'Retry the upload'}
                    </button>
                    <button
                        type="button"
                        className="btn-quiet btn-sm"
                        onClick={onRetried}
                    >
                        Dismiss
                    </button>
                </div>
            </td>
        </tr>
    );
};
const ShowRow = ({
    show,
    broadcast,
    onEdit,
    onDuplicate,
}: {
    show: SellerSessionRow;
    broadcast: BroadcastFlags | undefined;
    onEdit: () => void;
    onDuplicate: () => void;
}): JSX.Element => {
    const when = show.startedAt ?? show.scheduledFor ?? show.endedAt;
    return (
        <tr className="h-[var(--row-h)] hover:bg-surface">
            <td className="max-w-[22rem] px-3">
                <span className="flex items-center gap-1.5">
                    <span className="min-w-0 truncate font-medium text-t1">{show.title}</span>
                    {broadcast?.autoStart === true && (
                        <span
                            className="shrink-0 text-11 font-semibold uppercase tracking-[0.06em] text-accent"
                            title="Goes live on schedule with nobody at the console."
                        >
                            premiere
                        </span>
                    )}
                    {broadcast?.hasUploadedVideo === true && (
                        <span
                            className="shrink-0 text-11 text-t3"
                            title="A video stands in for the camera."
                        >
                            video
                        </span>
                    )}
                </span>
            </td>

            <td className="px-3">
                {show.status === 'live' ? (
                    <span className="badge-live">
                        <span className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink" />
                        live
                    </span>
                ) : (
                    <span className="text-t2">{show.status}</span>
                )}
            </td>

            <td className="whitespace-nowrap px-3 tabular-nums text-t2">
                {when === null ? 'unscheduled' : dateTime.format(new Date(when))}
            </td>

            <td className="px-3 text-right tabular-nums text-t2">{nf.format(show.productCount)}</td>

            <td className="px-3 text-right tabular-nums text-t2">
                {show.status === 'live' && show.viewerCount >= 10
                    ? nf.format(show.viewerCount)
                    : show.peakViewers > 0
                      ? nf.format(show.peakViewers)
                      : '—'}
            </td>

            <td className="px-3 text-right tabular-nums text-t2">
                {show.orders === 0 && show.status === 'scheduled' ? '—' : nf.format(show.orders)}
            </td>

            <td className="px-3 text-right font-semibold tabular-nums text-t1">
                {show.status === 'scheduled' && show.gmvMinorUnits === 0
                    ? '—'
                    : formatInr(show.gmvMinorUnits)}
            </td>

            <td className="px-3">
                <div className="flex items-center justify-end gap-2">
                    {show.status === 'live' && (
                        <Link
                            to={`/live/${show.slug}`}
                            className="btn-commit btn-xs"
                        >
                            Open room
                        </Link>
                    )}
                    {show.status === 'scheduled' && (
                        <>
                            <Link
                                to={`/live/${show.slug}/preflight`}
                                className="btn-standard btn-xs"
                            >
                                Pre-flight
                            </Link>
                            <button
                                type="button"
                                className="btn-quiet btn-xs"
                                onClick={onEdit}
                            >
                                Edit
                            </button>
                        </>
                    )}
                    {show.status === 'ended' && (
                        <>
                            <Link
                                to={`/shows/${show.id}/report`}
                                className="btn-standard btn-xs"
                            >
                                Report
                            </Link>
                            <button
                                type="button"
                                className="btn-quiet btn-xs"
                                onClick={onDuplicate}
                            >
                                Duplicate
                            </button>
                            {show.recordingStatus === 'ready' && (
                                <a
                                    href={customerUrl(`/replay/${show.slug}`)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="btn-quiet btn-xs"
                                >
                                    Replay ↗
                                </a>
                            )}
                        </>
                    )}
                    {show.status === 'live' && (
                        <button
                            type="button"
                            className="btn-quiet btn-xs"
                            onClick={onEdit}
                        >
                            Edit
                        </button>
                    )}
                    <Link
                        to={`/audience?sessionId=${show.id}`}
                        className="btn-quiet btn-xs"
                    >
                        Audience
                    </Link>
                </div>
            </td>
        </tr>
    );
};
const Sessions = (): JSX.Element => {
    const { user } = useSession();
    const [params, setParams] = useSearchParams();
    const sellerId = params.get('sellerId');
    const editingId = params.get('show');
    const allowed = user?.role === 'seller';
    const sessions = useSellerSessions(allowed, sellerId);
    const [filter, setFilter] = useState<SessionStatus | 'all'>('all');
    const [creating, setCreating] = useState(false);
    const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
    const [failure, setFailure] = useState<FailedUpload | null>(null);
    const rows = sessions.data?.sessions ?? [];
    const visible = filter === 'all' ? rows : rows.filter((show) => show.status === filter);
    const publicSessions = useQuery({
        queryKey: ['sessions', 'all'],
        queryFn: () =>
            api.get<{
                sessions: LiveSessionDto[];
            }>('/api/sessions'),
        staleTime: 60000,
    });
    const broadcastFlags = useMemo(
        () =>
            new Map<string, BroadcastFlags>(
                (publicSessions.data?.sessions ?? []).map((session) => [
                    session.slug,
                    {
                        autoStart: session.autoStart,
                        hasUploadedVideo: session.sourceVideoUrl !== null,
                    },
                ]),
            ),
        [publicSessions.data],
    );
    const prefillId = editingId ?? duplicateOf;
    const prefillRead = useQuery({
        queryKey: ['session', prefillId ?? 'none'],
        queryFn: async () =>
            (
                await api.get<{
                    session: LiveSessionDto;
                }>(`/api/sessions/${prefillId ?? ''}`)
            ).session,
        enabled: prefillId !== null,
    });
    const prefillRow = rows.find((show) => show.id === prefillId) ?? null;
    const prefill: EditableShow | null =
        prefillRead.data === undefined || prefillRow === null
            ? null
            : {
                  session: prefillRead.data,
                  expectedPeakViewers: prefillRow.expectedPeakViewers,
              };
    const closeBuilder = (): void => {
        setCreating(false);
        setDuplicateOf(null);
        if (editingId !== null) {
            setParams(sellerId === null ? {} : { sellerId });
        }
    };
    const builderOpen = creating || prefillId !== null;
    return (
        <RoleGate
            roles={['seller']}
            title="Shows"
            subtitle="Schedule a show, put products on its line-up, take it on air, then read what it earned."
            actions={
                <button
                    type="button"
                    className="btn-commit"
                    onClick={() => {
                        closeBuilder();
                        setCreating(true);
                    }}
                >
                    New show
                </button>
            }
            scope={
                sessions.data === undefined
                    ? undefined
                    : {
                          sellers: sessions.data.sellers,
                          value: sellerId,
                          onChange: (next) => setParams(next === null ? {} : { sellerId: next }),
                      }
            }
        >
            {builderOpen &&
                (prefillId !== null && prefill === null ? (
                    <div className="card mb-4 p-3">
                        {prefillRead.isError ? (
                            <p
                                role="alert"
                                className="text-13 text-danger"
                            >
                                Could not open that show.{' '}
                                <button
                                    type="button"
                                    className="link"
                                    onClick={closeBuilder}
                                >
                                    Close
                                </button>
                            </p>
                        ) : (
                            <div
                                className="space-y-2"
                                aria-busy="true"
                            >
                                <div className="skeleton h-4 w-40" />
                                <div className="skeleton h-32 w-full" />
                            </div>
                        )}
                    </div>
                ) : (
                    <SessionScheduler
                        key={prefillId ?? 'new'}
                        show={prefill}
                        mode={editingId !== null ? 'edit' : 'create'}
                        onClose={closeBuilder}
                        onSaved={(result) => {
                            setFailure(
                                result.uploadError === null || result.videoFile === null
                                    ? null
                                    : {
                                          sessionId: result.session.id,
                                          message: result.uploadError,
                                          file: result.videoFile,
                                      },
                            );
                            closeBuilder();
                        }}
                    />
                ))}

            <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {FILTERS.map((entry) => {
                    const count =
                        entry.key === 'all'
                            ? rows.length
                            : rows.filter((show) => show.status === entry.key).length;
                    return (
                        <button
                            key={entry.key}
                            type="button"
                            onClick={() => setFilter(entry.key)}
                            className={filter === entry.key ? 'chip-active' : 'chip'}
                            aria-pressed={filter === entry.key}
                        >
                            {entry.label}
                            <span className="tabular-nums">{count}</span>
                        </button>
                    );
                })}
            </div>

            {sessions.isLoading && (
                <div
                    className="card space-y-1 p-3"
                    aria-busy="true"
                    aria-label="Loading your shows"
                >
                    {[0, 1, 2, 3, 4].map((row) => (
                        <div
                            key={row}
                            className="skeleton h-8"
                        />
                    ))}
                </div>
            )}

            {sessions.isError && (
                <div className="card p-3">
                    <p
                        role="alert"
                        className="text-13 text-danger"
                    >
                        Could not load your shows.
                    </p>
                    <button
                        type="button"
                        className="btn-standard btn-sm mt-2"
                        onClick={() => void sessions.refetch()}
                    >
                        Retry
                    </button>
                </div>
            )}

            {sessions.isSuccess && rows.length === 0 && (
                <div className="card px-3 py-10 text-center">
                    <p className="text-14 font-medium text-t1">No shows yet.</p>
                    <p className="mx-auto mt-1 max-w-md text-13 leading-relaxed text-t2">
                        A show is what everything else hangs off: the room shoppers join, the chat,
                        the line-up that makes the live price apply, and the report afterwards.
                    </p>
                    <button
                        type="button"
                        className="btn-commit mt-3"
                        onClick={() => setCreating(true)}
                    >
                        Schedule your first show
                    </button>
                </div>
            )}

            {sessions.isSuccess && rows.length > 0 && visible.length === 0 && (
                <p className="card px-3 py-8 text-center text-13 text-t2">No {filter} shows.</p>
            )}

            {visible.length > 0 && (
                <div className="card overflow-x-auto">
                    <table className="w-full min-w-[860px] text-13">
                        <thead>
                            <tr className="border-b border-line text-left">
                                <th className="px-3 py-1.5 font-medium text-t3">Show</th>
                                <th className="px-3 py-1.5 font-medium text-t3">Status</th>
                                <th className="px-3 py-1.5 font-medium text-t3">When</th>
                                <th className="px-3 py-1.5 text-right font-medium text-t3">
                                    Line-up
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium text-t3">
                                    Viewers
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium text-t3">
                                    Orders
                                </th>
                                <th className="px-3 py-1.5 text-right font-medium text-t3">GMV</th>
                                <th className="px-3 py-1.5" />
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                            {visible.map((show) => (
                                <>
                                    <ShowRow
                                        key={show.id}
                                        show={show}
                                        broadcast={broadcastFlags.get(show.slug)}
                                        onEdit={() =>
                                            setParams(
                                                sellerId === null
                                                    ? { show: show.id }
                                                    : { show: show.id, sellerId },
                                            )
                                        }
                                        onDuplicate={() => {
                                            closeBuilder();
                                            setDuplicateOf(show.id);
                                        }}
                                    />
                                    {failure?.sessionId === show.id && (
                                        <RetryRow
                                            key={`${show.id}-retry`}
                                            failure={failure}
                                            onRetried={() => setFailure(null)}
                                        />
                                    )}
                                </>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </RoleGate>
    );
};
export default Sessions;
