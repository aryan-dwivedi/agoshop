import type { DeliveryTier, SessionStatus } from '@shop/shared';

/**
 * The one `LIVE` treatment in the product: a filled red pill, dark ink, the word, and
 * a dot that breathes on opacity alone. Nothing else in either surface is allowed to
 * hand-roll it — that shape is reserved, which is what lets red carry *destructive*
 * everywhere else without ever being confused for on-air.
 *
 * Viewer count is deliberately withheld below ten. "1 watching" is a true fact that
 * helps nobody and reads as an empty room; the pill is simply absent instead.
 */

/** Below this, the audience size is not reported at all. */
const VIEWER_FLOOR = 10;

const STATUS_LABEL: Record<SessionStatus, string> = {
  live: 'Live',
  scheduled: 'Starting soon',
  ended: 'Ended',
};

export const LiveBadge = ({
  status,
  viewerCount,
  peakViewers,
  onDark = false,
}: {
  status: SessionStatus;
  viewerCount?: number;
  /**
   * Accepted and ignored. The RTC→CDN handover is silent by design: it is a fact
   * about delivery, not about the show, and a badge for it would be noise.
   */
  deliveryTier?: DeliveryTier;
  peakViewers?: number;
  /** Set over video, where a chip needs its own opaque background. */
  onDark?: boolean;
}): JSX.Element => {
  const neutral = onDark ? 'on-video pill' : 'badge-neutral';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={status === 'live' ? 'badge-live' : neutral}>
        {status === 'live' && (
          <span aria-hidden className="h-1.5 w-1.5 animate-breathe rounded-full bg-live-ink" />
        )}
        {STATUS_LABEL[status]}
      </span>

      {status === 'live' && typeof viewerCount === 'number' && viewerCount >= VIEWER_FLOOR && (
        <span className={`${neutral} tnum`}>{viewerCount.toLocaleString('en-IN')} watching</span>
      )}

      {status === 'ended' && typeof peakViewers === 'number' && peakViewers >= VIEWER_FLOOR && (
        <span className={`${neutral} tnum`}>Peak {peakViewers.toLocaleString('en-IN')}</span>
      )}
    </div>
  );
};
