import type { AppliedPromotion, LiveOffer, SuppressedPromotion, Surface } from './promotions.js';

export type Role = 'shopper' | 'seller' | 'admin' | 'support';
export type PublicUser = {
    id: string;
    email: string;
    displayName: string;
    role: Role;
    defaultPincode: string | null;
    preferredLanguage: string;
    isGuest: boolean;
};
export type AppConfig = {
    agoraAppId: string;
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
export type PriceLadderDto = {
    mrpMinorUnits: number | null;
    shopMinorUnits: number;
    liveMinorUnits: number | null;
    liveDiscountMinorUnits: number;
    shopOffPercent: number | null;
    liveOffPercent: number | null;
};
export type VariantDto = {
    id: string;
    sku: string;
    label: string;
    attrs: Record<string, string>;
    priceMinorUnits: number;
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
    rttStatus: 'off' | 'connecting' | 'running' | 'failed';
    transcriptSummary: string | null;
    viewerCount: number;
    peakViewers: number;
    liveSourceUrl: string | null;
    sourceVideoUrl: string | null;
    autoStart: boolean;
    discountPercent: number | null;
    serverNowMs: number;
    products: SessionProductDto[];
};
export type SessionProductDto = {
    productId: string;
    slug: string;
    title: string;
    imageUrl: string | null;
    price: PriceLadderDto;
    stock: number;
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
export type OrderStatus =
    'pending' | 'capturing' | 'expiring' | 'paid' | 'payment_failed' | 'expired' | 'cancelled';
export type FulfilmentStatus =
    'processing' | 'packed' | 'shipped' | 'out_for_delivery' | 'delivered' | 'failed';
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
    checkoutDeclines: number;
    gmvMinorUnits: number;
    conversionRate: number;
    discountByCode: Record<string, number>;
    viewerSeries: {
        minute: string;
        viewers: number;
    }[];
    topProducts: {
        productId: string;
        title: string;
        addToCarts: number;
        orders: number;
        units: number;
        minutesPinned: number;
    }[];
    pinWindows: {
        productId: string;
        title: string;
        from: string;
        to: string;
    }[];
};
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
export type SellerPublicDto = {
    id: string;
    slug: string;
    name: string;
    productCount: number;
    rating: number;
};
export type { AppliedPromotion, LiveOffer, Surface, SuppressedPromotion };
