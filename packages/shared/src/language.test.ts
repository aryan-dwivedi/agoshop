import { describe, expect, it } from 'vitest';
import { LANGUAGE_AUTO, detectLanguage, resolveSpokenLanguage } from './language.js';
const SUPPORTED = ['en-US', 'hi-IN', 'es-ES'] as const;
describe('detectLanguage', () => {
    it('reads the writing system when there is one', () => {
        expect(detectLanguage('मुझे एक अच्छा फोन चाहिए', SUPPORTED)).toBe('hi-IN');
    });
    it('recognises romanised Hindi, which is how many shoppers actually type', () => {
        expect(detectLanguage('mujhe ek sasta phone chahiye', SUPPORTED)).toBe('hi-IN');
    });
    it('recognises Spanish from punctuation and from vocabulary', () => {
        expect(detectLanguage('¿Cuánto cuesta el altavoz?', SUPPORTED)).toBe('es-ES');
        expect(detectLanguage('quiero unos audifonos', SUPPORTED)).toBe('es-ES');
    });
    it('falls through to English for ordinary Latin text', () => {
        expect(detectLanguage('show me a cheap phone', SUPPORTED)).toBe('en-US');
    });
    it('reports nothing rather than guessing when there is no signal', () => {
        expect(detectLanguage('   ', SUPPORTED)).toBeNull();
        expect(detectLanguage('1234 !!', SUPPORTED)).toBeNull();
    });
    it('never returns a language the deployment does not support', () => {
        expect(detectLanguage('मुझे एक फोन चाहिए', ['en-US'])).toBeNull();
        expect(detectLanguage('show me a phone', ['hi-IN'])).toBeNull();
    });
});
describe('resolveSpokenLanguage', () => {
    it('leaves an explicit choice alone', () => {
        expect(resolveSpokenLanguage('hi-IN', SUPPORTED, { locale: 'es-ES' })).toBe('hi-IN');
    });
    it('prefers what the shopper has already typed over their browser locale', () => {
        expect(resolveSpokenLanguage(LANGUAGE_AUTO, SUPPORTED, {
            text: '¿Cuánto cuesta?',
            locale: 'en-US',
        })).toBe('es-ES');
    });
    it('falls back to the browser locale, matching on base language', () => {
        expect(resolveSpokenLanguage(LANGUAGE_AUTO, SUPPORTED, { locale: 'hi-IN' })).toBe('hi-IN');
        expect(resolveSpokenLanguage(LANGUAGE_AUTO, SUPPORTED, { locale: 'es-MX' })).toBe('es-ES');
    });
    it('falls back to the deployment default, never to the sentinel', () => {
        expect(resolveSpokenLanguage(LANGUAGE_AUTO, SUPPORTED, {})).toBe('en-US');
        expect(resolveSpokenLanguage(LANGUAGE_AUTO, SUPPORTED, { locale: 'ja-JP' })).toBe('en-US');
    });
});
