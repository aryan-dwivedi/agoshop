import { eq } from 'drizzle-orm';

import { formatInr, LANGUAGE_AUTO, minorUnitsToDecimalString } from '@shop/shared';
import type { LiveOffer, Promotion } from '@shop/shared';

import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { getProductById } from '../domain/catalog.js';
import {
  loadActivePromotions,
  personalizedOffers,
  resolveLiveOffer,
} from '../domain/promotions.js';
import { featuredProductId, getSessionById } from '../domain/sessions.js';
import { logger } from '../lib/logger.js';
import { buildRoomContextLines } from './roomContext.js';
import type { ChatMessage } from './providers/index.js';
import type { ConversationRecord } from './conversations.js';

/**
 * The assistant's instructions.
 *
 * Everything price- or promotion-shaped in here is READ THROUGH THE EVALUATOR at the
 * moment the prompt is built — never a constant and never prose copied from the plan.
 * Change `LIVE20` to 15%, to a flat amount, or to electronics-only via the admin API
 * and the very next request tells the agent the new rule, because
 * `resolveLiveOffer`/`loadActivePromotions` are the same code path the cart and
 * checkout use. That is decision 5, and it is why the live-context message is
 * recomputed on every single callback rather than cached.
 */

const LANGUAGE_NAMES: Record<string, string> = {
  'en-US': 'English',
  'en-IN': 'Indian English',
  'hi-IN': 'Hindi',
  'es-ES': 'Spanish',
};

/** Describes the configured live rule in the operator's own terms, whatever it is. */
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
      if (c.categorySlugs?.length) scope.push(`only the ${c.categorySlugs.join(', ')} category`);
      if (c.productIds?.length) scope.push('only specific products');
      if (c.minLineMinorUnits) scope.push(`lines of at least ${formatInr(c.minLineMinorUnits)}`);
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

  // An explicit choice stays a hard constraint; `auto` hands the choice to the shopper's
  // own words, turn by turn, because they may switch language mid-conversation.
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
            '"no", "okay" and "thanks" as complete turns and respond to them directly. Ask ' +
            'at most one question at a time.',
        ]
      : []),
    surfaceLine,
    featured,
    languageLine,
    `Live-offer rules as currently configured: ${describeLiveRule(promotions)}`,
    describeOffer(offer),
    'Offers never stack unless the rule above says they do; never invent, estimate or ' +
      'round a discount — the tools return the exact saving.',
    'Answer greetings, thanks, small talk and questions about your role directly without ' +
      'searching the catalog. Be warm and useful, then gently return to shopping only when natural.',
    'Never send a progress placeholder such as "give me a second", "one moment", "let me ' +
      'check", "I am checking", or "I will get back to you". The shopper cannot wait on work ' +
      'after your turn ends. If facts require a tool, call it in this same turn and then give the ' +
      'completed answer; if the tool fails, say what failed and suggest one immediate next step.',
    'Use the tools for every factual claim: catalog details, prices, stock, comparisons, ' +
      'delivery serviceability, payment options, offers and the cart. If you do not have ' +
      'a tool result for something, say that you cannot verify it right now rather than promising ' +
      'to check later or guessing.',
    'You get at most three tool rounds per turn. Search once with a short keyword query — ' +
      "a product noun, brand or feature word, never the shopper's whole sentence — then " +
      'answer from what came back. Never repeat a search you have already run this turn.',
    'If a search comes back empty, say plainly that the catalog has nothing matching and ' +
      'offer the closest product you did find; do not keep searching for it.',
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

/**
 * The live-context system message prefixed onto Agora's `messages` on EVERY callback.
 * Agora keeps its own bounded history and replays it verbatim, so anything that can
 * change mid-conversation — session status, whether the discount applies right now,
 * the pinned product — must be re-stated per request or the agent will happily quote a
 * discount that expired two minutes ago.
 */
export const buildLiveContextMessage = async (
  conversation: ConversationRecord,
): Promise<ChatMessage> => {
  const pinnedId = conversation.liveSessionId
    ? await featuredProductId(conversation.liveSessionId).catch((err: unknown) => {
        logger.warn({ err, conversationId: conversation.id }, 'featured product lookup failed');
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
    personalizedOffers({ userId: conversation.userId, productId: contextProductId }),
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
    if (!pinnedId) {
      const lineup = session.products
        .slice(0, 8)
        .map((item) => `"${item.title}"`)
        .join(', ');
      lines.push(
        'No product is currently pinned on screen.' +
          (lineup.length > 0 ? ` The show line-up is ${lineup}.` : '') +
          ' Do not claim to inspect the camera feed; say that no product is pinned if asked what is being shown.',
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

  // Last, and deliberately so: the room is the freshest thing in the prompt, and a
  // model reading top-to-bottom should hit "here is what was just said" immediately
  // before the shopper's own turn.
  if (roomContext.length > 0) lines.push(...roomContext);

  return { role: 'system', content: lines.join('\n') };
};
