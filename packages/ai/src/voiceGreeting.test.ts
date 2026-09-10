import { describe, expect, it } from 'vitest';

import { formatVoiceGreeting } from './voiceGreeting.js';

describe('formatVoiceGreeting', () => {
    it('uses open browse copy by default', () => {
        expect(
            formatVoiceGreeting({ surface: 'browse', spokenLanguage: 'en-US' }),
        ).toBe("Hi! I'm here to help with whatever you're shopping for — what can I do for you?");
    });

    it('personalizes browse greetings with a first name', () => {
        expect(
            formatVoiceGreeting({
                surface: 'browse',
                spokenLanguage: 'en-US',
                firstName: 'Sarah',
            }),
        ).toBe("Hi Sarah! I'm here to help — what can I do for you?");
    });

    it('uses live-surface wording', () => {
        expect(
            formatVoiceGreeting({ surface: 'live', spokenLanguage: 'en-US' }),
        ).toBe("Hi! I'm here if you need anything while you watch — just ask.");
    });

    it('uses replay-surface wording', () => {
        expect(
            formatVoiceGreeting({ surface: 'replay', spokenLanguage: 'en-US' }),
        ).toBe(
            "Hi! I'm here to help with anything in this replay — what would you like to know?",
        );
    });

    it('falls back to en-US for unknown languages', () => {
        expect(
            formatVoiceGreeting({ surface: 'browse', spokenLanguage: 'fr-FR' }),
        ).toBe("Hi! I'm here to help with whatever you're shopping for — what can I do for you?");
    });

    it('returns Hindi greetings without listing capabilities', () => {
        expect(
            formatVoiceGreeting({ surface: 'browse', spokenLanguage: 'hi-IN' }),
        ).toBe('नमस्ते! जो भी आपको चाहिए, मैं मदद के लिए यहाँ हूँ — बताइए।');
    });

    it('returns Spanish greetings', () => {
        expect(
            formatVoiceGreeting({ surface: 'browse', spokenLanguage: 'es-ES' }),
        ).toBe('¡Hola! Estoy aquí para ayudarte con lo que necesites — ¿en qué puedo ayudarte?');
    });
});
