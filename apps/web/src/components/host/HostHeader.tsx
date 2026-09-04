import { Link } from 'react-router-dom';

import type { SessionStatus } from '@shop/shared';

import { HoldToConfirm, type HoldToConfirmHandle } from '../HoldToConfirm';
import { HealthSummary } from '../live/HealthRibbon';
import { LiveBadge } from '../live/LiveBadge';
import type { StreamHealth } from '../../hooks/useStreamHealth';
import type { useHostBroadcast } from '../../hooks/useHostBroadcast';

type Broadcast = ReturnType<typeof useHostBroadcast>;

export const HostHeader = ({
  title,
  status,
  elapsed,
  viewersLabel,
  health,
  publishing,
  slug,
  isLive,
  broadcast,
  endHoldRef,
  onOpenKeyMap,
  onEndSession,
  isOwner = true,
}: {
  title: string;
  status: SessionStatus;
  elapsed: string | null;
  viewersLabel: string;
  health: StreamHealth;
  publishing: boolean;
  slug: string;
  isLive: boolean;
  broadcast: Broadcast;
  endHoldRef: React.RefObject<HoldToConfirmHandle>;
  onOpenKeyMap: () => void;
  onEndSession: () => void;
  isOwner?: boolean;
}): JSX.Element => (
  <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-3">
    <h1 className="min-w-0 truncate text-16 font-semibold text-t1">{title}</h1>
    <LiveBadge status={status} />
    {elapsed !== null && <span className="tnum text-16 font-semibold text-t1">{elapsed}</span>}
    <span className="tnum text-14 text-t2">{viewersLabel}</span>
    <HealthSummary health={health} className="ml-2" />
    <div className="ml-auto flex items-center gap-2">
      {!publishing && isOwner && (
        <Link to={`/live/${slug}/preflight`} className="btn-standard btn-sm">
          Pre-flight
        </Link>
      )}
      {isOwner && (
        <>
          <button
            type="button"
            className="btn-quiet btn-sm"
            aria-keyshortcuts="?"
            onClick={onOpenKeyMap}
          >
            Shortcuts ?
          </button>
          <HoldToConfirm
            ref={endHoldRef}
            label={broadcast.state === 'ending' ? 'Ending…' : 'Hold to end'}
            subLabel={viewersLabel}
            disabled={!isLive || broadcast.state === 'ending' || broadcast.state === 'ended'}
            onConfirm={onEndSession}
          />
        </>
      )}
    </div>
  </header>
);
