import type { ConversationRecord } from '../conversations.js';
import type { ToolName } from '@shop/shared';

import { CATALOG_SURFACE_TOOLS, publishProductsShown } from '../speakable.js';
import { SurfacedProducts } from '../surfacedProducts.js';
import { executeToolCalls } from '../toolExecutor.js';

export const executeNamedTool = async (
    conversation: ConversationRecord,
    turnId: number,
    toolCallId: string,
    name: ToolName,
    args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
    const surfaced = new SurfacedProducts();
    const [executed] = await executeToolCalls(
        conversation,
        turnId,
        [{ id: toolCallId, name, arguments: JSON.stringify(args) }],
        surfaced,
        { path: 'direct' },
    );
    const result = executed?.result ?? { error: { code: 'tool_failed', message: 'no result' } };
    if (executed?.outcome === 'ok' && CATALOG_SURFACE_TOOLS.has(name)) {
        const products = surfaced.cards('');
        await publishProductsShown(conversation, turnId, products).catch(() => undefined);
    }
    return result;
};
