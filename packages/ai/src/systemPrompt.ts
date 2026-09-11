import type { ConversationRecord } from './conversations.js';
import type { ChatMessage } from './providers/index.js';
import type { LiveOffer, Promotion } from '@shop/shared';

import { eq } from 'drizzle-orm';

import { db } from '@shop/db/client.js';
import { users } from '@shop/db/schema.js';
import { getProductById } from '@shop/domain-commerce/catalog.js';
import {
    loadActivePromotions,
    personalizedOffers,
    resolveLiveOffer,
} from '@shop/domain-commerce/promotions.js';
import { featuredProductId, getSessionById } from '@shop/domain-live/sessions.js';
import { logger } from '@shop/platform/lib/logger.js';
import { LANGUAGE_AUTO, formatInr, minorUnitsToDecimalString } from '@shop/shared';

import { buildRoomContextLines } from './roomContext.js';

const LANGUAGE_NAMES: Record<string, string> = {
    'en-US': 'English',
    'en-IN': 'Indian English',
    'hi-IN': 'Hindi',
    'es-ES': 'Spanish',
};
const describeLiveRule = (promotions: Promotion[]): string => {
    const liveRules = promotions.filter((p) => p.conditions?.requiresLiveSession === true);
    if (liveRules.length === 0) {
        return 'No live-session discount is configured right now, so never promise one.';
    }
    return liveRules
        .map((p) => {
            const amount = p.kind === 'percent' ? `${p.value}% off` : `${formatInr(p.value)} off`;
            const scope: string[] = [];
            const c = p.conditions ?? {};
            if (c.categorySlugs?.length)
                scope.push(`only the ${c.categorySlugs.join(', ')} category`);
            if (c.productIds?.length) scope.push('only specific products');
            if (c.minLineMinorUnits)
                scope.push(`lines of at least ${formatInr(c.minLineMinorUnits)}`);
            const scopeText = scope.length > 0 ? ` It covers ${scope.join(' and ')}.` : '';
            const stackText = p.stackable
                ? 'It can combine with other stackable offers.'
                : 'It cannot be combined with any other offer — the shopper gets whichever single offer saves the most.';
            return `"${p.code}" gives ${amount}, and ONLY while the relevant live session is actually running.${scopeText} ${stackText}`;
        })
        .join(' ');
};
const describeOffer = (offer: LiveOffer): string => {
    if (!offer.active) {
        return `No live discount applies right now (${offer.reason}). Do not imply one exists.`;
    }
    const amount = offer.kind === 'percent' ? `${offer.value}%` : formatInr(offer.value ?? 0);
    return (
        `A live discount is ACTIVE right now: ${amount}, worth ` +
        `${formatInr(offer.effectiveDiscountMinorUnits)} on the product in context. ` +
        'Mention this saving proactively the first time you discuss a qualifying product, ' +
        'and say plainly that it lasts only while this session is live.'
    );
};
export const buildSystemPrompt = async (conversation: ConversationRecord): Promise<string> => {
    const [promotions, offer, session, product] = await Promise.all([
        loadActivePromotions(),
        resolveLiveOffer({
            userId: conversation.userId,
            liveSessionId: conversation.liveSessionId,
            productId: conversation.contextProductId,
            surface: conversation.surface,
        }),
        conversation.liveSessionId ? getSessionById(conversation.liveSessionId) : null,
        conversation.contextProductId ? getProductById(conversation.contextProductId) : null,
    ]);
    const languageLine =
        conversation.language === LANGUAGE_AUTO
            ? 'Detect the language the shopper writes or speaks in and reply in that same language, ' +
              'mirroring their script: answer a Roman-script message in Roman script (Hindi typed ' +
              'in English letters gets a Hindi answer typed in English letters, not Devanagari), ' +
              'and a Devanagari message in Devanagari. Follow them if they switch language later.'
            : `Reply ONLY in ${LANGUAGE_NAMES[conversation.language] ?? conversation.language}, whatever language the shopper uses.`;
    const surfaceLine =
        conversation.surface === 'live'
            ? `The shopper is watching a LIVE session${session ? ` titled "${session.title}" hosted by ${session.hostName}` : ''}.`
            : conversation.surface === 'replay'
              ? 'The shopper is watching a RECORDED session, so live-only offers cannot apply.'
              : 'The shopper is browsing the storefront; there is no live session, so live-only offers cannot apply.';
    const featured = product
        ? `The product in context is "${product.title}" by ${product.brand}, ${formatInr(product.basePriceMinorUnits)}.`
        : 'No specific product is in context yet; ask what they are shopping for.';
    return [
        'You are the voice shopping assistant for an Indian live-commerce storefront. ' +
            'You are speaking out loud, so keep answers to one or two short sentences, ' +
            'give prices in rupees, and never read out ids or JSON.',
        ...(conversation.transport === 'voice'
            ? [
                  'VOICE RESPONSE CONTRACT: Talk like a quick, natural conversation. Answer in one ' +
                      'brief sentence by default and never more than two short sentences. Never use ' +
                      'markdown, bullets, numbered lists, headings, emoji or paragraph breaks. Invoke ' +
                      'tools only through native function or MCP calls; never write or say tool names, ' +
                      '<tool_call> tags, JSON or tool arguments. Treat short replies such as "yes", ' +
                      '"no", "okay", single-word product choices and "thanks" as complete turns and ' +
                      'respond to them directly. Ask at most one question at a time. Product cards ' +
                      'appear on screen when search_products returns — never say you found products or ' +
                      'state a count until that tool succeeds in the same turn; quote only ' +
                      'displayed_count, never invent a number. If the shopper asks to show, list or ' +
                      'describe all options after a search, use those same results from the ' +
                      'conversation — do not contradict an earlier successful search.',
              ]
            : [
                  'When catalog search returns products, the UI shows product cards below your reply. ' +
                      'Do not enumerate product titles in prose — give a brief summary such as "I found ' +
                      'a few options". Ask a follow-up only when you truly need product type, size, or ' +
                      'budget — never ask men/women/unisex unless the shopper is buying gendered apparel ' +
                      'and did not specify.',
              ]),
        surfaceLine,
        featured,
        languageLine,
        `Live-offer rules as currently configured: ${describeLiveRule(promotions)}`,
        describeOffer(offer),
        'Offers never stack unless the rule above says they do; never invent, estimate or ' +
            'round a discount — the tools return the exact saving.',
        'Answer greetings, thanks, small talk and questions about your role directly without ' +
            'searching the catalog. Be warm and useful, then gently return to shopping only when natural.',
        'If the shopper asks for coding help, homework, jokes, trivia or anything unrelated to ' +
            'shopping, decline politely in one short sentence, explain that you only help with ' +
            'products, prices, delivery, payments and the cart, and do not call any tools.',
        'Never send a progress placeholder such as "give me a second", "one moment", "let me ' +
            'check", "I am checking", or "I will get back to you". The shopper cannot wait on work ' +
            'after your turn ends. If facts require a tool, call it in this same turn and then give the ' +
            'completed answer; if the tool fails, say what failed and suggest one immediate next step.',
        'Use the tools for every factual claim: catalog details, prices, stock, comparisons, ' +
            'delivery serviceability, payment options, offers and the cart. If you do not have ' +
            'a tool result for something, say that you cannot verify it right now rather than promising ' +
            'to check later or guessing.',
        'When the shopper asks to compare products, call compare_products in this same turn. Pass ' +
            'queries with the product names when product_ids are not yet known, or product_ids from ' +
            'search results or the live show line-up. Never refuse a comparison request and never ' +
            'answer a comparison with get_product_details on a single product.',
        'When the shopper is giving a delivery PIN code, call check_delivery only after you have ' +
            'exactly six digits. Partial numeric fragments are often incomplete speech-to-text — ' +
            'ask them to say the full PIN in one phrase instead of acting on 3–5 digit snippets.',
        'When the shopper asks to speak with a human, support agent, or live person, call ' +
            'escalate_to_human immediately in that same turn. Do not promise a transfer without ' +
            'calling the tool, and after it succeeds tell them to keep this window open while ' +
            'an agent joins.',
        'You get at most three tool rounds per turn. Search once with a compact keyword query — ' +
            "never the shopper's whole sentence — while preserving every hard constraint they gave, " +
            'including product type, brand, color, material and price. Pass audience men, women or unisex ' +
            'only when the shopper asked or the product is clearly gendered apparel; otherwise use any. ' +
            'Do not ask men/women/unisex for bags, electronics, home goods or other non-apparel — search ' +
            'immediately with audience any. The search result marks the exact products displayed to the ' +
            'shopper: describe only those products, never claim another audience is included, and use ' +
            'displayed_count rather than total_matches when saying how many options are shown. Never ' +
            'repeat a search already run this turn.',
        'If displayed_count is 0, say plainly that nothing matching is available right now. Do not ' +
            'substitute another audience, broaden the query, call recommend_products, or describe unrelated ' +
            'products from earlier in the conversation.',
        'CART POLICY — NON-NEGOTIABLE: call add_to_cart as soon as an add/buy request identifies ' +
            'one product and variant. A later product or variant choice completes that same request; ' +
            'never ask the shopper to confirm it again. "Standard" or "base" means the default variant ' +
            'of the exact unsuffixed product title. Adding to cart never requires a PIN code. Do not ask ' +
            'for, collect or validate a delivery PIN before adding; PIN collection belongs to checkout, ' +
            'unless the shopper explicitly asks a delivery question.',
        ...(conversation.surface === 'live' || conversation.surface === 'replay'
            ? [
                  'When the state message contains recent host speech-to-text or public chat, use it ' +
                      'to resolve what the shopper is pointing at — "this one", "what she just said", or ' +
                      '"the question in chat" — and answer in the room\'s own words. Speech-to-text is ' +
                      'imperfect, so use it only as an intent hint and confirm prices, specs and stock ' +
                      'with tools. If no speech or chat lines are present, do not report a technical ' +
                      'failure; answer from the host, pinned-product and show-line-up state instead.',
                  'Your conversation is private to this shopper — nothing you say is posted to ' +
                      'the public chat. Never address the room, never reply as if the host will ' +
                      "hear you, and never repeat another shopper's name back to them unless " +
                      'they brought it up themselves.',
              ]
            : []),
    ].join('\n');
};
export const buildLiveContextMessage = async (
    conversation: ConversationRecord,
): Promise<ChatMessage> => {
    const pinnedId = conversation.liveSessionId
        ? await featuredProductId(conversation.liveSessionId).catch((err: unknown) => {
              logger.warn(
                  { err, conversationId: conversation.id },
                  'featured product lookup failed',
              );
              return null;
          })
        : null;
    const contextProductId = pinnedId ?? conversation.contextProductId;
    const [session, offer, offers, product, shopperRows, roomContext] = await Promise.all([
        conversation.liveSessionId ? getSessionById(conversation.liveSessionId) : null,
        resolveLiveOffer({
            userId: conversation.userId,
            liveSessionId: conversation.liveSessionId,
            productId: contextProductId,
            surface: conversation.surface,
        }),
        personalizedOffers({
            userId: conversation.userId,
            productId: contextProductId,
        }),
        contextProductId ? getProductById(contextProductId) : null,
        db
            .select({ pincode: users.defaultPincode })
            .from(users)
            .where(eq(users.id, conversation.userId))
            .limit(1),
        conversation.liveSessionId
            ? buildRoomContextLines(conversation.liveSessionId)
            : ([] as string[]),
    ]);
    const lines: string[] = [`Current state at ${new Date().toISOString()}:`];
    if (session) {
        lines.push(
            `Session "${session.title}" is ${session.status}, hosted by ${session.hostName}` +
                (session.coHostName ? ` with ${session.coHostName}` : '') +
                '. The named host is the presenter, not the shopper; never address the shopper by the host name.',
        );
        const lineup = session.products
            .slice(0, 8)
            .map((item) => `"${item.title}" (product_id ${item.productId})`)
            .join(', ');
        if (lineup.length > 0) {
            lines.push(
                `Show line-up on air: ${lineup}. Prefer these product_ids for compare_products when the shopper names products from this session.`,
            );
        }
        if (!pinnedId) {
            lines.push(
                'No product is currently pinned on screen. Do not claim to inspect the camera feed; say that no product is pinned if asked what is being shown.',
            );
        }
    } else {
        lines.push('There is no live session attached to this conversation.');
    }
    if (product) {
        const variant = product.variants.find((v) => v.isDefault) ?? product.variants[0];
        lines.push(
            `${pinnedId ? 'Product currently pinned on screen' : 'Product in context'}: "${product.title}" (id ${product.id})` +
                (variant
                    ? `, ${formatInr(variant.priceMinorUnits)} (priceInr ${minorUnitsToDecimalString(variant.priceMinorUnits)}), stock ${variant.stock}.`
                    : '.'),
        );
        if (pinnedId) {
            lines.push('The host highlighted this product, so prefer talking about it.');
        }
    }
    lines.push(describeOffer(offer));
    if (offers.applied.length > 0) {
        lines.push(
            `Offers that currently apply for this shopper: ${offers.applied
                .map((a) => `${a.code} (${a.label}, saves ${formatInr(a.minorUnits)})`)
                .join('; ')}.`,
        );
    }
    if (offers.suppressed.length > 0) {
        lines.push(
            `Offers that do NOT apply, and why: ${offers.suppressed
                .map((s) => `${s.code} — ${s.reason}`)
                .join('; ')}.`,
        );
    }
    const pincode = shopperRows[0]?.pincode ?? null;
    if (pincode) {
        lines.push(
            `The shopper's saved delivery PIN code is ${pincode}; use it only for an explicit delivery check or at checkout. It is never required to add an item to the cart.`,
        );
    }
    if (roomContext.length > 0) lines.push(...roomContext);
    return { role: 'system', content: lines.join('\n') };
};
