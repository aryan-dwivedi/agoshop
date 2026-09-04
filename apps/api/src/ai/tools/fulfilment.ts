import type { OrderDto } from '@shop/shared';
import type { ConversationRecord } from '../conversations.js';
import { getOrderFulfilmentStatus, listOrdersWithFulfilment, } from '../../domain/fulfilment.js';
import type { ToolInvocation } from './types.js';
type FulfilmentToolInvocation = Extract<ToolInvocation, {
    name: 'list_my_orders' | 'get_order_status';
}>;
const orderStatusPayload = (order: OrderDto): Record<string, unknown> => ({
    order_id: order.id,
    payment_status: order.status,
    fulfilment_status: order.fulfilmentStatus,
    tracking_number: order.trackingNumber,
    carrier: order.carrier,
    estimated_delivery_at: order.estimatedDeliveryAt,
    pincode: order.pincode,
    items: order.items.map((i) => ({
        title: i.productTitle,
        variant: i.variantLabel,
        quantity: i.quantity,
    })),
});
export const runFulfilmentTool = async (conversation: ConversationRecord, call: FulfilmentToolInvocation): Promise<Record<string, unknown>> => {
    switch (call.name) {
        case 'list_my_orders': {
            const orders = await listOrdersWithFulfilment(conversation.userId, call.args.limit ?? 5);
            return {
                orders: orders.map((o) => ({
                    order_id: o.id,
                    status: o.status,
                    fulfilment_status: o.fulfilmentStatus,
                    tracking_number: o.trackingNumber,
                    carrier: o.carrier,
                    estimated_delivery_at: o.estimatedDeliveryAt,
                    total_inr: o.totalMinorUnits / 100,
                    item_count: o.items.length,
                    created_at: o.createdAt,
                })),
            };
        }
        case 'get_order_status': {
            if (call.args.order_id) {
                const order = await getOrderFulfilmentStatus(conversation.userId, call.args.order_id);
                return orderStatusPayload(order);
            }
            const [latest] = await listOrdersWithFulfilment(conversation.userId, 1);
            if (!latest) {
                return {
                    orders: [],
                    message: 'No paid orders found for this account.',
                };
            }
            return {
                ...orderStatusPayload(latest),
                note: 'Returned your most recent order because no order_id was specified.',
            };
        }
    }
};
