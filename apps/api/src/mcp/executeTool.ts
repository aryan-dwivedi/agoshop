import { randomUUID } from 'node:crypto';

import type { ToolName } from '@shop/shared';

import type { ConversationRecord } from '../ai/conversations.js';
import { executeToolCalls } from '../ai/toolExecutor.js';
import { SurfacedProducts } from '../ai/surfacedProducts.js';

/**
 * Single-tool entry used by the MCP HTTP server and (in-process) by the text transport.
 */
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
