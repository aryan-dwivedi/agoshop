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
    aiProductsShown: 'ai.products_shown',
    orderCreated: 'order.created',
    orderUpdated: 'order.updated',
    recordingReady: 'recording.ready',
    promotionsChanged: 'promotions.changed',
    checkoutPolicyChanged: 'checkout_policy.changed',
    catalogPriceChanged: 'catalog.price_changed',
    sessionPricingChanged: 'session.pricing_changed',
    supportEscalated: 'support.escalated',
    supportAgentJoined: 'support.agent_joined',
    supportCallEnded: 'support.call_ended',
} as const;
export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
export const userChannel = (userId: string): string => `events:user:${userId}`;
export const sessionChannel = (sessionId: string): string => `events:session:${sessionId}`;
export const GLOBAL_CHANNEL = 'events:global';
export type ServerEvent<T = unknown> = {
    event: EventName;
    data: T;
    ts: number;
};
