import { describe, expect, it } from 'vitest';

import { displayAssistantText } from './displayAssistantText';

describe('displayAssistantText', () => {
    it('decodes common HTML entities', () => {
        expect(displayAssistantText('Grain &amp; Grow')).toBe('Grain & Grow');
    });

    it('collapses enumerated product lists when cards are shown', () => {
        const enumerated =
            'I found Gerber Baby Snacks, Fofosbeauty Nails, TIYOMI Thermal Underwear and more. Which one interests you?';

        expect(displayAssistantText(enumerated, 3)).toBe(
            'I found a few options. Which one interests you?',
        );
    });

    it('leaves text unchanged when there are no product cards', () => {
        const enumerated = 'I found Foo, Bar and more. Which one interests you?';

        expect(displayAssistantText(enumerated, 0)).toBe(enumerated);
    });

    it('keeps a single-product reply when only one card is shown', () => {
        const single = 'I found Wireless Earbuds. Want details or should I add it to your cart?';

        expect(displayAssistantText(single, 1)).toBe(single);
    });
});
