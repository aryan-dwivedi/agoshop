import { formatInr, type PriceLadderDto } from '@shop/shared';

type Size = 'sm' | 'md' | 'lg';

const NET_SIZE: Record<Size, string> = {
  sm: 'text-16',
  md: 'text-19',
  lg: 'text-28',
};

const STRUCK_SIZE: Record<Size, string> = {
  sm: 'text-13',
  md: 'text-14',
  lg: 'text-16',
};

const MRP_SIZE: Record<Size, string> = {
  sm: 'text-11',
  md: 'text-11',
  lg: 'text-13',
};

/**
 * The one price primitive. Renders the three-tier ladder — MRP, shop price, live
 * price — exactly as the server computed it: every number and every percent comes
 * off `PriceLadderDto`, because a client that divides two amounts eventually
 * disagrees with the server that charged the card.
 *
 * The bold number is always what the shopper pays right now, so the headline never
 * has to be reconciled with the cart.
 */
export const PriceTag = ({
  ladder,
  size = 'md',
  className = '',
  onDark = false,
}: {
  ladder: PriceLadderDto;
  size?: Size;
  className?: string;
  /** Set on a dark panel: a live price is allowed to carry the accent there. */
  onDark?: boolean;
}): JSX.Element => {
  const live = ladder.liveMinorUnits;
  const payable = live ?? ladder.shopMinorUnits;
  // Tier 2 is struck against the live price; without a live rule the MRP takes that
  // slot, which is the plain storefront look.
  const struck = live === null ? ladder.mrpMinorUnits : ladder.shopMinorUnits;
  const offPercent = live === null ? ladder.shopOffPercent : ladder.liveOffPercent;
  // With a live price the MRP drops to its own muted line: three tiers on one row
  // stops being readable in a card at `sm`.
  const mrpLine = live === null ? null : ladder.mrpMinorUnits;

  return (
    <div className={`flex flex-col gap-y-0.5 ${className}`}>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {/* Amber only when a live rule is actually in play, and only on a dark panel:
            it is the commit colour, so a shop price wearing it would mean nothing. */}
        <span
          className={`tnum font-semibold tracking-[-0.01em] ${NET_SIZE[size]} ${
            onDark && live !== null ? 'text-accent' : 'text-t1'
          }`}
        >
          {formatInr(payable)}
        </span>
        {struck !== null && (
          <span className={`tnum text-t3 line-through ${STRUCK_SIZE[size]}`}>
            {formatInr(struck)}
          </span>
        )}
        {offPercent !== null &&
          (live === null ? (
            <span className="badge-success tnum shrink-0">{offPercent}% off</span>
          ) : (
            <span className="badge-live tnum shrink-0">{offPercent}% live</span>
          ))}
      </div>

      {mrpLine !== null && (
        <div className={`tnum flex flex-wrap items-baseline gap-x-1.5 text-t3 ${MRP_SIZE[size]}`}>
          <span>
            MRP <span className="line-through">{formatInr(mrpLine)}</span>
          </span>
          {size !== 'sm' && ladder.liveDiscountMinorUnits > 0 && (
            <span className="text-success">
              · {formatInr(ladder.liveDiscountMinorUnits)} off the shop price
            </span>
          )}
        </div>
      )}
    </div>
  );
};
