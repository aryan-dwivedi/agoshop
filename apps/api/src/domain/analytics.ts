import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SellerOverviewDto, SessionAnalyticsDto } from '@shop/shared';
import { db } from '../db/client.js';
import { aiConversations, aiToolCalls, analyticsEvents, chatMessages, liveSessions, orderItems, orders, pollVotes, polls, products, productVariants, } from '../db/schema.js';
import { keys, redis } from '../lib/redis.js';
const LOW_STOCK_THRESHOLD = 10;
const int = (value: unknown): number => {
    const n = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
};
const countOf = async (query: Promise<{
    value: unknown;
}[]>): Promise<number> => int((await query)[0]?.value);
type PinWindow = {
    productId: string;
    from: Date;
    to: Date;
};
const pinWindows = async (sessionId: string, sessionEnd: Date): Promise<PinWindow[]> => {
    const rows = await db
        .select({ productId: analyticsEvents.productId, occurredAt: analyticsEvents.occurredAt })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'product_pinned')))
        .orderBy(analyticsEvents.occurredAt);
    const pins = rows.filter((r): r is {
        productId: string;
        occurredAt: Date;
    } => r.productId !== null);
    return pins.map((pin, index) => ({
        productId: pin.productId,
        from: pin.occurredAt,
        to: pins[index + 1]?.occurredAt ?? sessionEnd,
    }));
};
const reactionTotal = async (sessionId: string): Promise<number> => {
    try {
        const hash = await redis.hgetall(keys.sessionReactions(sessionId));
        const entries = Object.values(hash);
        if (entries.length > 0)
            return entries.reduce((sum, v) => sum + int(v), 0);
    }
    catch {
    }
    return countOf(db
        .select({ value: sql `count(*)` })
        .from(analyticsEvents)
        .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'reaction'))));
};
export const sessionAnalytics = async (sessionId: string): Promise<SessionAnalyticsDto> => {
    const [session] = await db
        .select({
        id: liveSessions.id,
        peakViewers: liveSessions.peakViewers,
        startedAt: liveSessions.startedAt,
        endedAt: liveSessions.endedAt,
        createdAt: liveSessions.createdAt,
    })
        .from(liveSessions)
        .where(eq(liveSessions.id, sessionId));
    const empty: SessionAnalyticsDto = {
        sessionId,
        peakViewers: 0,
        uniqueViewers: 0,
        avgWatchSeconds: 0,
        chatMessages: 0,
        reactions: 0,
        pollVotes: 0,
        aiConversations: 0,
        aiToolCalls: 0,
        addToCarts: 0,
        orders: 0,
        checkoutDeclines: 0,
        gmvMinorUnits: 0,
        conversionRate: 0,
        discountByCode: {},
        viewerSeries: [],
        topProducts: [],
        pinWindows: [],
    };
    if (!session)
        return empty;
    const sessionEnd = session.endedAt ?? new Date();
    const [uniqueViewers, viewerMinutes, chatCount, reactions, pollVoteCount, aiConversationCount, aiToolCallCount, viewerSeriesRows, lineRows, addToCartRows, windows, checkoutDeclines,] = await Promise.all([
        countOf(db
            .select({ value: sql `count(distinct ${analyticsEvents.userId})` })
            .from(analyticsEvents)
            .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'session_join')))),
        countOf(db
            .select({ value: sql `coalesce(sum((${analyticsEvents.payload} ->> 'viewers')::int), 0)` })
            .from(analyticsEvents)
            .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'viewer_sample')))),
        countOf(db
            .select({ value: sql `count(*)` })
            .from(chatMessages)
            .where(and(eq(chatMessages.sessionId, sessionId), eq(chatMessages.status, 'visible')))),
        reactionTotal(sessionId),
        countOf(db
            .select({ value: sql `count(*)` })
            .from(pollVotes)
            .innerJoin(polls, eq(polls.id, pollVotes.pollId))
            .where(eq(polls.sessionId, sessionId))),
        countOf(db
            .select({ value: sql `count(*)` })
            .from(aiConversations)
            .where(eq(aiConversations.liveSessionId, sessionId))),
        countOf(db
            .select({ value: sql `count(*)` })
            .from(aiToolCalls)
            .innerJoin(aiConversations, eq(aiConversations.id, aiToolCalls.conversationId))
            .where(eq(aiConversations.liveSessionId, sessionId))),
        db
            .select({
            minute: sql<string> `to_char(date_trunc('minute', ${analyticsEvents.occurredAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:00"Z"')`,
            viewers: sql<number> `max((${analyticsEvents.payload} ->> 'viewers')::int)`,
        })
            .from(analyticsEvents)
            .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'viewer_sample')))
            .groupBy(sql `date_trunc('minute', ${analyticsEvents.occurredAt})`)
            .orderBy(sql `date_trunc('minute', ${analyticsEvents.occurredAt})`),
        db
            .select({
            orderId: orderItems.orderId,
            productId: orderItems.productId,
            quantity: orderItems.quantity,
            unitPriceMinorUnits: orderItems.unitPriceMinorUnits,
            lineDiscountMinorUnits: orderItems.lineDiscountMinorUnits,
            appliedPromotionCodes: orderItems.appliedPromotionCodes,
            createdAt: orders.createdAt,
        })
            .from(orderItems)
            .innerJoin(orders, eq(orders.id, orderItems.orderId))
            .where(eq(orderItems.liveSessionId, sessionId)),
        db
            .select({ productId: analyticsEvents.productId, occurredAt: analyticsEvents.occurredAt })
            .from(analyticsEvents)
            .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'add_to_cart'))),
        pinWindows(sessionId, sessionEnd),
        countOf(db
            .select({ value: sql `count(*)` })
            .from(analyticsEvents)
            .where(and(eq(analyticsEvents.sessionId, sessionId), eq(analyticsEvents.type, 'payment_declined')))),
    ]);
    const gmvMinorUnits = lineRows.reduce((sum, l) => sum + l.unitPriceMinorUnits * l.quantity - l.lineDiscountMinorUnits, 0);
    const orderIds = new Set(lineRows.map((l) => l.orderId));
    const discountByCode: Record<string, number> = {};
    for (const line of lineRows) {
        if (line.lineDiscountMinorUnits <= 0)
            continue;
        const codes = line.appliedPromotionCodes.length > 0 ? line.appliedPromotionCodes : ['UNATTRIBUTED'];
        const share = Math.round(line.lineDiscountMinorUnits / codes.length);
        for (const code of codes)
            discountByCode[code] = (discountByCode[code] ?? 0) + share;
    }
    type ProductTally = {
        addToCarts: number;
        orders: number;
        units: number;
        minutesPinned: number;
    };
    const perProduct = new Map<string, ProductTally>();
    const tally = (productId: string): ProductTally => {
        const entry = perProduct.get(productId) ?? {
            addToCarts: 0,
            orders: 0,
            units: 0,
            minutesPinned: 0,
        };
        perProduct.set(productId, entry);
        return entry;
    };
    const credit = (when: Date, fallbackProductId: string | null, field: 'addToCarts' | 'orders', units = 0): void => {
        const productId = windows.find((w) => when >= w.from && when < w.to)?.productId ?? fallbackProductId;
        if (!productId)
            return;
        const entry = tally(productId);
        entry[field] += 1;
        entry.units += units;
    };
    for (const row of addToCartRows)
        credit(row.occurredAt, row.productId, 'addToCarts');
    for (const line of lineRows)
        credit(line.createdAt, line.productId, 'orders', line.quantity);
    for (const window of windows) {
        const minutes = Math.max(0, Math.round((window.to.getTime() - window.from.getTime()) / 60000));
        tally(window.productId).minutesPinned += minutes;
    }
    const productIds = [...perProduct.keys()];
    const titleById: Record<string, string> = {};
    if (productIds.length > 0) {
        const rows = await db
            .select({ id: products.id, title: products.title })
            .from(products)
            .where(inArray(products.id, productIds));
        for (const row of rows)
            titleById[row.id] = row.title;
    }
    const titleOf = (productId: string): string => titleById[productId] ?? 'Unknown product';
    const topProducts = [...perProduct.entries()]
        .map(([productId, counts]) => ({
        productId,
        title: titleOf(productId),
        addToCarts: counts.addToCarts,
        orders: counts.orders,
        units: counts.units,
        minutesPinned: counts.minutesPinned,
    }))
        .sort((a, b) => b.orders - a.orders || b.addToCarts - a.addToCarts || a.title.localeCompare(b.title));
    return {
        sessionId,
        peakViewers: session.peakViewers,
        uniqueViewers,
        avgWatchSeconds: uniqueViewers > 0 ? Math.round((viewerMinutes * 60) / uniqueViewers) : 0,
        chatMessages: chatCount,
        reactions,
        pollVotes: pollVoteCount,
        aiConversations: aiConversationCount,
        aiToolCalls: aiToolCallCount,
        addToCarts: addToCartRows.length,
        orders: orderIds.size,
        checkoutDeclines,
        gmvMinorUnits,
        conversionRate: uniqueViewers > 0 ? Number((orderIds.size / uniqueViewers).toFixed(4)) : 0,
        discountByCode,
        viewerSeries: viewerSeriesRows.map((r) => ({ minute: r.minute, viewers: int(r.viewers) })),
        topProducts,
        pinWindows: windows.map((w) => ({
            productId: w.productId,
            title: titleOf(w.productId),
            from: w.from.toISOString(),
            to: w.to.toISOString(),
        })),
    };
};
export const sellerOverview = async (sellerId: string): Promise<SellerOverviewDto> => {
    const sessionRows = await db
        .select({
        id: liveSessions.id,
        slug: liveSessions.slug,
        title: liveSessions.title,
        status: liveSessions.status,
        scheduledFor: liveSessions.scheduledFor,
        startedAt: liveSessions.startedAt,
        peakViewers: liveSessions.peakViewers,
    })
        .from(liveSessions)
        .where(eq(liveSessions.sellerId, sellerId))
        .orderBy(sql `coalesce(${liveSessions.startedAt}, ${liveSessions.scheduledFor}, ${liveSessions.createdAt}) desc`);
    const sessionIds = sessionRows.map((s) => s.id);
    const productCount = await countOf(db
        .select({ value: sql `count(*)` })
        .from(products)
        .where(eq(products.sellerId, sellerId)));
    const lowStockCount = await countOf(db
        .select({ value: sql `count(*)` })
        .from(products)
        .where(and(eq(products.sellerId, sellerId), sql `(select coalesce(sum(${productVariants.stock}), 0) from ${productVariants} where ${productVariants.productId} = ${products.id}) <= ${LOW_STOCK_THRESHOLD}`)));
    const perSession = await Promise.all(sessionIds.map((id) => sessionAnalytics(id)));
    const analyticsBySessionId: Record<string, SessionAnalyticsDto> = {};
    for (const entry of perSession)
        analyticsBySessionId[entry.sessionId] = entry;
    const sum = (pick: (a: SessionAnalyticsDto) => number): number => perSession.reduce((total, a) => total + pick(a), 0);
    const uniqueViewers = sum((a) => a.uniqueViewers);
    const orderCount = sum((a) => a.orders);
    const discountGivenMinorUnits = perSession.reduce((total, a) => total + Object.values(a.discountByCode).reduce((s, v) => s + v, 0), 0);
    return {
        sellerId,
        sessionsRun: sessionRows.filter((s) => s.status !== 'scheduled').length,
        liveNow: sessionRows.filter((s) => s.status === 'live').length,
        scheduled: sessionRows.filter((s) => s.status === 'scheduled').length,
        productCount,
        lowStockCount,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        peakViewers: sessionRows.reduce((max, s) => Math.max(max, s.peakViewers), 0),
        uniqueViewers,
        addToCarts: sum((a) => a.addToCarts),
        orders: orderCount,
        gmvMinorUnits: sum((a) => a.gmvMinorUnits),
        conversionRate: uniqueViewers > 0 ? Number((orderCount / uniqueViewers).toFixed(4)) : 0,
        aiConversations: sum((a) => a.aiConversations),
        aiToolCalls: sum((a) => a.aiToolCalls),
        chatMessages: sum((a) => a.chatMessages),
        reactions: sum((a) => a.reactions),
        checkoutDeclines: sum((a) => a.checkoutDeclines),
        discountGivenMinorUnits,
        recentSessions: sessionRows.slice(0, 8).map((s) => ({
            id: s.id,
            slug: s.slug,
            title: s.title,
            status: s.status,
            startedAt: s.startedAt?.toISOString() ?? null,
            scheduledFor: s.scheduledFor?.toISOString() ?? null,
            peakViewers: s.peakViewers,
            gmvMinorUnits: analyticsBySessionId[s.id]?.gmvMinorUnits ?? 0,
            orders: analyticsBySessionId[s.id]?.orders ?? 0,
        })),
    };
};
export { LOW_STOCK_THRESHOLD };
