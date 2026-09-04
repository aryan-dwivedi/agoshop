import type { DeliveryTier, SessionStatus } from '@shop/shared';
const VIEWER_FLOOR = 10;
const STATUS_LABEL: Record<SessionStatus, string> = {
    live: 'Live',
    scheduled: 'Starting soon',
    ended: 'Ended',
};
export const LiveBadge = ({ status, viewerCount, peakViewers, onDark = false, }: {
    status: SessionStatus;
    viewerCount?: number;
    deliveryTier?: DeliveryTier;
    peakViewers?: number;
    onDark?: boolean;
}): JSX.Element => {
    const neutral = onDark ? 'on-video pill' : 'badge-neutral';
    return (<div className="flex flex-wrap items-center gap-2">
      <span className={status === 'live' ? 'badge-live' : neutral}>
        {status === 'live' && (<span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink"/>)}
        {STATUS_LABEL[status]}
      </span>

      {status === 'live' && typeof viewerCount === 'number' && viewerCount >= VIEWER_FLOOR && (<span className={`${neutral} tnum`}>{viewerCount.toLocaleString('en-IN')} watching</span>)}

      {status === 'ended' && typeof peakViewers === 'number' && peakViewers >= VIEWER_FLOOR && (<span className={`${neutral} tnum`}>Peak {peakViewers.toLocaleString('en-IN')}</span>)}
    </div>);
};
