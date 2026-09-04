import type { ConversationRecord } from '../conversations.js';
import type { ToolName } from '@shop/shared';
import { randomUUID } from 'node:crypto';

import { SurfacedProducts } from '../surfacedProducts.js';
import { executeToolCalls } from '../toolExecutor.js';

export const executeNamedTool = async (
    conversation: ConversationRecord,
    turnId: number,
    name: ToolName,
    args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
    const surfaced = new SurfacedProducts();
    const [executed] = await executeToolCalls(
        conversation,
        turnId,
        [{ id: `mcp_${randomUUID()}`, name, arguments: JSON.stringify(args) }],
        surfaced,
        { path: 'direct' },
    );
    return executed?.result ?? { error: { code: 'tool_failed', message: 'no result' } };
};
