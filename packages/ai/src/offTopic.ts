const GREETING =
    /^[\s!.,]*(?:hi|hey|hello|hiya|namaste|ji|yo|sup|good\s+(?:morning|afternoon|evening)|thanks?|thank\s+you)[\s!.,]*$/iu;

const SHOPPING_INTENT =
    /\b(?:search(?:\s+for)?|find(?:\s+me)?|show\s+me|looking\s+for|recommend|compare|add\s+to\s+cart|in\s+(?:my\s+)?cart|checkout|deliver(?:y|ies)?|ship(?:ping)?|pin\s*code|pincode|serviceable|price|stock|variant|size|colour|color|offer|discount|warranty|return\s+policy|refund|payment|upi|cod|cash\s+on\s+delivery|emi|order|buy\s+(?:this|that|it|the|one|these|those|\w+(?:\s+\w+){0,3}))\b/iu;

const SHOPPING_PREFIX =
    /\b(?:i\s+)?(?:need|want|looking\s+for|find(?:\s+me)?|search(?:\s+for)?|show\s+me|get(?:\s+me)?|any)\s+(.+)/iu;

const CODING_INTENT =
    /\b(?:fibonacci|factorial|palindrome|leetcode|hackerrank|hello\s+world)\b|(?:\b(?:write|give|show|print)\b.{0,40}\b(?:go|golang|python|java|javascript|typescript|rust|c\+\+|c#|ruby|swift|kotlin)\b(?:\s+(?:code|program|script))?)|(?:\b(?:go|python|java|javascript|typescript)\s+code\b)|(?:\b(?:code|program(?:ming)?|algorithm|debug|compile|syntax)\s+(?:for|to)\b)|(?:\bhomework\b)|(?:\bsolve\s+(?:this|the)\s+(?:math|equation|problem)\b)/iu;

const GENERAL_KNOWLEDGE =
    /\b(?:who\s+(?:is|was|are|were)|what\s+is\s+the\s+(?:capital|meaning|definition)|tell\s+me\s+a\s+joke|write\s+(?:a\s+)?(?:poem|story|essay)|translate\s+(?:this|to))\b/iu;

const SHOPPING_BAIT =
    /\b(?:then|only|after\s+that|first)\s+(?:i\s+)?(?:can|will|would)\s+(?:buy|purchase|shop)\b/iu;

export const OFF_TOPIC_REPLY =
    "I'm here to help with shopping — finding products, prices, delivery, and your cart. What would you like to browse?";

export const isOffTopicShoppingMessage = (text: string): boolean => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || GREETING.test(trimmed)) return false;
    if (SHOPPING_INTENT.test(trimmed) && !SHOPPING_BAIT.test(trimmed)) return false;
    const prefixed = SHOPPING_PREFIX.exec(trimmed);
    if (prefixed?.[1] && !CODING_INTENT.test(prefixed[1]) && !GENERAL_KNOWLEDGE.test(prefixed[1])) {
        return false;
    }
    return CODING_INTENT.test(trimmed) || GENERAL_KNOWLEDGE.test(trimmed);
};

export const extractShoppingSearchQuery = (text: string): string | null => {
    const trimmed = text.trim().replace(/[?.!]+$/u, '').trim();
    if (trimmed.length === 0 || GREETING.test(trimmed) || isOffTopicShoppingMessage(trimmed)) {
        return null;
    }
    const prefixed = SHOPPING_PREFIX.exec(trimmed);
    if (prefixed?.[1]) return prefixed[1].trim().slice(0, 200);
    if (SHOPPING_INTENT.test(trimmed)) return trimmed.slice(0, 200);
    return null;
};
