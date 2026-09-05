import { relations } from 'drizzle-orm';
import {
    bigserial,
    boolean,
    index,
    integer,
    jsonb,
    pgEnum,
    pgTable,
    primaryKey,
    real,
    text,
    timestamp,
    unique,
    uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['shopper', 'seller', 'admin', 'support']);
export const fulfilmentStatusEnum = pgEnum('fulfilment_status', [
    'processing',
    'packed',
    'shipped',
    'out_for_delivery',
    'delivered',
    'failed',
]);
export const supportTicketStatusEnum = pgEnum('support_ticket_status', [
    'queued',
    'assigned',
    'active',
    'closed',
    'cancelled',
]);
export const orderStatusEnum = pgEnum('order_status', [
    'pending',
    'capturing',
    'expiring',
    'paid',
    'payment_failed',
    'expired',
    'cancelled',
]);
export const reservationStatusEnum = pgEnum('reservation_status', [
    'active',
    'confirmed',
    'released',
    'expired',
]);
export const promotionKindEnum = pgEnum('promotion_kind', ['percent', 'flat']);
export const sessionStatusEnum = pgEnum('session_status', ['scheduled', 'live', 'ended']);
export const deliveryTierEnum = pgEnum('delivery_tier', ['rtc', 'cdn']);
export const recordingStatusEnum = pgEnum('recording_status', [
    'none',
    'recording',
    'processing',
    'ready',
    'failed',
]);
export const sideServiceStatusEnum = pgEnum('side_service_status', [
    'off',
    'connecting',
    'running',
    'failed',
]);
export const hlsOriginKindEnum = pgEnum('hls_origin_kind', ['media-push', 'simulated-origin']);
export const chatStatusEnum = pgEnum('chat_status', ['visible', 'deleted']);
export const moderationActionEnum = pgEnum('moderation_action', [
    'mute',
    'unmute',
    'ban',
    'delete_message',
]);
export const pollStatusEnum = pgEnum('poll_status', ['open', 'closed']);
export const aiSurfaceEnum = pgEnum('ai_surface', ['live', 'replay', 'browse']);
export const aiTransportEnum = pgEnum('ai_transport', ['voice', 'text']);
export const aiStatusEnum = pgEnum('ai_status', ['created', 'running', 'stopped', 'failed']);
export const aiRoleEnum = pgEnum('ai_role', ['user', 'assistant', 'tool']);
export const users = pgTable('users', {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    role: roleEnum('role').notNull().default('shopper'),
    defaultPincode: text('default_pincode'),
    preferredLanguage: text('preferred_language').notNull().default('en-US'),
    bannedAt: timestamp('banned_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const categories = pgTable('categories', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
});
export const sellers = pgTable('sellers', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    displayName: text('display_name').notNull(),
    logoUrl: text('logo_url'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, {
        onDelete: 'set null',
    }),
    rating: real('rating').notNull().default(4.5),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const products = pgTable(
    'products',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        slug: text('slug').notNull().unique(),
        categoryId: uuid('category_id')
            .notNull()
            .references(() => categories.id, { onDelete: 'restrict' }),
        sellerId: uuid('seller_id')
            .notNull()
            .references(() => sellers.id, { onDelete: 'restrict' }),
        title: text('title').notNull(),
        brand: text('brand').notNull(),
        description: text('description').notNull(),
        highlights: jsonb('highlights').$type<string[]>().notNull().default([]),
        specs: jsonb('specs').$type<Record<string, string>>().notNull().default({}),
        images: jsonb('images').$type<string[]>().notNull().default([]),
        rating: real('rating').notNull().default(4),
        ratingCount: integer('rating_count').notNull().default(0),
        basePriceMinorUnits: integer('base_price_minor_units').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('products_category_idx').on(t.categoryId)],
);
export const productVariants = pgTable(
    'product_variants',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        sku: text('sku').notNull().unique(),
        label: text('label').notNull(),
        attrs: jsonb('attrs').$type<Record<string, string>>().notNull().default({}),
        priceMinorUnits: integer('price_minor_units').notNull(),
        mrpMinorUnits: integer('mrp_minor_units'),
        stock: integer('stock').notNull().default(0),
        isDefault: boolean('is_default').notNull().default(false),
    },
    (t) => [index('variants_product_idx').on(t.productId)],
);
export const pincodes = pgTable('pincodes', {
    pincode: text('pincode').primaryKey(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    serviceable: boolean('serviceable').notNull().default(true),
    codAvailable: boolean('cod_available').notNull().default(true),
    etaDays: integer('eta_days').notNull().default(3),
});
export const carts = pgTable('carts', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .unique()
        .references(() => users.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const cartItems = pgTable(
    'cart_items',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        cartId: uuid('cart_id')
            .notNull()
            .references(() => carts.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        variantId: uuid('variant_id')
            .notNull()
            .references(() => productVariants.id, { onDelete: 'cascade' }),
        quantity: integer('quantity').notNull().default(1),
        unitPriceMinorUnits: integer('unit_price_minor_units').notNull(),
        liveSessionId: uuid('live_session_id').references(() => liveSessions.id, {
            onDelete: 'set null',
        }),
        addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('cart_items_line_unique')
            .on(t.cartId, t.variantId, t.liveSessionId)
            .nullsNotDistinct(),
    ],
);
export const orders = pgTable(
    'orders',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'restrict' }),
        status: orderStatusEnum('status').notNull().default('pending'),
        subtotalMinorUnits: integer('subtotal_minor_units').notNull(),
        discountMinorUnits: integer('discount_minor_units').notNull(),
        totalMinorUnits: integer('total_minor_units').notNull(),
        appliedPromotions: jsonb('applied_promotions')
            .$type<
                {
                    code: string;
                    label: string;
                    minorUnits: number;
                }[]
            >()
            .notNull()
            .default([]),
        paymentMethod: text('payment_method').notNull(),
        paymentRef: text('payment_ref').notNull(),
        pincode: text('pincode').notNull(),
        idempotencyKey: text('idempotency_key').notNull(),
        fulfilmentStatus: fulfilmentStatusEnum('fulfilment_status'),
        trackingNumber: text('tracking_number'),
        carrier: text('carrier'),
        estimatedDeliveryAt: timestamp('estimated_delivery_at', {
            withTimezone: true,
        }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique('orders_user_idempotency_unique').on(t.userId, t.idempotencyKey)],
);
export const orderItems = pgTable(
    'order_items',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'restrict' }),
        variantId: uuid('variant_id')
            .notNull()
            .references(() => productVariants.id, { onDelete: 'restrict' }),
        quantity: integer('quantity').notNull(),
        unitPriceMinorUnits: integer('unit_price_minor_units').notNull(),
        lineDiscountMinorUnits: integer('line_discount_minor_units').notNull().default(0),
        appliedPromotionCodes: jsonb('applied_promotion_codes')
            .$type<string[]>()
            .notNull()
            .default([]),
        liveSessionId: uuid('live_session_id').references(() => liveSessions.id, {
            onDelete: 'set null',
        }),
    },
    (t) => [index('order_items_order_idx').on(t.orderId)],
);
export const stockReservations = pgTable(
    'stock_reservations',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        variantId: uuid('variant_id')
            .notNull()
            .references(() => productVariants.id, { onDelete: 'restrict' }),
        quantity: integer('quantity').notNull(),
        status: reservationStatusEnum('status').notNull().default('active'),
        expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        index('stock_reservations_order_idx').on(t.orderId),
        index('stock_reservations_variant_status_idx').on(t.variantId, t.status),
        index('stock_reservations_expires_idx').on(t.expiresAt),
    ],
);
export const promotions = pgTable('promotions', {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    label: text('label').notNull(),
    description: text('description').notNull().default(''),
    kind: promotionKindEnum('kind').notNull(),
    value: integer('value').notNull(),
    priority: integer('priority').notNull().default(0),
    stackable: boolean('stackable').notNull().default(false),
    conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull().default({}),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const promotionRedemptions = pgTable(
    'promotion_redemptions',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        promotionId: uuid('promotion_id')
            .notNull()
            .references(() => promotions.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'restrict' }),
        orderId: uuid('order_id')
            .notNull()
            .references(() => orders.id, { onDelete: 'cascade' }),
        minorUnits: integer('minor_units').notNull(),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('redemptions_user_promo_idx').on(t.userId, t.promotionId)],
);
export const checkoutPolicies = pgTable('checkout_policies', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    minOrderMinorUnits: integer('min_order_minor_units').notNull().default(0),
    codMaxOrderMinorUnits: integer('cod_max_order_minor_units').notNull(),
    emiMinOrderMinorUnits: integer('emi_min_order_minor_units').notNull(),
    allowedMethods: jsonb('allowed_methods').$type<string[]>().notNull().default([]),
    blockedPincodes: jsonb('blocked_pincodes').$type<string[]>().notNull().default([]),
    requireServiceablePincode: boolean('require_serviceable_pincode').notNull().default(true),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const wishlistItems = pgTable(
    'wishlist_items',
    {
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.productId] })],
);
export const productViews = pgTable(
    'product_views',
    {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('product_views_user_idx').on(t.userId, t.viewedAt)],
);
export const liveSessions = pgTable('live_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    sellerId: uuid('seller_id')
        .notNull()
        .references(() => sellers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    hostName: text('host_name').notNull(),
    hostUserId: uuid('host_user_id').references(() => users.id, {
        onDelete: 'set null',
    }),
    coHostUserId: uuid('co_host_user_id').references(() => users.id, {
        onDelete: 'set null',
    }),
    status: sessionStatusEnum('status').notNull().default('scheduled'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    startEffectsCompletedAt: timestamp('start_effects_completed_at', { withTimezone: true }),
    endEffectsCompletedAt: timestamp('end_effects_completed_at', { withTimezone: true }),
    rtcChannel: text('rtc_channel').notNull(),
    coverImageUrl: text('cover_image_url'),
    language: text('language').notNull().default('en-US'),
    expectedPeakViewers: integer('expected_peak_viewers').notNull().default(50),
    sourceVideoUrl: text('source_video_url'),
    autoStart: boolean('auto_start').notNull().default(false),
    discountPercent: integer('discount_percent'),
    chatShardCount: integer('chat_shard_count').notNull().default(1),
    deliveryTier: deliveryTierEnum('delivery_tier').notNull().default('rtc'),
    deliveryTierPublishedAt: timestamp('delivery_tier_published_at', { withTimezone: true }),
    recordingConsentAt: timestamp('recording_consent_at', { withTimezone: true }),
    recordingProvider: text('recording_provider'),
    recordingStatus: recordingStatusEnum('recording_status').notNull().default('none'),
    recordingError: text('recording_error'),
    recordingUrl: text('recording_url'),
    recordingResourceId: text('recording_resource_id'),
    recordingSid: text('recording_sid'),
    rttTaskId: text('rtt_task_id'),
    rttStatus: sideServiceStatusEnum('rtt_status').notNull().default('off'),
    mediaPushConverterId: text('media_push_converter_id'),
    mediaPushStatus: sideServiceStatusEnum('media_push_status').notNull().default('off'),
    mediaGatewayUid: integer('media_gateway_uid'),
    mediaGatewayStatus: sideServiceStatusEnum('media_gateway_status').notNull().default('off'),
    hlsUrl: text('hls_url'),
    hlsOriginKind: hlsOriginKindEnum('hls_origin_kind'),
    transcriptSummary: text('transcript_summary'),
    peakViewers: integer('peak_viewers').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const liveSessionProducts = pgTable(
    'live_session_products',
    {
        sessionId: uuid('session_id')
            .notNull()
            .references(() => liveSessions.id, { onDelete: 'cascade' }),
        productId: uuid('product_id')
            .notNull()
            .references(() => products.id, { onDelete: 'cascade' }),
        sortOrder: integer('sort_order').notNull().default(0),
        isFeatured: boolean('is_featured').notNull().default(false),
        pinnedAt: timestamp('pinned_at', { withTimezone: true }),
    },
    (t) => [primaryKey({ columns: [t.sessionId, t.productId] })],
);
export const sessionTranscripts = pgTable(
    'session_transcripts',
    {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        sessionId: uuid('session_id')
            .notNull()
            .references(() => liveSessions.id, { onDelete: 'cascade' }),
        speaker: text('speaker').notNull(),
        language: text('language').notNull(),
        text: text('text').notNull(),
        translatedText: jsonb('translated_text')
            .$type<Record<string, string>>()
            .notNull()
            .default({}),
        startMs: integer('start_ms').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('transcripts_session_idx').on(t.sessionId, t.startMs)],
);
export const chatMessages = pgTable(
    'chat_messages',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: uuid('session_id')
            .notNull()
            .references(() => liveSessions.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        shardIndex: integer('shard_index').notNull().default(0),
        clientMessageId: text('client_message_id').notNull(),
        text: text('text').notNull(),
        productId: uuid('product_id').references(() => products.id, {
            onDelete: 'set null',
        }),
        status: chatStatusEnum('status').notNull().default('visible'),
        flagged: boolean('flagged').notNull().default(false),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
        unique('chat_messages_client_unique').on(t.sessionId, t.userId, t.clientMessageId),
        index('chat_messages_session_idx').on(t.sessionId, t.createdAt),
    ],
);
export const chatModeration = pgTable(
    'chat_moderation',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        sessionId: uuid('session_id')
            .notNull()
            .references(() => liveSessions.id, { onDelete: 'cascade' }),
        targetUserId: uuid('target_user_id').references(() => users.id, {
            onDelete: 'cascade',
        }),
        action: moderationActionEnum('action').notNull(),
        targetMessageId: uuid('target_message_id'),
        actorUserId: uuid('actor_user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('moderation_session_idx').on(t.sessionId, t.createdAt)],
);
export const polls = pgTable('polls', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
        .notNull()
        .references(() => liveSessions.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    status: pollStatusEnum('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
});
export const pollOptions = pgTable('poll_options', {
    id: uuid('id').primaryKey().defaultRandom(),
    pollId: uuid('poll_id')
        .notNull()
        .references(() => polls.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
});
export const pollVotes = pgTable(
    'poll_votes',
    {
        pollId: uuid('poll_id')
            .notNull()
            .references(() => polls.id, { onDelete: 'cascade' }),
        optionId: uuid('option_id')
            .notNull()
            .references(() => pollOptions.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.pollId, t.userId] })],
);
export const aiConversations = pgTable('ai_conversations', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
    liveSessionId: uuid('live_session_id').references(() => liveSessions.id, {
        onDelete: 'set null',
    }),
    contextProductId: uuid('context_product_id').references(() => products.id, {
        onDelete: 'set null',
    }),
    surface: aiSurfaceEnum('surface').notNull(),
    transport: aiTransportEnum('transport').notNull().default('voice'),
    language: text('language').notNull().default('en-US'),
    provider: text('provider').notNull(),
    rtcChannel: text('rtc_channel').notNull(),
    viewerUid: integer('viewer_uid').notNull(),
    agentUid: integer('agent_uid').notNull(),
    agoraAgentId: text('agora_agent_id'),
    callbackExpiresAt: timestamp('callback_expires_at', {
        withTimezone: true,
    }).notNull(),
    status: aiStatusEnum('status').notNull().default('created'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
});
export const aiMessages = pgTable(
    'ai_messages',
    {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        conversationId: uuid('conversation_id')
            .notNull()
            .references(() => aiConversations.id, { onDelete: 'cascade' }),
        role: aiRoleEnum('role').notNull(),
        content: text('content'),
        toolName: text('tool_name'),
        toolArgs: jsonb('tool_args').$type<Record<string, unknown>>(),
        toolResult: jsonb('tool_result').$type<Record<string, unknown>>(),
        turnId: integer('turn_id').notNull().default(0),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index('ai_messages_conversation_idx').on(t.conversationId, t.id)],
);
export const supportTickets = pgTable(
    'support_tickets',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        conversationId: uuid('conversation_id')
            .notNull()
            .references(() => aiConversations.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'cascade' }),
        status: supportTicketStatusEnum('status').notNull().default('queued'),
        reason: text('reason').notNull(),
        orderId: uuid('order_id').references(() => orders.id, {
            onDelete: 'set null',
        }),
        preference: text('preference'),
        phoneE164: text('phone_e164'),
        transcriptSnapshot: jsonb('transcript_snapshot').$type<
            {
                role: string;
                text: string;
                at: string;
            }[]
        >(),
        assignedAgentId: uuid('assigned_agent_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        supportRtcUid: integer('support_rtc_uid'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        acceptedAt: timestamp('accepted_at', { withTimezone: true }),
        closedAt: timestamp('closed_at', { withTimezone: true }),
    },
    (t) => [index('support_tickets_status_idx').on(t.status, t.createdAt)],
);
export const aiToolCalls = pgTable(
    'ai_tool_calls',
    {
        conversationId: uuid('conversation_id')
            .notNull()
            .references(() => aiConversations.id, { onDelete: 'cascade' }),
        turnId: integer('turn_id').notNull(),
        name: text('name').notNull(),
        argsHash: text('args_hash').notNull(),
        toolCallId: text('tool_call_id').notNull(),
        args: jsonb('args').$type<Record<string, unknown>>().notNull(),
        result: jsonb('result').$type<Record<string, unknown>>(),
        state: text('state').notNull().default('pending'),
        claimToken: text('claim_token'),
        claimExpiresAt: timestamp('claim_expires_at', { withTimezone: true }),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
        updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.conversationId, t.toolCallId] })],
);
export const analyticsEvents = pgTable(
    'analytics_events',
    {
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
        userId: uuid('user_id').references(() => users.id, {
            onDelete: 'set null',
        }),
        sessionId: uuid('session_id').references(() => liveSessions.id, {
            onDelete: 'cascade',
        }),
        productId: uuid('product_id').references(() => products.id, {
            onDelete: 'set null',
        }),
        type: text('type').notNull(),
        payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    },
    (t) => [
        index('analytics_session_idx').on(t.sessionId, t.occurredAt),
        index('analytics_type_idx').on(t.type, t.occurredAt),
    ],
);
export const productRelations = relations(products, ({ one, many }) => ({
    category: one(categories, {
        fields: [products.categoryId],
        references: [categories.id],
    }),
    seller: one(sellers, {
        fields: [products.sellerId],
        references: [sellers.id],
    }),
    variants: many(productVariants),
}));
export const variantRelations = relations(productVariants, ({ one }) => ({
    product: one(products, {
        fields: [productVariants.productId],
        references: [products.id],
    }),
}));
export const sessionRelations = relations(liveSessions, ({ one, many }) => ({
    seller: one(sellers, {
        fields: [liveSessions.sellerId],
        references: [sellers.id],
    }),
    products: many(liveSessionProducts),
}));
