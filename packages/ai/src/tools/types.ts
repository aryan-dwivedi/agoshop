import type { ToolName, toolSchemas } from '@shop/shared';
import type { z } from 'zod';

export type ToolInvocation = {
    [K in ToolName]: {
        name: K;
        args: z.infer<(typeof toolSchemas)[K]>;
    };
}[ToolName];
