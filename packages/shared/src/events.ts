/** Every SSE event name. Server publishes through Redis; clients switch on these. */
export const EVENTS = {
  cartUpdated: 'cart.updated',
  sessionStatusChanged: 'session.status_changed',
  sessionDeliveryTierChanged: 'session.delivery_tier_changed',
  sessionProductPinned: 'session.product_pinned',
  sessionViewersChanged: 'session.viewers_changed',
  sessionReactions: 'session.reactions',
  sessionCaption: 'session.caption',
  pollOpened: 'poll.opened',
  pollResults: 'poll.results',
  pollClosed: 'poll.closed',
  chatModerated: 'chat.moderated',
  aiToolExecuted: 'ai.tool_executed',
  /** Products the assistant surfaced this turn, so voice answers render cards too. */
  aiProductsShown: 'ai.products_shown',
  orderCreated: 'order.created',
  orderUpdated: 'order.updated',
  recordingReady: 'recording.ready',
  promotionsChanged: 'promotions.changed',
  checkoutPolicyChanged: 'checkout_policy.changed',
  /** A seller moved a variant's MRP, price or stock: every cached price is suspect. */
  catalogPriceChanged: 'catalog.price_changed',
  /** A host moved this room's live-only markdown mid-show. */
  sessionPricingChanged: 'session.pricing_changed',
  /** Shopper escalated from AI assistant to human support. */
  supportEscalated: 'support.escalated',
  /** Support agent published their microphone and completed the RTC join. */
  supportAgentJoined: 'support.agent_joined',
  /** The support agent ended the human voice call. */
  supportCallEnded: 'support.call_ended',
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

/** Redis pub/sub channels. One subscriber connection per API process. */
export const userChannel = (userId: string): string => `events:user:${userId}`;
export const sessionChannel = (sessionId: string): string => `events:session:${sessionId}`;
export const GLOBAL_CHANNEL = 'events:global';

export type ServerEvent<T = unknown> = {
  event: EventName;
  data: T;
  ts: number;
};
