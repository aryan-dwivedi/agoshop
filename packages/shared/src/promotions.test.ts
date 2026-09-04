import type { LineContext, Promotion } from './promotions.js';

import { describe, expect, it } from 'vitest';

import { evaluatePromotions } from './promotions.js';

const promo = (over: Partial<Promotion> & Pick<Promotion, 'code'>): Promotion => ({
    id: over.code,
    label: `${over.code} label`,
    kind: 'percent',
    value: 10,
    priority: 0,
    stackable: false,
    conditions: {},
    active: true,
    ...over,
});
const ctx = (over: Partial<LineContext> = {}): LineContext => ({
    surface: 'live',
    liveEligible: true,
    liveSessionId: 'session-1',
    categorySlug: 'electronics',
    productId: 'product-1',
    sellerId: 'seller-1',
    unitPriceMinorUnits: 100000,
    quantity: 1,
    orderSubtotalMinorUnits: 100000,
    userSegments: [],
    redemptionsByPromotionId: {},
    now: new Date('2026-01-01T00:00:00Z'),
    ...over,
});
const LIVE20 = promo({
    code: 'LIVE20',
    value: 20,
    priority: 100,
    stackable: false,
    conditions: { requiresLiveSession: true },
});
const WISHLIST5 = promo({
    code: 'WISHLIST5',
    value: 5,
    priority: 20,
    stackable: true,
    conditions: { userSegments: ['has_wishlisted'] },
});
describe('live-session eligibility', () => {
    it('applies the live rule only when the resolver says the line is live-eligible', () => {
        const eligible = evaluatePromotions([LIVE20], ctx(), 50);
        expect(eligible.applied.map((a) => a.code)).toEqual(['LIVE20']);
        expect(eligible.discountMinorUnits).toBe(20000);
        const ended = evaluatePromotions([LIVE20], ctx({ liveEligible: false }), 50);
        expect(ended.applied).toEqual([]);
        expect(ended.discountMinorUnits).toBe(0);
        expect(ended.netMinorUnits).toBe(100000);
    });
    it('never trusts the surface alone — a browse surface with a stale session id stays ineligible', () => {
        const result = evaluatePromotions(
            [LIVE20],
            ctx({ surface: 'browse', liveEligible: false, liveSessionId: 'session-1' }),
            50,
        );
        expect(result.applied).toEqual([]);
    });
});
describe('candidate classes: non-stackable means it combines with nothing', () => {
    it('seeded LIVE20 excludes WISHLIST5, which is reported as not_stackable', () => {
        const result = evaluatePromotions(
            [LIVE20, WISHLIST5],
            ctx({ userSegments: ['has_wishlisted'] }),
            50,
        );
        expect(result.applied.map((a) => a.code)).toEqual(['LIVE20']);
        expect(result.suppressed).toEqual([
            { code: 'WISHLIST5', label: 'WISHLIST5 label', reason: 'not_stackable' },
        ]);
    });
    it('flipping LIVE20.stackable to true is exactly what permits the combination', () => {
        const result = evaluatePromotions(
            [{ ...LIVE20, stackable: true }, WISHLIST5],
            ctx({ userSegments: ['has_wishlisted'] }),
            50,
        );
        expect(result.applied.map((a) => a.code).sort()).toEqual(['LIVE20', 'WISHLIST5']);
        expect(result.discountMinorUnits).toBe(25000);
        expect(result.suppressed).toEqual([]);
    });
    it('prefers a single large non-stackable over a smaller stackable set', () => {
        const result = evaluatePromotions(
            [LIVE20, WISHLIST5, promo({ code: 'TINY', value: 1, stackable: true })],
            ctx({ userSegments: ['has_wishlisted'] }),
            50,
        );
        expect(result.applied.map((a) => a.code)).toEqual(['LIVE20']);
        expect(result.suppressed.map((s) => s.reason)).toEqual(['not_stackable', 'not_stackable']);
    });
});
describe('deterministic winner selection', () => {
    it('breaks an equal-discount tie on the highest contained priority', () => {
        const a = promo({ code: 'AAA', value: 10, priority: 1 });
        const b = promo({ code: 'BBB', value: 10, priority: 9 });
        expect(evaluatePromotions([a, b], ctx(), 50).applied.map((x) => x.code)).toEqual(['BBB']);
    });
    it('breaks a remaining tie on the lexicographically smallest code', () => {
        const a = promo({ code: 'ZZZ', value: 10, priority: 5 });
        const b = promo({ code: 'AAA', value: 10, priority: 5 });
        expect(evaluatePromotions([a, b], ctx(), 50).applied.map((x) => x.code)).toEqual(['AAA']);
    });
});
describe('kinds and clamping', () => {
    it('handles a flat rule without inventing a percentage', () => {
        const flat = promo({ code: 'FLAT500', kind: 'flat', value: 50000, priority: 5 });
        const result = evaluatePromotions([flat], ctx(), 50);
        expect(result.discountMinorUnits).toBe(50000);
    });
    it('clamps a flat rule larger than the line to the line gross, then to the cap', () => {
        const flat = promo({ code: 'FLATBIG', kind: 'flat', value: 999999 });
        const result = evaluatePromotions([flat], ctx(), 50);
        expect(result.discountMinorUnits).toBe(50000);
        expect(result.suppressed).toEqual([
            { code: 'FLATBIG', label: 'FLATBIG label', reason: 'capped' },
        ]);
    });
    it('multiplies by quantity', () => {
        const result = evaluatePromotions([LIVE20], ctx({ quantity: 3 }), 50);
        expect(result.grossMinorUnits).toBe(300000);
        expect(result.discountMinorUnits).toBe(60000);
    });
});
describe('the total cap', () => {
    it('trims the lowest-priority stackable contribution first and reports it capped', () => {
        const big = promo({ code: 'BIG', value: 40, priority: 90, stackable: true });
        const mid = promo({ code: 'MID', value: 30, priority: 50, stackable: true });
        const low = promo({ code: 'LOW', value: 20, priority: 10, stackable: true });
        const result = evaluatePromotions([big, mid, low], ctx(), 50);
        expect(result.discountMinorUnits).toBeLessThanOrEqual(50000);
        expect(result.applied.map((a) => a.code)).toEqual(['BIG']);
        expect(result.suppressed.map((s) => s.code)).toEqual(['LOW', 'MID']);
        expect(result.suppressed.every((s) => s.reason === 'capped')).toBe(true);
    });
    it('clamps a lone non-stackable winner when there is nothing left to trim', () => {
        const huge = promo({ code: 'HUGE', value: 80, priority: 5 });
        const result = evaluatePromotions([huge], ctx(), 50);
        expect(result.discountMinorUnits).toBe(50000);
        expect(result.applied).toEqual([{ code: 'HUGE', label: 'HUGE label', minorUnits: 50000 }]);
        expect(result.suppressed).toEqual([
            { code: 'HUGE', label: 'HUGE label', reason: 'capped' },
        ]);
    });
});
describe('conditions', () => {
    it('reports an exhausted per-user cap as redemption_limit rather than dropping it silently', () => {
        const limited = promo({
            code: 'ONCE',
            value: 25,
            conditions: { maxRedemptionsPerUser: 1 },
        });
        const fresh = evaluatePromotions([limited], ctx(), 50);
        expect(fresh.applied.map((a) => a.code)).toEqual(['ONCE']);
        const used = evaluatePromotions(
            [limited],
            ctx({ redemptionsByPromotionId: { ONCE: 1 } }),
            50,
        );
        expect(used.applied).toEqual([]);
        expect(used.suppressed).toEqual([
            { code: 'ONCE', label: 'ONCE label', reason: 'redemption_limit' },
        ]);
    });
    it('excludes a rule outside its validity window', () => {
        const expired = promo({ code: 'OLD', value: 30, validUntil: '2025-12-31T00:00:00Z' });
        const future = promo({ code: 'SOON', value: 30, validFrom: '2026-06-01T00:00:00Z' });
        expect(evaluatePromotions([expired, future], ctx(), 50).applied).toEqual([]);
    });
    it('honours category, line-value and order-value conditions', () => {
        const beauty = promo({
            code: 'BEAUTY15',
            value: 15,
            conditions: { categorySlugs: ['cosmetics'], minLineMinorUnits: 99900 },
        });
        expect(evaluatePromotions([beauty], ctx(), 50).applied).toEqual([]);
        expect(
            evaluatePromotions([beauty], ctx({ categorySlug: 'cosmetics' }), 50).applied.map(
                (a) => a.code,
            ),
        ).toEqual(['BEAUTY15']);
        expect(
            evaluatePromotions(
                [beauty],
                ctx({
                    categorySlug: 'cosmetics',
                    unitPriceMinorUnits: 50000,
                    orderSubtotalMinorUnits: 50000,
                }),
                50,
            ).applied,
        ).toEqual([]);
    });
    it('is order-independent: shuffling the input cannot change the outcome', () => {
        const rules = [
            LIVE20,
            WISHLIST5,
            promo({ code: 'MID', value: 12, stackable: true, priority: 3 }),
        ];
        const forward = evaluatePromotions(rules, ctx({ userSegments: ['has_wishlisted'] }), 50);
        const reversed = evaluatePromotions(
            [...rules].reverse(),
            ctx({ userSegments: ['has_wishlisted'] }),
            50,
        );
        expect(reversed.discountMinorUnits).toBe(forward.discountMinorUnits);
        expect(reversed.applied).toEqual(forward.applied);
    });
});
