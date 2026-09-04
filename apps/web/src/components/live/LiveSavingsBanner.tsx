import { Link } from 'react-router-dom';

import { formatInr } from '@shop/shared';

export const LiveSavingsBanner = ({
  isLive,
  liveSavings,
  liveLineCount,
  discountExpired,
}: {
  isLive: boolean;
  liveSavings: number;
  liveLineCount: number;
  discountExpired: boolean;
}): JSX.Element | null => {
  if (!(isLive && liveSavings > 0) && !discountExpired) return null;

  return (
    <div className="mx-auto max-w-page px-3 py-3 md:px-5">
      {isLive && liveSavings > 0 && (
        <p className="animate-slide-down rounded-ctl bg-success-wash px-4 py-2 text-14 font-medium text-success">
          Show pricing on {liveLineCount} item{liveLineCount === 1 ? '' : 's'} —{' '}
          <span className="tnum">{formatInr(liveSavings)}</span> off while this show is live.{' '}
          <Link to="/cart" className="link">
            Review cart
          </Link>
        </p>
      )}
      {discountExpired && (
        <p className="animate-slide-down rounded-ctl bg-surface px-4 py-2 text-14 text-t2">
          The show ended, so its live price came off. Everything else is unchanged.
        </p>
      )}
    </div>
  );
};
