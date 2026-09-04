export const LANGUAGE_AUTO = 'auto';
export const LANGUAGE_LABELS: Record<string, string> = {
    [LANGUAGE_AUTO]: 'Auto-detect',
    'en-US': 'English',
    'en-IN': 'English (India)',
    'hi-IN': 'हिंदी · Hindi',
    'es-ES': 'Español · Spanish',
};
export const languageLabel = (code: string): string => LANGUAGE_LABELS[code] ?? code;
const DEVANAGARI = /[\u0900-\u097F]/;
const ARABIC = /[\u0600-\u06FF]/;
const HINDI_ROMAN = [
    'mujhe',
    'chahiye',
    'kitna',
    'kitne',
    'kaisa',
    'kaise',
    'acha',
    'accha',
    'sasta',
    'mehnga',
    'kya',
    'nahi',
    'hai',
    'karo',
    'dikhao',
    'batao',
    'paisa',
    'kharid',
];
const SPANISH_MARKERS = [
    'quiero',
    'necesito',
    'cuánto',
    'cuanto',
    'cuesta',
    'barato',
    'entrega',
    'gracias',
    'productos',
    'mejor',
    'para',
    'tienes',
];
const baseOf = (code: string): string => code.split('-')[0]!.toLowerCase();
export const detectLanguage = (text: string, supported: readonly string[]): string | null => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return null;
    let base: string | null = null;
    if (DEVANAGARI.test(trimmed)) base = 'hi';
    else if (ARABIC.test(trimmed)) base = 'ar';
    else {
        const words = trimmed
            .toLowerCase()
            .split(/[^\p{L}\p{M}]+/u)
            .filter(Boolean);
        if (/[¿¡]/.test(trimmed) || /[ñáéíóú]/.test(trimmed.toLowerCase())) base = 'es';
        else if (words.some((w) => HINDI_ROMAN.includes(w))) base = 'hi';
        else if (words.some((w) => SPANISH_MARKERS.includes(w))) base = 'es';
        else if (words.length > 0) base = 'en';
    }
    if (base === null) return null;
    return supported.find((code) => baseOf(code) === base) ?? null;
};
export const resolveSpokenLanguage = (
    requested: string,
    supported: readonly string[],
    hints: {
        text?: string | null;
        locale?: string | null;
    } = {},
): string => {
    const fallback = supported[0] ?? 'en-US';
    if (requested !== LANGUAGE_AUTO) return requested;
    if (hints.text) {
        const detected = detectLanguage(hints.text, supported);
        if (detected) return detected;
    }
    if (hints.locale) {
        const locale = hints.locale;
        const exact = supported.find((code) => code.toLowerCase() === locale.toLowerCase());
        if (exact) return exact;
        const byBase = supported.find((code) => baseOf(code) === baseOf(locale));
        if (byBase) return byBase;
    }
    return fallback;
};
