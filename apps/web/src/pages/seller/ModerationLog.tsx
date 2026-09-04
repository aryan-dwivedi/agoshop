import type { UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { RoleGate } from '../../components/seller/RoleGate';
import {
  useSellerSessions,
  useSessionModeration,
  type ModerationAction,
  type SellerSessionsDto,
} from '../../lib/sellerApi';
import { useSession } from '../../state/session';

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const ACTION_STYLE: Record<ModerationAction, string> = {
  ban: 'bg-live-wash text-danger',
  mute: 'bg-accent-wash text-accent-text',
  unmute: 'bg-success-wash text-success',
  delete_message: 'bg-bg text-t2',
};

const ACTION_MEANING: Record<ModerationAction, string> = {
  ban: 'blocked from this show',
  mute: 'chat paused',
  unmute: 'chat restored',
  delete_message: 'message removed',
};

const Entries = ({ sessionId }: { sessionId: string }): JSX.Element => {
  const moderation = useSessionModeration(sessionId, true);

  if (moderation.isLoading) {
    return <div className="card p-8 text-14 text-t3">Loading audience activity…</div>;
  }

  if (moderation.isError) {
    return (
      <div className="card p-6">
        <p className="rounded-ctl border border-live bg-live-wash px-3 py-2 text-14 text-danger">
          Audience activity could not be loaded.
        </p>
        <button
          type="button"
          className="btn-standard mt-3"
          onClick={() => void moderation.refetch()}
        >
          Try again
        </button>
      </div>
    );
  }

  const entries = moderation.data?.entries ?? [];

  if (entries.length === 0) {
    return (
      <div className="card px-4 py-12 text-center">
        <p className="text-14 font-semibold text-t1">No moderation actions for this show</p>
        <p className="mx-auto mt-1 max-w-md text-13 leading-relaxed text-t2">
          Muted, removed, and blocked audience activity will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[720px] text-13">
        <thead className="border-b border-line bg-bg text-left text-t3">
          <tr>
            <th className="px-4 py-2 font-medium">When</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Viewer</th>
            <th className="px-4 py-2 font-medium">By</th>
            <th className="px-4 py-2 font-medium">Reference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((entry) => (
            <tr key={entry.id} className="transition hover:bg-bg">
              <td className="tnum whitespace-nowrap px-4 py-2.5 text-t2">
                {dateTime.format(new Date(entry.createdAt))}
              </td>
              <td className="px-4 py-2.5">
                <span className={`pill ${ACTION_STYLE[entry.action]}`}>{entry.action}</span>
                <div className="mt-1 text-13 text-t3">{ACTION_MEANING[entry.action]}</div>
              </td>
              <td className="px-4 py-2.5 font-medium text-t1">
                {entry.targetDisplayName ?? entry.targetUserId ?? '—'}
              </td>
              <td className="px-4 py-2.5 text-t2">
                {entry.actorDisplayName ?? entry.actorUserId ?? 'system'}
              </td>
              <td className="px-4 py-2.5 font-mono text-13 text-t3">
                {entry.targetMessageId ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const Body = ({ sessions }: { sessions: UseQueryResult<SellerSessionsDto> }): JSX.Element => {
  const [params, setParams] = useSearchParams();
  const rows = sessions.data?.sessions ?? [];
  const sellerId = params.get('sellerId');

  const requested = params.get('sessionId');
  const selected =
    requested !== null && rows.some((s) => s.id === requested) ? requested : (rows[0]?.id ?? null);

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap items-center gap-3 px-4 py-3">
        <label className="flex items-center gap-2 text-14 font-semibold text-t2">
          Session
          <select
            className="input min-w-[280px]"
            value={selected ?? ''}
            disabled={rows.length === 0}
            onChange={(e) =>
              setParams(
                sellerId === null
                  ? { sessionId: e.target.value }
                  : { sessionId: e.target.value, sellerId },
              )
            }
          >
            {rows.length === 0 && <option value="">No sessions</option>}
            {rows.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} — {s.status}
              </option>
            ))}
          </select>
        </label>
        {sessions.isLoading && <span className="text-13 text-t3">Loading shows…</span>}
        {sessions.isError && (
          <span className="text-13 font-semibold text-danger">Could not load your shows.</span>
        )}
      </div>

      {selected === null ? (
        <div className="card px-4 py-12 text-center text-14 text-t2">
          {sessions.isSuccess
            ? 'There are no shows with audience activity yet.'
            : 'Choose a show when the list loads.'}
        </div>
      ) : (
        <Entries key={selected} sessionId={selected} />
      )}
    </div>
  );
};

const ModerationLog = (): JSX.Element => {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const sellerId = params.get('sellerId');
  const allowed = user?.role === 'seller';
  const sessions = useSellerSessions(allowed, sellerId);

  return (
    <RoleGate
      roles={['seller']}
      title="Audience"
      subtitle="Review moderation actions taken during each show."
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
      <Body sessions={sessions} />
    </RoleGate>
  );
};

export default ModerationLog;
