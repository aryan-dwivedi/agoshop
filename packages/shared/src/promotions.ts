import { percentOf } from './money.js';

/**
 * The ONLY place discount semantics exist. Pure, deterministic, exhaustively tested.
 * Cart, checkout, the AI tools and the tests all call `evaluatePromotions`.
 */

export type Surface = 'live' | 'replay' | 'browse';

export type UserSegment = 'first_order' | 'has_wishlisted' | 'loyalty_3plus';

export type PromotionCondition = {
  surfaces?: Surface[];
  requiresLiveSession?: boolean;
  categorySlugs?: string[];
  productIds?: string[];
  sellerIds?: string[];
  minLineMinorUnits?: number;
  minOrderMinorUnits?: number;
  userSegments?: UserSegment[];
  maxRedemptionsPerUser?: number;
};

export type Promotion = {
  id: string;
  code: string;
  label: string;
  kind: 'percent' | 'flat';
  value: number;
  priority: number;
  stackable: boolean;
  conditions: PromotionCondition;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
  active: boolean;
};

/**
 * A single cart/checkout line, fully resolved against relational truth.
 * Only `resolveLineContext` (server, domain/eligibility.ts) may construct this:
 * `liveEligible` is the authoritative answer to "does the live rule apply here".
 */
export type LineContext = {
  surface: Surface;
  liveEligible: boolean;
  liveSessionId: string | null;
  categorySlug: string;
  productId: string;
  sellerId: string;
  unitPriceMinorUnits: number;
  quantity: number;
  orderSubtotalMinorUnits: number;
  userSegments: UserSegment[];
  redemptionsByPromotionId: Record<string, number>;
  now: Date;
};

export type AppliedPromotion = { code: string; label: string; minorUnits: number };

export type SuppressedReason = 'not_stackable' | 'capped' | 'redemption_limit';

export type SuppressedPromotion = { code: string; label: string; reason: SuppressedReason };

export type PromotionEvaluation = {
  grossMinorUnits: number;
  discountMinorUnits: number;
  netMinorUnits: number;
  applied: AppliedPromotion[];
  suppressed: SuppressedPromotion[];
};

/** Raw discount this promotion would produce on this line, clamped to line gross. */
export const rawDiscountFor = (promotion: Promotion, grossMinorUnits: number): number => {
  const raw =
    promotion.kind === 'percent' ? percentOf(grossMinorUnits, promotion.value) : promotion.value;
  return Math.max(0, Math.min(raw, grossMinorUnits));
};

/**
 * Conditions other than `maxRedemptionsPerUser`, which is deliberately checked after
 * selection so an exhausted promotion is *reported* rather than silently vanishing.
 */
const passesConditions = (promotion: Promotion, ctx: LineContext): boolean => {
  if (!promotion.active) return false;

  const from = promotion.validFrom == null ? null : new Date(promotion.validFrom);
  const until = promotion.validUntil == null ? null : new Date(promotion.validUntil);
  if (from && ctx.now < from) return false;
  if (until && ctx.now > until) return false;

  const c = promotion.conditions ?? {};
  if (c.surfaces && !c.surfaces.includes(ctx.surface)) return false;
  // The live rule consults resolved relational truth, never a client-supplied flag.
  if (c.requiresLiveSession && !ctx.liveEligible) return false;
  if (c.categorySlugs && !c.categorySlugs.includes(ctx.categorySlug)) return false;
  if (c.productIds && !c.productIds.includes(ctx.productId)) return false;
  if (c.sellerIds && !c.sellerIds.includes(ctx.sellerId)) return false;

  const gross = ctx.unitPriceMinorUnits * ctx.quantity;
  if (c.minLineMinorUnits != null && gross < c.minLineMinorUnits) return false;
  if (c.minOrderMinorUnits != null && ctx.orderSubtotalMinorUnits < c.minOrderMinorUnits) {
    return false;
  }
  if (c.userSegments && !c.userSegments.some((s) => ctx.userSegments.includes(s))) return false;

  return true;
};

type Candidate = {
  members: Promotion[];
  /** Per-promotion discount before the total cap. */
  amounts: Map<string, number>;
  total: number;
  maxPriority: number;
  /** Lexicographically smallest contained code — the final deterministic tie-break. */
  tieCode: string;
};

const buildCandidate = (members: Promotion[], gross: number): Candidate => {
  const amounts = new Map<string, number>();
  let total = 0;
  for (const p of members) {
    // Each stackable promotion is computed against the ORIGINAL gross, then the
    // sum is clamped below; this keeps the result order-independent.
    const amount = rawDiscountFor(p, gross);
    amounts.set(p.id, amount);
    total += amount;
  }
  total = Math.min(total, gross);
  return {
    members,
    amounts,
    total,
    maxPriority: members.reduce((m, p) => Math.max(m, p.priority), Number.NEGATIVE_INFINITY),
    tieCode: members.map((p) => p.code).sort()[0] ?? '',
  };
};

/**
 * `stackable:false` means the promotion cannot combine with ANY other promotion.
 * Exactly two candidate classes therefore exist:
 *   (a) each eligible non-stackable promotion, alone;
 *   (b) the combined set of all eligible stackable promotions.
 * Winner: largest realized discount, then highest contained priority, then
 * lexicographically smallest code.
 */
export function evaluatePromotions(
  all: Promotion[],
  ctx: LineContext,
  maxTotalPct: number,
): PromotionEvaluation {
  const grossMinorUnits = ctx.unitPriceMinorUnits * ctx.quantity;
  const suppressed: SuppressedPromotion[] = [];

  const eligible = all.filter((p) => passesConditions(p, ctx));

  const available: Promotion[] = [];
  for (const p of eligible) {
    const perUserCap = p.conditions?.maxRedemptionsPerUser;
    const used = ctx.redemptionsByPromotionId[p.id] ?? 0;
    if (perUserCap != null && used >= perUserCap) {
      suppressed.push({ code: p.code, label: p.label, reason: 'redemption_limit' });
    } else {
      available.push(p);
    }
  }

  if (grossMinorUnits <= 0 || available.length === 0) {
    return {
      grossMinorUnits,
      discountMinorUnits: 0,
      netMinorUnits: grossMinorUnits,
      applied: [],
      suppressed,
    };
  }

  const stackables = available.filter((p) => p.stackable);
  const nonStackables = available.filter((p) => !p.stackable);

  const candidates: Candidate[] = nonStackables.map((p) => buildCandidate([p], grossMinorUnits));
  if (stackables.length > 0) candidates.push(buildCandidate(stackables, grossMinorUnits));

  candidates.sort(
    (a, b) =>
      b.total - a.total || b.maxPriority - a.maxPriority || a.tieCode.localeCompare(b.tieCode),
  );

  const winner = candidates[0]!;
  const capMinorUnits = percentOf(grossMinorUnits, maxTotalPct);

  // Apply the total cap to the winning candidate: drop lowest-priority stackable
  // contributions first; a lone non-stackable has nothing to trim, so clamp it.
  const kept = [...winner.members].sort(
    (a, b) => b.priority - a.priority || a.code.localeCompare(b.code),
  );
  const amounts = new Map(winner.amounts);
  let total = winner.total;

  while (total > capMinorUnits && kept.length > 1) {
    const dropped = kept.pop()!;
    total -= amounts.get(dropped.id) ?? 0;
    amounts.delete(dropped.id);
    suppressed.push({ code: dropped.code, label: dropped.label, reason: 'capped' });
  }

  if (total > capMinorUnits && kept.length === 1) {
    const only = kept[0]!;
    amounts.set(only.id, capMinorUnits);
    total = capMinorUnits;
    suppressed.push({ code: only.code, label: only.label, reason: 'capped' });
  }

  const winnerIds = new Set(kept.map((p) => p.id));
  for (const p of available) {
    if (!winnerIds.has(p.id) && !suppressed.some((s) => s.code === p.code)) {
      suppressed.push({ code: p.code, label: p.label, reason: 'not_stackable' });
    }
  }

  const applied: AppliedPromotion[] = kept
    .filter((p) => (amounts.get(p.id) ?? 0) > 0)
    .map((p) => ({ code: p.code, label: p.label, minorUnits: amounts.get(p.id)! }));

  const discountMinorUnits = applied.reduce((sum, a) => sum + a.minorUnits, 0);

  return {
    grossMinorUnits,
    discountMinorUnits,
    netMinorUnits: grossMinorUnits - discountMinorUnits,
    applied,
    suppressed,
  };
}

/**
 * What the AI's `get_live_offer` tool returns. Never assumes a percentage:
 * a flat live rule reports kind:'flat' with its real effective amount.
 */
export type LiveOffer = {
  active: boolean;
  kind: 'percent' | 'flat' | null;
  value: number | null;
  effectiveDiscountMinorUnits: number;
  eligibleProductIds: string[];
  reason: string;
};
