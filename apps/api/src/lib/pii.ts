import { env } from '../env.js';
const PATTERNS: [
    RegExp,
    string
][] = [
    [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]'],
    [/\b(?:\+91[-\s]?|0)?[6-9]\d{9}\b/g, '[phone]'],
    [/\b[\w.-]{2,}@(?:okhdfcbank|oksbi|okaxis|okicici|paytm|ybl|upi)\b/gi, '[upi]'],
    [/\b(?:\d[ -]?){13,19}\b/g, '[card]'],
];
export const redact = (text: string): string => {
    if (!env.PII_REDACTION)
        return text;
    let out = text;
    for (const [pattern, replacement] of PATTERNS)
        out = out.replace(pattern, replacement);
    return out;
};
export const persistBodies = env.PRIVACY_MODE !== 'strict';
