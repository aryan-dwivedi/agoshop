import type { Surface } from '@shop/shared';

export const BROWSE_ASSISTANT_EXAMPLES = [
    'Find the best deals for me',
    'Help me pick a gift under ₹5,000',
    'Compare top-rated skincare',
    'Check delivery to 560001',
    'Show me everyday essentials',
] as const;
export const ASSISTANT_EXAMPLES: Record<Surface, readonly string[]> = {
    browse: BROWSE_ASSISTANT_EXAMPLES,
    live: [
        'Compare the two moisturisers the host just showed.',
        'Does it deliver to 560001, and is COD available?',
        'Add the featured one to my cart.',
    ],
    replay: [
        'What did the host say about the fit?',
        'Compare it with two cheaper alternatives.',
        'Does it deliver to 560001, and is COD available?',
    ],
};
