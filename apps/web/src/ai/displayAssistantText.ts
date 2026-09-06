const decodeHtmlEntities = (text: string): string =>
    text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;|&apos;/g, "'");

const ENUMERATED_SEARCH = /^I found .+, .+/i;

/** Display copy for assistant bubbles — does not alter stored text or voice transcripts. */
export const displayAssistantText = (text: string, productCount = 0): string => {
    const decoded = decodeHtmlEntities(text);
    if (productCount === 0) return decoded;

    if (ENUMERATED_SEARCH.test(decoded) || / and more/i.test(decoded)) {
        const followUp = decoded.match(
            /(Which one interests you\?|Want details or should I add it to your cart\?)$/i,
        );
        const question = followUp?.[1] ?? 'Which one interests you?';
        return `I found a few options. ${question}`;
    }

    return decoded;
};
