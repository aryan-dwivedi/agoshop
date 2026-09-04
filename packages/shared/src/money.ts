import type { PriceLadderDto } from './types.js';

/** Money is always integer paise. Never floats. */

export const rupeesToMinorUnits = (rupees: number): number => Math.round(rupees * 100);

/** Decimal string for natural speech and UI, e.g. 129900 -> "1299.00". */
export const minorUnitsToDecimalString = (minorUnits: number): string =>
  (minorUnits / 100).toFixed(2);

export const formatInr = (minorUnits: number): string =>
  `₹${(minorUnits / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Percent of an amount, floored so we never over-discount by a paisa. */
export const percentOf = (minorUnits: number, percent: number): number =>
  Math.floor((minorUnits * percent) / 100);

/**
 * Percent saved, rounded to the nearest whole point, as shoppers read it.
 * `null` when there is nothing to compare against — never 0%, which reads as a
 * broken badge rather than "no discount".
 */
export const offPercent = (fromMinorUnits: number | null, toMinorUnits: number): number | null => {
  if (fromMinorUnits === null || fromMinorUnits <= toMinorUnits) return null;
  const percent = Math.round(((fromMinorUnits - toMinorUnits) / fromMinorUnits) * 100);
  return percent > 0 ? percent : null;
};

/**
 * The single place a price ladder is assembled, so the server, the seed and any
 * test agree on what "discounted" means.
 *
 * A tier that is not strictly better than the one below it is dropped rather than
 * rendered: an MRP equal to the shop price is not a markdown, and a live price that
 * saves nothing must not draw a badge.
 */
export const buildPriceLadder = (input: {
  mrpMinorUnits: number | null;
  shopMinorUnits: number;
  liveMinorUnits?: number | null;
}): PriceLadderDto => {
  const mrp =
    input.mrpMinorUnits !== null && input.mrpMinorUnits > input.shopMinorUnits
      ? input.mrpMinorUnits
      : null;
  const live =
    input.liveMinorUnits !== null &&
    input.liveMinorUnits !== undefined &&
    input.liveMinorUnits < input.shopMinorUnits
      ? input.liveMinorUnits
      : null;

  return {
    mrpMinorUnits: mrp,
    shopMinorUnits: input.shopMinorUnits,
    liveMinorUnits: live,
    liveDiscountMinorUnits: live === null ? 0 : input.shopMinorUnits - live,
    shopOffPercent: offPercent(mrp, input.shopMinorUnits),
    liveOffPercent: live === null ? null : offPercent(input.shopMinorUnits, live),
  };
};

/**
 * The live markdown a room is actually delivering, read off the priced line-up
 * rather than off the session's own `discountPercent`.
 *
 * A room can be discounted by a global promotion it never configured, and a room
 * that sets a percent can still be beaten or capped by the promotion engine. The
 * ladder the server already computed is the only number worth advertising.
 */
export const liveOffPercentForSession = (session: {
  products: { price: PriceLadderDto }[];
}): number | null =>
  session.products.reduce<number | null>(
    (best, p) =>
      p.price.liveOffPercent === null
        ? best
        : best === null
          ? p.price.liveOffPercent
          : Math.max(best, p.price.liveOffPercent),
    null,
  );
