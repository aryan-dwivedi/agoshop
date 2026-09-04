import type { PolicyRow } from '@shop/domain-commerce/checkoutPolicy.js';
import type { SQL } from 'drizzle-orm';

import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '@shop/db/client.js';
import { invalidateCatalogCache } from '@shop/domain-commerce/catalog.js';
import { invalidateCheckoutPolicyCache, toPolicy } from '@shop/domain-commerce/checkoutPolicy.js';
import { invalidatePromotionsCache } from '@shop/domain-commerce/promotions.js';
import { badRequest, conflict, notFound } from '@shop/platform/lib/errors.js';
import { publishGlobal } from '@shop/platform/lib/sse.js';
import { requireRole } from '@shop/platform/middleware/session.js';
import { EVENTS } from '@shop/shared';

export const router = Router();
const admin = requireRole('admin');
const conditions = z
    .object({
        surfaces: z.array(z.enum(['live', 'replay', 'browse'])).optional(),
        requiresLiveSession: z.boolean().optional(),
        categorySlugs: z.array(z.string().min(1)).optional(),
        productIds: z.array(z.string().uuid()).optional(),
        sellerIds: z.array(z.string().uuid()).optional(),
        minLineMinorUnits: z.number().int().nonnegative().optional(),
        minOrderMinorUnits: z.number().int().nonnegative().optional(),
        userSegments: z
            .array(z.enum(['first_order', 'has_wishlisted', 'loyalty_3plus']))
            .optional(),
        maxRedemptionsPerUser: z.number().int().positive().optional(),
    })
    .strict();
const createPromotion = z.object({
    code: z
        .string()
        .min(2)
        .max(40)
        .regex(/^[A-Z0-9_]+$/),
    label: z.string().min(1).max(120),
    description: z.string().max(400).optional(),
    kind: z.enum(['percent', 'flat']),
    value: z.number().int().positive(),
    priority: z.number().int().default(0),
    stackable: z.boolean().default(false),
    active: z.boolean().default(true),
    validFrom: z.string().datetime().nullable().optional(),
    validUntil: z.string().datetime().nullable().optional(),
    conditions: conditions.default({}),
});
const patchPromotion = createPromotion.partial();
const patchPolicy = z
    .object({
        minOrderMinorUnits: z.number().int().nonnegative().optional(),
        codMaxOrderMinorUnits: z.number().int().nonnegative().optional(),
        emiMinOrderMinorUnits: z.number().int().nonnegative().optional(),
        allowedMethods: z.array(z.enum(['card', 'upi', 'cod', 'emi', 'netbanking'])).optional(),
        blockedPincodes: z.array(z.string().regex(/^\d{6}$/)).optional(),
        requireServiceablePincode: z.boolean().optional(),
        active: z.boolean().optional(),
    })
    .strict();
type PromotionAdminRow = {
    id: string;
    code: string;
    label: string;
    description: string;
    kind: 'percent' | 'flat';
    value: number;
    priority: number;
    stackable: boolean;
    conditions: Record<string, unknown> | null;
    valid_from: string | null;
    valid_until: string | null;
    active: boolean;
    created_at: string;
    updated_at: string;
    redemption_count: number;
};
const PROMOTION_PROJECTION = sql`
  select p.id, p.code, p.label, p.description, p.kind::text as kind, p.value, p.priority,
         p.stackable, p.conditions, p.valid_from, p.valid_until, p.active,
         p.created_at, p.updated_at,
         (select count(*)::int from promotion_redemptions r where r.promotion_id = p.id)
           as redemption_count
  from promotions p`;
const toAdminPromotion = (r: PromotionAdminRow) => ({
    id: r.id,
    code: r.code,
    label: r.label,
    description: r.description,
    kind: r.kind,
    value: r.value,
    priority: r.priority,
    stackable: r.stackable,
    conditions: r.conditions ?? {},
    validFrom: r.valid_from ? new Date(r.valid_from).toISOString() : null,
    validUntil: r.valid_until ? new Date(r.valid_until).toISOString() : null,
    active: r.active,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    redemptionCount: r.redemption_count,
});
const afterPromotionChange = async (): Promise<void> => {
    await invalidatePromotionsCache();
    await invalidateCatalogCache();
    await publishGlobal(EVENTS.promotionsChanged, {
        changedAt: new Date().toISOString(),
    });
};
router.get('/api/admin/promotions', admin, async (_req, res, next) => {
    try {
        const { rows } = await db.execute<PromotionAdminRow>(
            sql`${PROMOTION_PROJECTION} order by p.priority desc, p.code asc`,
        );
        res.json({ promotions: rows.map(toAdminPromotion) });
    } catch (err) {
        next(err);
    }
});
router.post('/api/admin/promotions', admin, async (req, res, next) => {
    try {
        const parsed = createPromotion.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid promotion payload', {
                issues: parsed.error.issues,
            });
        }
        const p = parsed.data;
        const { rows: existing } = await db.execute<{
            id: string;
        }>(sql`select id from promotions where code = ${p.code}`);
        if (existing.length > 0) throw conflict('promotion_code_taken');
        const { rows } = await db.execute<{
            id: string;
        }>(sql`
      insert into promotions (code, label, description, kind, value, priority, stackable,
                              conditions, valid_from, valid_until, active)
      values (${p.code}, ${p.label}, ${p.description ?? ''}, ${p.kind}, ${p.value}, ${p.priority},
              ${p.stackable}, cast(${JSON.stringify(p.conditions)} as jsonb),
              cast(${p.validFrom ?? null} as timestamptz),
              cast(${p.validUntil ?? null} as timestamptz), ${p.active})
      returning id
    `);
        const id = rows[0]?.id;
        if (!id) throw conflict('promotion_code_taken');
        await afterPromotionChange();
        const { rows: created } = await db.execute<PromotionAdminRow>(
            sql`${PROMOTION_PROJECTION} where p.id = cast(${id} as uuid)`,
        );
        const row = created[0];
        if (!row) throw notFound('promotion_not_found');
        res.status(201).json({ promotion: toAdminPromotion(row) });
    } catch (err) {
        next(err);
    }
});
router.patch('/api/admin/promotions/:id', admin, async (req, res, next) => {
    try {
        const promotionId = z.string().uuid().safeParse(req.params.id);
        if (!promotionId.success) throw notFound('promotion_not_found');
        const parsed = patchPromotion.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid promotion patch', {
                issues: parsed.error.issues,
            });
        }
        const p = parsed.data;
        const sets: SQL[] = [];
        if (p.code !== undefined) sets.push(sql`code = ${p.code}`);
        if (p.label !== undefined) sets.push(sql`label = ${p.label}`);
        if (p.description !== undefined) sets.push(sql`description = ${p.description}`);
        if (p.kind !== undefined) sets.push(sql`kind = ${p.kind}`);
        if (p.value !== undefined) sets.push(sql`value = ${p.value}`);
        if (p.priority !== undefined) sets.push(sql`priority = ${p.priority}`);
        if (p.stackable !== undefined) sets.push(sql`stackable = ${p.stackable}`);
        if (p.active !== undefined) sets.push(sql`active = ${p.active}`);
        if (p.conditions !== undefined) {
            sets.push(sql`conditions = cast(${JSON.stringify(p.conditions)} as jsonb)`);
        }
        if (p.validFrom !== undefined) {
            sets.push(sql`valid_from = cast(${p.validFrom} as timestamptz)`);
        }
        if (p.validUntil !== undefined) {
            sets.push(sql`valid_until = cast(${p.validUntil} as timestamptz)`);
        }
        if (sets.length === 0) throw badRequest('empty_patch', 'nothing to update');
        sets.push(sql`updated_at = now()`);
        const { rowCount } = await db.execute(sql`
      update promotions set ${sql.join(sets, sql`, `)}
      where id = cast(${promotionId.data} as uuid)
    `);
        if (!rowCount) throw notFound('promotion_not_found');
        await afterPromotionChange();
        const { rows } = await db.execute<PromotionAdminRow>(
            sql`${PROMOTION_PROJECTION} where p.id = cast(${promotionId.data} as uuid)`,
        );
        const row = rows[0];
        if (!row) throw notFound('promotion_not_found');
        res.json({ promotion: toAdminPromotion(row) });
    } catch (err) {
        next(err);
    }
});
const SELECT_POLICY = sql`
  select id, name, min_order_minor_units, cod_max_order_minor_units, emi_min_order_minor_units,
         allowed_methods, blocked_pincodes, require_serviceable_pincode, active, updated_at
  from checkout_policies`;
router.get('/api/admin/checkout-policy', admin, async (_req, res, next) => {
    try {
        const { rows } = await db.execute<PolicyRow>(
            sql`${SELECT_POLICY} where active = true order by updated_at desc limit 1`,
        );
        const row = rows[0];
        if (!row) throw notFound('checkout_policy_not_found');
        res.json({ policy: toPolicy(row) });
    } catch (err) {
        next(err);
    }
});
router.patch('/api/admin/checkout-policy', admin, async (req, res, next) => {
    try {
        const parsed = patchPolicy.safeParse(req.body);
        if (!parsed.success) {
            throw badRequest('validation_failed', 'invalid checkout policy patch', {
                issues: parsed.error.issues,
            });
        }
        const p = parsed.data;
        const sets: SQL[] = [];
        if (p.minOrderMinorUnits !== undefined) {
            sets.push(sql`min_order_minor_units = ${p.minOrderMinorUnits}`);
        }
        if (p.codMaxOrderMinorUnits !== undefined) {
            sets.push(sql`cod_max_order_minor_units = ${p.codMaxOrderMinorUnits}`);
        }
        if (p.emiMinOrderMinorUnits !== undefined) {
            sets.push(sql`emi_min_order_minor_units = ${p.emiMinOrderMinorUnits}`);
        }
        if (p.allowedMethods !== undefined) {
            sets.push(sql`allowed_methods = cast(${JSON.stringify(p.allowedMethods)} as jsonb)`);
        }
        if (p.blockedPincodes !== undefined) {
            sets.push(sql`blocked_pincodes = cast(${JSON.stringify(p.blockedPincodes)} as jsonb)`);
        }
        if (p.requireServiceablePincode !== undefined) {
            sets.push(sql`require_serviceable_pincode = ${p.requireServiceablePincode}`);
        }
        if (p.active !== undefined) sets.push(sql`active = ${p.active}`);
        if (sets.length === 0) throw badRequest('empty_patch', 'nothing to update');
        sets.push(sql`updated_at = now()`);
        const { rows } = await db.execute<PolicyRow>(sql`
      update checkout_policies set ${sql.join(sets, sql`, `)}
      where id = (select id from checkout_policies where active = true
                  order by updated_at desc limit 1)
      returning id, name, min_order_minor_units, cod_max_order_minor_units,
                emi_min_order_minor_units, allowed_methods, blocked_pincodes,
                require_serviceable_pincode, active, updated_at
    `);
        const row = rows[0];
        if (!row) throw notFound('checkout_policy_not_found');
        await invalidateCheckoutPolicyCache();
        const policy = toPolicy(row);
        await publishGlobal(EVENTS.checkoutPolicyChanged, { policy });
        res.json({ policy });
    } catch (err) {
        next(err);
    }
});
