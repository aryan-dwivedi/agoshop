import { sql } from 'drizzle-orm';

import type { CheckoutOptionsDto, PaymentMethod } from '@shop/shared';

import { db } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { keys, redis } from '../lib/redis.js';
import { checkDelivery } from './serviceability.js';

/**
 * Checkout policy is data too (decision 6). Minimum order value, the COD ceiling, the
 * EMI floor, allowed methods and pincode gating live in one `checkout_policies` row.
 *
 * `availablePaymentMethods` is the ONE function behind both `GET /api/checkout/options`
 * and the AI's `get_payment_options` tool, so the page and the assistant cannot disagree.
 */

export type CheckoutPolicy = {
  id: string;
  name: string;
  minOrderMinorUnits: number;
  codMaxOrderMinorUnits: number;
  emiMinOrderMinorUnits: number;
  allowedMethods: PaymentMethod[];
  blockedPincodes: string[];
  requireServiceablePincode: boolean;
  active: boolean;
  updatedAt: string;
};

type PolicyRow = {
  id: string;
  name: string;
  min_order_minor_units: number;
  cod_max_order_minor_units: number;
  emi_min_order_minor_units: number;
  allowed_methods: PaymentMethod[] | null;
  blocked_pincodes: string[] | null;
  require_serviceable_pincode: boolean;
  active: boolean;
  updated_at: string;
};

const toPolicy = (r: PolicyRow): CheckoutPolicy => ({
  id: r.id,
  name: r.name,
  minOrderMinorUnits: r.min_order_minor_units,
  codMaxOrderMinorUnits: r.cod_max_order_minor_units,
  emiMinOrderMinorUnits: r.emi_min_order_minor_units,
  allowedMethods: r.allowed_methods ?? [],
  blockedPincodes: r.blocked_pincodes ?? [],
  requireServiceablePincode: r.require_serviceable_pincode,
  active: r.active,
  updatedAt: new Date(r.updated_at).toISOString(),
});

const SELECT_ACTIVE = sql`
  select id, name, min_order_minor_units, cod_max_order_minor_units, emi_min_order_minor_units,
         allowed_methods, blocked_pincodes, require_serviceable_pincode, active, updated_at
  from checkout_policies
  where active = true
  order by updated_at desc
  limit 1`;

const loadFromDb = async (): Promise<CheckoutPolicy> => {
  const { rows } = await db.execute<PolicyRow>(SELECT_ACTIVE);
  const row = rows[0];
  if (!row) {
    // No silent defaults: pricing rules are never guessed.
    throw new AppError(
      503,
      'checkout_policy_unavailable',
      'no active checkout_policies row — run npm run db:seed',
    );
  }
  return toPolicy(row);
};

/** Redis-cached for 60 s; an admin edit calls `invalidateCheckoutPolicyCache`. */
export const loadActivePolicy = async (): Promise<CheckoutPolicy> => {
  try {
    const hit = await redis.get(keys.checkoutPolicyCache);
    if (hit !== null) return JSON.parse(hit) as CheckoutPolicy;
  } catch (err) {
    logger.warn({ err }, 'checkout policy cache read failed; loading from postgres');
  }
  const policy = await loadFromDb();
  try {
    await redis.set(keys.checkoutPolicyCache, JSON.stringify(policy), 'EX', 60);
  } catch (err) {
    logger.warn({ err }, 'checkout policy cache write failed');
  }
  return policy;
};

export const invalidateCheckoutPolicyCache = async (): Promise<void> => {
  await redis.del(keys.checkoutPolicyCache);
};

/**
 * `blockedReason` non-null means the order cannot be placed at all, and `methods` is
 * empty; checkout rejects with exactly that code and the AI states the same reason.
 */
export const availablePaymentMethods = async (a: {
  totalMinorUnits: number;
  pincode?: string | null;
}): Promise<CheckoutOptionsDto> => {
  const policy = await loadActivePolicy();
  const pincode = a.pincode?.trim() || null;

  const delivery = pincode ? await checkDelivery(pincode) : null;
  const pincodeServiceable = delivery ? delivery.serviceable : null;
  const etaDays = delivery?.etaDays ?? null;

  const blocked = (reason: string): CheckoutOptionsDto => ({
    methods: [],
    minOrderMinorUnits: policy.minOrderMinorUnits,
    blockedReason: reason,
    pincodeServiceable,
    etaDays,
  });

  if (pincode && policy.blockedPincodes.includes(pincode)) return blocked('pincode_blocked');
  if (policy.requireServiceablePincode) {
    if (!pincode) return blocked('pincode_required');
    if (!delivery?.serviceable) return blocked('pincode_not_serviceable');
  }
  if (a.totalMinorUnits < policy.minOrderMinorUnits) return blocked('below_min_order');

  const methods = policy.allowedMethods.filter((method) => {
    if (method === 'cod') {
      if (a.totalMinorUnits > policy.codMaxOrderMinorUnits) return false;
      if (delivery && !delivery.codAvailable) return false;
      // COD without a pincode cannot be promised.
      return delivery !== null;
    }
    if (method === 'emi') return a.totalMinorUnits >= policy.emiMinOrderMinorUnits;
    return true;
  });

  return {
    methods,
    minOrderMinorUnits: policy.minOrderMinorUnits,
    blockedReason: null,
    pincodeServiceable,
    etaDays,
  };
};

export { toPolicy };
export type { PolicyRow };
