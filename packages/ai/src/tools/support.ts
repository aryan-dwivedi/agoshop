import type { ConversationRecord } from '../conversations.js';
import type { ToolInvocation } from './types.js';

import { escalateToHuman } from '../support.js';

type SupportToolInvocation = Extract<
    ToolInvocation,
    {
        name: 'escalate_to_human';
    }
>;
export const runSupportTool = async (
    conversation: ConversationRecord,
    call: SupportToolInvocation,
): Promise<Record<string, unknown>> => {
    return escalateToHuman({
        conversationId: conversation.id,
        userId: conversation.userId,
        reason: call.args.reason,
        orderId: call.args.order_id ?? null,
        preference: call.args.preference,
        phoneE164: call.args.phone_e164 ?? null,
    });
};
