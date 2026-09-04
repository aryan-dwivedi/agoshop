import type { AppliedPromotion, LiveOffer, Surface, SuppressedPromotion } from './promotions.js';

/** Wire contracts shared by the API and the web app. */

export type Role = 'shopper' | 'seller' | 'admin' | 'support';

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  defaultPincode: string | null;
  preferredLanguage: string;
  /**
   * True for an auto-provisioned shopper who never signed in. The row is real and
   * carries a real cart and real orders; the flag exists so the UI can offer to
   * upgrade it instead of pretending the shopper has an account.
   */
  isGuest: boolean;
};

export type AppConfig = {
  agoraAppId: string;
  /** The RTM publisher the chat UI trusts. Never hardcode the literal client-side. */
  chatServiceAccount: string;
  supportedLanguages: string[];
  privacyMode: 'standard' | 'strict';
  features: {
    convoai: boolean;
    mediaPush: boolean;
    recording: boolean;
    transcription: boolean;
  };
};

/**
 * Every price a shopper can be shown, computed once on the server.
 *
 * Three tiers, in the order a shopper reads them: the MRP it is marked down from,
 * the shop price they pay today, and the live price they pay only while a session
 * is on air. Percentages ride along because a client that divides two numbers
 * eventually disagrees with the server that charged the card.
 */
export type PriceLadderDto = {
  /** Manufacturer's list price. `null` when the seller has not published one. */
  mrpMinorUnits: number | null;
  /** The authoritative catalog price — what is charged outside a live session. */
  shopMinorUnits: number;
  /**
   * What is charged while the session is on air. `null` when no live rule applies,
   * which is also the only honest answer outside a live surface.
   */
  liveMinorUnits: number | null;
  /** `shopMinorUnits - liveMinorUnits`, or 0 when there is no live price. */
  liveDiscountMinorUnits: number;
  /** Whole percent off MRP for the shop price; `null` without an MRP. */
  shopOffPercent: number | null;
  /** Whole percent off the shop price while live; `null` without a live price. */
  liveOffPercent: number | null;
};

export type VariantDto = {
  id: string;
  sku: string;
  label: string;
  attrs: Record<string, string>;
  priceMinorUnits: number;
  /** Tier 1. Nullable: not every product is marked down from a list price. */
  mrpMinorUnits: number | null;
  stock: number;
  isDefault: boolean;
};

export type ProductDto = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  description: string;
  categorySlug: string;
  sellerId: string;
  sellerName: string;
  highlights: string[];
  specs: Record<string, string>;
  images: string[];
  rating: number;
  ratingCount: number;
  basePriceMinorUnits: number;
  /** Tier 1 for the default variant — saves listings walking `variants`. */
  mrpMinorUnits: number | null;
  variants: VariantDto[];
};

export type ComparisonDto = {
  attributes: string[];
  rows: {
    productId: string;
    title: string;
    priceMinorUnits: number;
    rating: number;
    values: Record<string, string>;
  }[];
};

export type CartNotice = 'live_discount_active' | 'live_discount_expired' | 'promotion_applied';

export type CartLineDto = {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string;
  variantId: string;
  variantLabel: string;
  imageUrl: string | null;
  quantity: number;
  liveSessionId: string | null;
  liveEligible: boolean;
  pricing: {
    unitPriceMinorUnits: number;
    /** Tier 1 for this line's variant, per unit. `null` when unpublished. */
    unitMrpMinorUnits: number | null;
    grossMinorUnits: number;
    discountMinorUnits: number;
    netMinorUnits: number;
  };
  applied: AppliedPromotion[];
  suppressed: SuppressedPromotion[];
};

export type CartDto = {
  items: CartLineDto[];
  totals: {
    subtotalMinorUnits: number;
    discountMinorUnits: number;
    totalMinorUnits: number;
  };
  notices: CartNotice[];
};

export type SessionStatus = 'scheduled' | 'live' | 'ended';
export type DeliveryTier = 'rtc' | 'cdn';

export type LiveSessionDto = {
  id: string;
  slug: string;
  title: string;
  description: string;
  hostName: string;
  /**
   * Stage identities. Public on purpose: chat envelopes already carry `userId`, and a
   * client cannot decide whether to offer console controls without knowing whether it
   * is looking at its own show.
   */
  hostUserId: string | null;
  coHostUserId: string | null;
  coHostName: string | null;
  sellerId: string;
  sellerName: string;
  status: SessionStatus;
  scheduledFor: string | null;
  startedAt: string | null;
  endedAt: string | null;
  coverImageUrl: string | null;
  language: string;
  deliveryTier: DeliveryTier;
  hlsUrl: string | null;
  hlsOriginKind: 'media-push' | 'simulated-origin' | null;
  recordingStatus: string;
  recordingUrl: string | null;
  transcriptSummary: string | null;
  viewerCount: number;
  peakViewers: number;
  /**
   * The looping file feed this session's live tier falls back to when no RTC
   * publisher is on the channel. Per-session so four concurrent rooms are not four
   * copies of the same clip, and server-resolved so the client never guesses at a
   * fixture that may not have been generated.
   */
  liveSourceUrl: string | null;
  /**
   * A seller-uploaded video standing in for a camera. When set it is what the room
   * plays, and `autoStart` decides whether the session flips live on schedule with
   * nobody at a console.
   */
  sourceVideoUrl: string | null;
  autoStart: boolean;
  /**
   * The session's own live-only markdown, in whole percent, editable by the host
   * while the show runs. `null` means this room adds no rule of its own and the
   * shopper sees whatever global live promotion the catalog already carries.
   */
  discountPercent: number | null;
  /**
   * The server's clock at the moment this payload was built. Anchors the shared live
   * position (see `syncedPosition`) so a viewer with a skewed clock still lands on the
   * same frame as everyone else.
   */
  serverNowMs: number;
  products: SessionProductDto[];
};

export type SessionProductDto = {
  productId: string;
  slug: string;
  title: string;
  imageUrl: string | null;
  /** All three tiers, server-computed. Never divide these on the client. */
  price: PriceLadderDto;
  /**
   * Summed variant stock, so the rail can render `Out of stock` without a second
   * request and the console can see that a pinned product just sold out. The count
   * itself is operator information: shopper surfaces render the state, never the number.
   */
  stock: number;
  /** Stock at or below the seller dashboard's low-stock threshold, and above zero. */
  lowStock: boolean;
  isFeatured: boolean;
  pinnedAt: string | null;
  sortOrder: number;
};

export type JoinSessionDto = {
  deliveryTier: DeliveryTier;
  rtcChannel: string;
  rtcToken: string;
  uid: number;
  chatChannel: string;
  shardIndex: number;
  chatShardCount: number;
  hlsUrl?: string;
  hlsOriginKind?: 'media-push' | 'simulated-origin';
  captionsEnabled: boolean;
  recordingConsentRequired: boolean;
  liveSourceUrl?: string;
  serverNowMs: number;
};

/** The canonical chat envelope. Only the backend, as `chat-service`, publishes it. */
export type ChatEnvelope = {
  v: 1;
  type: 'chat' | 'moderation';
  messageId: string;
  sessionId: string;
  shardIndex: number;
  userId: string;
  displayName: string;
  role: Role;
  text?: string;
  /** A host-shared item card. The server only accepts products attached to this session. */
  product?: SessionProductDto;
  moderation?: {
    action: 'mute' | 'unmute' | 'ban' | 'delete_message';
    targetUserId?: string;
    targetMessageId?: string;
  };
  ts: number;
};

export type CreateConversationDto = {
  conversationId: string;
  rtcChannel: string;
  rtcToken: string;
  viewerUid: number;
  agentUid: number;
  language: string;
  surface: Surface;
};

export type TranscriptLine = {
  id: string;
  speaker: 'user' | 'assistant' | 'host';
  language: string;
  text: string;
  startMs: number;
};

export type PaymentMethod = 'card' | 'upi' | 'cod' | 'emi' | 'netbanking';

export type CheckoutOptionsDto = {
  methods: PaymentMethod[];
  minOrderMinorUnits: number;
  blockedReason: string | null;
  pincodeServiceable: boolean | null;
  etaDays: number | null;
};

export type OrderStatus = 'pending' | 'paid' | 'payment_failed' | 'expired' | 'cancelled';

export type FulfilmentStatus =
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed';

export type OrderDto = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  subtotalMinorUnits: number;
  discountMinorUnits: number;
  totalMinorUnits: number;
  paymentMethod: PaymentMethod;
  paymentRef: string;
  pincode: string;
  fulfilmentStatus: FulfilmentStatus | null;
  trackingNumber: string | null;
  carrier: string | null;
  estimatedDeliveryAt: string | null;
  items: {
    productId: string;
    /** Lets an order line link straight to the product page, which is slug-addressed. */
    productSlug: string;
    productTitle: string;
    variantLabel: string;
    quantity: number;
    unitPriceMinorUnits: number;
    lineDiscountMinorUnits: number;
    appliedPromotionCodes: string[];
    liveSessionId: string | null;
    liveSessionTitle: string | null;
  }[];
};

export type SessionAnalyticsDto = {
  sessionId: string;
  peakViewers: number;
  uniqueViewers: number;
  avgWatchSeconds: number;
  chatMessages: number;
  reactions: number;
  pollVotes: number;
  aiConversations: number;
  aiToolCalls: number;
  addToCarts: number;
  orders: number;
  /**
   * Pre-authorisations this room's carts had declined. A decline writes no order, so it
   * exists nowhere else; without it a seller reads a conversion dip as disinterest.
   */
  checkoutDeclines: number;
  gmvMinorUnits: number;
  conversionRate: number;
  discountByCode: Record<string, number>;
  viewerSeries: { minute: string; viewers: number }[];
  /**
   * `orders` is an order count, `units` the summed quantity — a report that shows one
   * without the other cannot tell a single bulk buyer from a room of buyers.
   */
  topProducts: {
    productId: string;
    title: string;
    addToCarts: number;
    orders: number;
    units: number;
    minutesPinned: number;
  }[];
  /**
   * The pin timeline: each product owns the stretch from when it went on screen until
   * the next pin (or the end of the show), which is the interval its add-to-carts and
   * orders were credited against.
   */
  pinWindows: { productId: string; title: string; from: string; to: string }[];
};

/**
 * `GET /api/seller/overview`. Every rollup here is the sum of the seller's
 * per-session analytics, so a decline on a browse-only cart — which no line can
 * attribute to a session — is deliberately not credited to anyone.
 */
export type SellerOverviewDto = {
  sellerId: string;
  sessionsRun: number;
  liveNow: number;
  scheduled: number;
  productCount: number;
  lowStockCount: number;
  lowStockThreshold: number;
  peakViewers: number;
  uniqueViewers: number;
  addToCarts: number;
  orders: number;
  gmvMinorUnits: number;
  /** 0..1, orders / unique viewers across the seller's sessions. */
  conversionRate: number;
  checkoutDeclines: number;
  aiConversations: number;
  aiToolCalls: number;
  chatMessages: number;
  reactions: number;
  discountGivenMinorUnits: number;
  recentSessions: {
    id: string;
    slug: string;
    title: string;
    status: SessionStatus;
    startedAt: string | null;
    scheduledFor: string | null;
    peakViewers: number;
    gmvMinorUnits: number;
    orders: number;
  }[];
};

/** `GET /api/sellers/:slug` — the public storefront header for a creator page. */
export type SellerPublicDto = {
  id: string;
  slug: string;
  name: string;
  productCount: number;
  rating: number;
};

export type { AppliedPromotion, LiveOffer, Surface, SuppressedPromotion };
