import type { PriceLadderDto } from './types.js';
export const rupeesToMinorUnits = (rupees: number): number => Math.round(rupees * 100);
export const minorUnitsToDecimalString = (minorUnits: number): string => (minorUnits / 100).toFixed(2);
export const formatInr = (minorUnits: number): string => `₹${(minorUnits / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const percentOf = (minorUnits: number, percent: number): number => Math.floor((minorUnits * percent) / 100);
export const offPercent = (fromMinorUnits: number | null, toMinorUnits: number): number | null => {
    if (fromMinorUnits === null || fromMinorUnits <= toMinorUnits)
        return null;
    const percent = Math.round(((fromMinorUnits - toMinorUnits) / fromMinorUnits) * 100);
    return percent > 0 ? percent : null;
};
export const buildPriceLadder = (input: {
    mrpMinorUnits: number | null;
    shopMinorUnits: number;
    liveMinorUnits?: number | null;
}): PriceLadderDto => {
    const mrp = input.mrpMinorUnits !== null && input.mrpMinorUnits > input.shopMinorUnits
        ? input.mrpMinorUnits
        : null;
    const live = input.liveMinorUnits !== null &&
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
export const liveOffPercentForSession = (session: {
    products: {
        price: PriceLadderDto;
    }[];
}): number | null => session.products.reduce<number | null>((best, p) => p.price.liveOffPercent === null
    ? best
    : best === null
        ? p.price.liveOffPercent
        : Math.max(best, p.price.liveOffPercent), null);
