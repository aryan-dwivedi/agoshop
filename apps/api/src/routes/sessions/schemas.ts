import type { SessionStatus } from '@shop/shared';

import { z } from 'zod';

export const idParam = z.string().uuid();
export const slugParam = z.string().min(1).max(80);
export const STATUSES: Record<string, SessionStatus> = {
    scheduled: 'scheduled',
    live: 'live',
    ended: 'ended',
};
export const createBody = z.object({
    title: z.string().min(1).max(200),
    slug: z.string().max(64).optional(),
    description: z.string().max(4000).optional(),
    hostName: z.string().max(120).optional(),
    scheduledFor: z.string().datetime().nullish(),
    language: z.string().max(16).optional(),
    expectedPeakViewers: z.number().int().min(1).max(1000000).optional(),
    coverImageUrl: z.string().max(500).nullish(),
    autoStart: z.boolean().optional(),
    discountPercent: z.number().int().min(0).max(90).nullish(),
    sellerId: z.string().uuid().optional(),
});
export const createRequest = createBody.extend({
    startNow: z.boolean().optional(),
});
export const updateBody = createBody
    .partial()
    .omit({ slug: true, sellerId: true, discountPercent: true });
export const productsBody = z.object({
    items: z
        .array(
            z.object({
                productId: z.string().uuid(),
                sortOrder: z.number().int().min(0).max(999).optional(),
                isFeatured: z.boolean().optional(),
            }),
        )
        .min(1)
        .max(50),
});
export const chatBody = z.object({
    messageId: z.string().min(1).max(80),
    text: z.string().min(1).max(500),
    productId: z.string().uuid().optional(),
});
export const moderationBody = z.object({
    action: z.enum(['mute', 'unmute', 'ban', 'delete_message']),
    targetUserId: z.string().uuid().nullish(),
    targetMessageId: z.string().uuid().nullish(),
});
export const pollBody = z.object({
    question: z.string().min(1).max(300),
    options: z.array(z.string().min(1).max(120)).min(2).max(6),
});
export const transcriptBody = z.object({
    lines: z
        .array(
            z.object({
                captionId: z.string().min(1).max(128),
                text: z.string().min(1).max(2000),
                language: z.string().min(2).max(16),
                startMs: z.number().int().min(0),
                speaker: z.string().min(1).max(32).optional(),
                finalized: z.boolean(),
                translatedText: z.record(z.string()).optional(),
            }),
        )
        .min(1)
        .max(50),
});
export const coHostBody = z.object({ email: z.string().email().max(200) });
