/**
 * Assistant language: auto-detect with an explicit override.
 *
 * Two different questions have to be answered, and they do not have the same answer:
 *
 *   1. Which language should the assistant REPLY in? The model itself is the best
 *      detector there is, so in auto mode the system prompt tells it to mirror the
 *      shopper's language rather than pinning one. Nothing here overrides that.
 *   2. Which language should speech recognition be configured for? ASR needs a
 *      concrete code before the shopper has said a word, so a guess is unavoidable —
 *      and `detectLanguage` below is that guess, refined from the shopper's typed
 *      text and their browser locale.
 *
 * So the detector is a cheap, dependency-free heuristic used for ASR configuration
 * and transcript labelling — never as a gate on what the model may say. It is
 * deliberately script-first (writing system is a near-certain signal) with a small
 * romanised-Hindi and Spanish keyword pass, because "mujhe ek acha phone chahiye"
 * typed in Latin script is a real shopper, not an edge case.
 */

/** Sentinel stored in place of a language code when the shopper wants auto-detect. */
export const LANGUAGE_AUTO = 'auto';

/** Human labels for the picker. Codes not listed fall back to the raw code. */
export const LANGUAGE_LABELS: Record<string, string> = {
  [LANGUAGE_AUTO]: 'Auto-detect',
  'en-US': 'English',
  'en-IN': 'English (India)',
  'hi-IN': 'हिंदी · Hindi',
  'es-ES': 'Español · Spanish',
};

export const languageLabel = (code: string): string => LANGUAGE_LABELS[code] ?? code;

/** Devanagari block: Hindi/Marathi and friends. */
const DEVANAGARI = /[\u0900-\u097F]/;
/** Arabic script, used here only to avoid mislabelling it as English. */
const ARABIC = /[\u0600-\u06FF]/;

/**
 * Romanised Hindi markers. Chosen to be words that do not also occur in English or
 * Spanish product talk, so a single hit is meaningful.
 */
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

/** Spanish markers: inverted punctuation is decisive, the rest are common words. */
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

/**
 * Detects the base language of `text` ('hi' | 'es' | 'en') and resolves it to a code
 * from `supported`. Returns null when there is no usable signal or no supported code
 * matches, which callers read as "keep whatever you were going to use".
 */
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

/**
 * The concrete code to configure ASR with, given the shopper's choice. In auto mode
 * this prefers what they have already typed, then their browser locale, then the
 * deployment default — a best guess that the model's reply is not bound by.
 */
export const resolveSpokenLanguage = (
  requested: string,
  supported: readonly string[],
  hints: { text?: string | null; locale?: string | null } = {},
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
