import type { z } from 'zod';

import { toolSchemas } from '@shop/shared';
import type { ToolName } from '@shop/shared';

/**
 * A validated call: the tool name and the arguments its own schema produced, correlated
 * so a `switch` on `name` narrows `args` exactly.
 */
export type ToolInvocation = {
  [K in ToolName]: { name: K; args: z.infer<(typeof toolSchemas)[K]> };
}[ToolName];
