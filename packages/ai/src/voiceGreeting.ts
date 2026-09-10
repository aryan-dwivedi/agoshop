import type { Surface } from '@shop/shared';

type GreetingCopy = {
    generic: string;
    named: string;
};

const GREETING_BY_LANGUAGE: Record<string, Record<Surface, GreetingCopy>> = {
    'en-US': {
        browse: {
            generic: "Hi! I'm here to help with whatever you're shopping for — what can I do for you?",
            named: "Hi {name}! I'm here to help — what can I do for you?",
        },
        live: {
            generic: "Hi! I'm here if you need anything while you watch — just ask.",
            named: "Hi {name}! I'm here if you need anything while you watch — just ask.",
        },
        replay: {
            generic: "Hi! I'm here to help with anything in this replay — what would you like to know?",
            named: "Hi {name}! I'm here to help with anything in this replay — what would you like to know?",
        },
    },
    'en-IN': {
        browse: {
            generic: "Hi! I'm here to help with whatever you're shopping for — what can I do for you?",
            named: "Hi {name}! I'm here to help — what can I do for you?",
        },
        live: {
            generic: "Hi! I'm here if you need anything while you watch — just ask.",
            named: "Hi {name}! I'm here if you need anything while you watch — just ask.",
        },
        replay: {
            generic: "Hi! I'm here to help with anything in this replay — what would you like to know?",
            named: "Hi {name}! I'm here to help with anything in this replay — what would you like to know?",
        },
    },
    'hi-IN': {
        browse: {
            generic: 'नमस्ते! जो भी आपको चाहिए, मैं मदद के लिए यहाँ हूँ — बताइए।',
            named: 'नमस्ते {name}! मैं मदद के लिए यहाँ हूँ — बताइए।',
        },
        live: {
            generic: 'नमस्ते! देखते समय किसी भी बात में मदद चाहिए तो पूछिए।',
            named: 'नमस्ते {name}! देखते समय किसी भी बात में मदद चाहिए तो पूछिए।',
        },
        replay: {
            generic: 'नमस्ते! इस रिप्ले में जो भी जानना है, मैं मदद कर सकता हूँ — बताइए।',
            named: 'नमस्ते {name}! इस रिप्ले में जो भी जानना है, मैं मदद कर सकता हूँ — बताइए।',
        },
    },
    'es-ES': {
        browse: {
            generic: '¡Hola! Estoy aquí para ayudarte con lo que necesites — ¿en qué puedo ayudarte?',
            named: '¡Hola {name}! Estoy aquí para ayudarte — ¿en qué puedo ayudarte?',
        },
        live: {
            generic: '¡Hola! Si necesitas algo mientras ves el directo, solo pregunta.',
            named: '¡Hola {name}! Si necesitas algo mientras ves el directo, solo pregunta.',
        },
        replay: {
            generic:
                '¡Hola! Estoy aquí para ayudarte con lo que necesites de esta repetición — ¿qué te gustaría saber?',
            named:
                '¡Hola {name}! Estoy aquí para ayudarte con lo que necesites de esta repetición — ¿qué te gustaría saber?',
        },
    },
};

export const formatVoiceGreeting = (opts: {
    surface: Surface;
    spokenLanguage: string;
    firstName?: string | null;
}): string => {
    const templates =
        GREETING_BY_LANGUAGE[opts.spokenLanguage] ?? GREETING_BY_LANGUAGE['en-US']!;
    const copy = templates[opts.surface];
    if (opts.firstName) {
        return copy.named.replace('{name}', opts.firstName);
    }
    return copy.generic;
};
