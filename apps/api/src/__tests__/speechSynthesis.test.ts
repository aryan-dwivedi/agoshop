import { describe, expect, it } from 'vitest';

import { normalizeSpeechText, splitSpeechText } from '../ai/speechSynthesis.js';

describe('speech synthesis text preparation', () => {
  it('turns storefront notation into words the voice can pronounce', () => {
    expect(
      normalizeSpeechText(
        '**VoltCore** is ₹1,299 after 20% off, with 8 GB RAM, a 5000 mAh battery and 30 W charging. 🔥',
        'en-IN',
      ),
    ).toBe(
      'VoltCore is 1,299 rupees after 20 percent off with 8 gigabytes RAM a 5000 milliamp hours battery and 30 watts charging.',
    );
  });

  it('shortens punctuation pauses without changing the visible response', () => {
    expect(normalizeSpeechText('First sentence. Next clause, then finish.', 'en-US')).toBe(
      'First sentence, Next clause then finish.',
    );
  });

  it('keeps neural inference chunks within the model context without losing words', () => {
    const input = `${'A natural sentence with useful product details. '.repeat(12)}Final answer.`;
    const chunks = splitSpeechText(input);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 320)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(input.trim().replace(/\s+/g, ' '));
  });
});
