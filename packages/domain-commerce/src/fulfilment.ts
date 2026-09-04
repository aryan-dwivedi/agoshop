import type { FulfilmentStatus, OrderDto } from '@shop/shared';

import { sql } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { notFound } from '@shop/platform/lib/errors.js';

type FulfilmentRow = {
    id: string;
    status: OrderDto['status'];
    created_at: string;
    subtotal_minor_units: number;
    discount_minor_units: number;
    total_minor_units: number;
    payment_method: OrderDto['paymentMethod'];
    payment_ref: string;
    pincode: string;
    fulfilment_status: FulfilmentStatus | null;
    tracking_number: string | null;
    carrier: string | null;
    estimated_delivery_at: string | null;
    items: OrderDto['items'] | null;
};
const FULFILMENT_PROJECTION = sql`
  select o.id, o.status::text as status, o.created_at,
         o.subtotal_minor_units, o.discount_minor_units, o.total_minor_units,
         o.payment_method, o.payment_ref, o.pincode,
         o.fulfilment_status::text as fulfilment_status,
         o.tracking_number, o.carrier, o.estimated_delivery_at,
         (select json_agg(json_build_object(
                    'productId', oi.product_id,
                    'productSlug', p.slug,
                    'productTitle', p.title,
                    'variantLabel', pv.label,
                    'quantity', oi.quantity,
                    'unitPriceMinorUnits', oi.unit_price_minor_units,
                    'lineDiscountMinorUnits', oi.line_discount_minor_units,
                    'appliedPromotionCodes', oi.applied_promotion_codes,
                    'liveSessionId', oi.live_session_id,
                    'liveSessionTitle', ls.title) order by oi.id asc)
          from order_items oi
          join products p on p.id = oi.product_id
          join product_variants pv on pv.id = oi.variant_id
          left join live_sessions ls on ls.id = oi.live_session_id
          where oi.order_id = o.id) as items
  from orders o`;
const toDto = (r: FulfilmentRow): OrderDto => ({
    id: r.id,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    subtotalMinorUnits: r.subtotal_minor_units,
    discountMinorUnits: r.discount_minor_units,
    totalMinorUnits: r.total_minor_units,
    paymentMethod: r.payment_method,
    paymentRef: r.payment_ref,
    pincode: r.pincode,
    fulfilmentStatus: r.fulfilment_status,
    trackingNumber: r.tracking_number,
    carrier: r.carrier,
    estimatedDeliveryAt: r.estimated_delivery_at
        ? new Date(r.estimated_delivery_at).toISOString()
        : null,
    items: (r.items ?? []).map((i) => ({
        productId: i.productId,
        productSlug: i.productSlug,
        productTitle: i.productTitle,
        variantLabel: i.variantLabel,
        quantity: i.quantity,
        unitPriceMinorUnits: i.unitPriceMinorUnits,
        lineDiscountMinorUnits: i.lineDiscountMinorUnits,
        appliedPromotionCodes: i.appliedPromotionCodes ?? [],
        liveSessionId: i.liveSessionId,
        liveSessionTitle: i.liveSessionTitle,
    })),
});
export const listOrdersWithFulfilment = async (userId: string, limit = 5): Promise<OrderDto[]> => {
    const bounded = Math.min(Math.max(1, limit), 10);
    const { rows } = await db.execute<FulfilmentRow>(sql`
    ${FULFILMENT_PROJECTION}
    where o.user_id = cast(${userId} as uuid) and o.status = 'paid'
    order by o.created_at desc
    limit ${bounded}
  `);
    return rows.map(toDto);
};
export const getOrderFulfilmentStatus = async (
    userId: string,
    orderId: string,
): Promise<OrderDto> => {
    const { rows } = await db.execute<FulfilmentRow>(sql`
    ${FULFILMENT_PROJECTION}
    where o.id = cast(${orderId} as uuid) and o.user_id = cast(${userId} as uuid)
    limit 1
  `);
    const row = rows[0];
    if (!row) throw notFound('order_not_found');
    return toDto(row);
};
