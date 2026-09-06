import type {
    DeliveryTier,
    LiveSessionDto,
    OrderDto,
    SellerOverviewDto as SellerOverviewBody,
    SessionAnalyticsDto,
    SessionStatus,
} from '@shop/shared';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from './api';

export type SellerRef = {
    id: string;
    slug: string;
    displayName: string;
};
export type SellerScope = {
    sellers: SellerRef[];
    sellerId: string;
};
export type SellerOverviewDto = SellerScope & SellerOverviewBody;
export type SellerSessionRow = {
    id: string;
    slug: string;
    title: string;
    status: SessionStatus;
    scheduledFor: string | null;
    startedAt: string | null;
    endedAt: string | null;
    expectedPeakViewers: number;
    chatShardCount: number;
    deliveryTier: DeliveryTier;
    recordingStatus: string;
    peakViewers: number;
    viewerCount: number;
    productCount: number;
    orders: number;
    gmvMinorUnits: number;
};
export type ModerationAction = 'mute' | 'unmute' | 'ban' | 'delete_message';
export type ModerationEntry = {
    id: string;
    action: ModerationAction;
    targetUserId: string | null;
    targetDisplayName: string | null;
    targetMessageId: string | null;
    actorUserId: string | null;
    actorDisplayName: string | null;
    createdAt: string;
};
export type SellerProductVariant = {
    id: string;
    sku: string;
    label: string;
    priceMinorUnits: number;
    mrpMinorUnits: number | null;
    stock: number;
};
export type ProductShowRef = {
    id: string;
    slug: string;
    title: string;
    status: SessionStatus;
};
export type SellerProduct = {
    productId: string;
    slug: string;
    title: string;
    brand: string;
    categorySlug: string;
    imageUrl: string | null;
    rating: number;
    priceMinorUnits: number;
    totalStock: number;
    lowStock: boolean;
    variants: SellerProductVariant[];
    inShows?: ProductShowRef[];
};
export type SellerSessionsDto = SellerScope & {
    sessions: SellerSessionRow[];
};
export type SellerProductsDto = SellerScope & {
    lowStockThreshold: number;
    products: SellerProduct[];
};
export type SellerOrdersDto = SellerScope & {
    orders: OrderDto[];
};
export type PinWindow = SessionAnalyticsDto['pinWindows'][number];
export type ReportProduct = SessionAnalyticsDto['topProducts'][number];
export const operatorKeys = {
    overview: (sellerId: string | null) => ['seller', 'overview', sellerId ?? 'all'] as const,
    sessions: (sellerId: string | null) => ['seller', 'sessions', sellerId ?? 'all'] as const,
    products: (sellerId: string | null) => ['seller', 'products', sellerId ?? 'all'] as const,
    orders: (sellerId: string | null) => ['seller', 'orders', sellerId ?? 'all'] as const,
    analytics: (sessionId: string) => ['seller', 'session', sessionId, 'analytics'] as const,
    moderation: (sessionId: string) => ['seller', 'session', sessionId, 'moderation'] as const,
};
const scoped = (path: string, sellerId: string | null): string =>
    sellerId === null ? path : `${path}?sellerId=${encodeURIComponent(sellerId)}`;
export const useSellerOverview = (
    enabled: boolean,
    sellerId: string | null = null,
): UseQueryResult<SellerOverviewDto> =>
    useQuery({
        queryKey: operatorKeys.overview(sellerId),
        queryFn: () => api.get<SellerOverviewDto>(scoped('/api/seller/overview', sellerId)),
        enabled,
    });
export const useSellerSessions = (
    enabled: boolean,
    sellerId: string | null = null,
): UseQueryResult<SellerSessionsDto> =>
    useQuery({
        queryKey: operatorKeys.sessions(sellerId),
        queryFn: () => api.get<SellerSessionsDto>(scoped('/api/seller/sessions', sellerId)),
        enabled,
        refetchInterval: (query) =>
            query.state.data?.sessions.some((s) => s.status === 'live') === true ? 10000 : false,
    });
export const useSellerProducts = (
    enabled: boolean,
    sellerId: string | null = null,
): UseQueryResult<SellerProductsDto> =>
    useQuery({
        queryKey: operatorKeys.products(sellerId),
        queryFn: () => api.get<SellerProductsDto>(scoped('/api/seller/products', sellerId)),
        enabled,
    });
export const useSellerOrders = (
    enabled: boolean,
    sellerId: string | null = null,
): UseQueryResult<SellerOrdersDto> =>
    useQuery({
        queryKey: operatorKeys.orders(sellerId),
        queryFn: () => api.get<SellerOrdersDto>(scoped('/api/seller/orders', sellerId)),
        enabled,
    });
export const useSessionAnalytics = (
    sessionId: string,
    enabled: boolean,
): UseQueryResult<SessionAnalyticsDto> =>
    useQuery({
        queryKey: operatorKeys.analytics(sessionId),
        queryFn: () => api.get<SessionAnalyticsDto>(`/api/seller/sessions/${sessionId}/analytics`),
        enabled,
    });
export const useSessionModeration = (
    sessionId: string | null,
    enabled: boolean,
): UseQueryResult<{
    entries: ModerationEntry[];
}> =>
    useQuery({
        queryKey: operatorKeys.moderation(sessionId ?? 'none'),
        queryFn: () =>
            api.get<{
                entries: ModerationEntry[];
            }>(`/api/seller/sessions/${sessionId ?? ''}/moderation`),
        enabled: enabled && sessionId !== null,
    });
const SHOPPER_PRICE_KEYS = [['products'], ['product'], ['session'], ['cart']];
const pricingMessage = (err: unknown): string => {
    if (err instanceof ApiError) {
        return err.code === 'mrp_below_price'
            ? 'MRP must be strictly above the selling price — otherwise there is no markdown to show.'
            : err.message;
    }
    return 'Could not save the price.';
};
export type VariantPricingInput = {
    productId: string;
    variantId: string;
    priceMinorUnits?: number;
    mrpMinorUnits?: number | null;
    stock?: number;
};
export const useUpdateVariantPricing = (
    sellerId: string | null = null,
): UseMutationResult<
    {
        variant: SellerProductVariant;
    },
    Error,
    VariantPricingInput
> => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ productId, variantId, ...patch }: VariantPricingInput) => {
            try {
                return await api.patch<{
                    variant: SellerProductVariant;
                }>(`/api/seller/products/${productId}/variants/${variantId}`, patch);
            } catch (err) {
                throw new Error(pricingMessage(err));
            }
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({
                queryKey: operatorKeys.products(sellerId),
            });
            await queryClient.invalidateQueries({
                queryKey: operatorKeys.overview(sellerId),
            });
            for (const key of SHOPPER_PRICE_KEYS) {
                await queryClient.invalidateQueries({ queryKey: key });
            }
        },
    });
};
export type CoHostInvite = {
    token: string;
    expiresAt: string;
};
export const useCreateCohostInvite = (): UseMutationResult<CoHostInvite, Error, string> =>
    useMutation({
        mutationFn: (sessionId) =>
            api.post<CoHostInvite>(`/api/sessions/${sessionId}/cohost-invite`),
    });
export const useRemoveCohost = (): UseMutationResult<LiveSessionDto, Error, string> => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (sessionId) => {
            const res = await api.del<{
                session: LiveSessionDto;
            }>(`/api/sessions/${sessionId}/cohost`);
            return res.session;
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['session'] });
            await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
        },
    });
};
export const useUpdateSessionPricing = (): UseMutationResult<
    LiveSessionDto,
    Error,
    {
        sessionId: string;
        discountPercent: number | null;
    }
> => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ sessionId, discountPercent }) => {
            try {
                const res = await api.patch<{
                    session: LiveSessionDto;
                }>(`/api/sessions/${sessionId}/pricing`, { discountPercent });
                return res.session;
            } catch (err) {
                throw new Error(pricingMessage(err));
            }
        },
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['session'] });
            await queryClient.invalidateQueries({ queryKey: ['cart'] });
            await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
        },
    });
};
export type NewProductVariantInput = {
    label: string;
    sku?: string;
    priceMinorUnits: number;
    mrpMinorUnits?: number | null;
    stock: number;
    isDefault?: boolean;
};
export type NewProductInput = {
    sellerId?: string;
    title: string;
    brand: string;
    description: string;
    categorySlug: string;
    images?: string[];
    highlights?: string[];
    specs?: Record<string, string>;
    variants: NewProductVariantInput[];
};
export const useCreateProduct = (): UseMutationResult<
    {
        product: SellerProduct;
    },
    Error,
    NewProductInput
> => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: NewProductInput) =>
            api.post<{
                product: SellerProduct;
            }>('/api/seller/products', input),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
            await queryClient.invalidateQueries({ queryKey: ['seller', 'overview'] });
            for (const key of SHOPPER_PRICE_KEYS) {
                await queryClient.invalidateQueries({ queryKey: key });
            }
        },
    });
};
