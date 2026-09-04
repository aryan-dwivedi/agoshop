import type { z } from 'zod';
import { toolSchemas } from '@shop/shared';
import type { ToolName } from '@shop/shared';
export type ToolInvocation = {
    [K in ToolName]: {
        name: K;
        args: z.infer<(typeof toolSchemas)[K]>;
    };
}[ToolName];
