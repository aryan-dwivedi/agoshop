import type { ConversationRecord } from '../conversations.js';
import type { SurfacedProducts } from '../surfacedProducts.js';
import type { ToolInvocation } from './types.js';

import { runCatalogTool } from './catalog.js';
import { runCommerceTool } from './commerce.js';
import { getConversationContext } from './context.js';
import { runFulfilmentTool } from './fulfilment.js';
import { runSupportTool } from './support.js';

export type { ToolInvocation } from './types.js';
export const runTool = async (
    conversation: ConversationRecord,
    call: ToolInvocation,
    surfaced: SurfacedProducts,
): Promise<Record<string, unknown>> => {
    switch (call.name) {
        case 'get_conversation_context':
            return getConversationContext(conversation);
        case 'search_products':
        case 'get_product_details':
        case 'compare_products':
        case 'recommend_products':
            return runCatalogTool(conversation, call, surfaced);
        case 'check_delivery':
        case 'get_payment_options':
        case 'get_live_offer':
        case 'get_personalized_offers':
        case 'get_cart':
        case 'add_to_cart':
        case 'add_to_wishlist':
            return runCommerceTool(conversation, call, surfaced);
        case 'list_my_orders':
        case 'get_order_status':
            return runFulfilmentTool(conversation, call);
        case 'escalate_to_human':
            return runSupportTool(conversation, call);
    }
};
