import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  DeliveryTier,
  LiveSessionDto,
  OrderDto,
  SellerOverviewDto as SellerOverviewBody,
  SessionAnalyticsDto,
  SessionStatus,
} from '@shop/shared';

import { ApiError, api } from './api';

/**
 * Seller-panel reads. Keys stay under `seller` so they never collide with the
 * storefront's `['cart']` / `['session']` / `['orders']` SSE invalidations.
 */

/** A storefront visible to the signed-in seller. */
export type SellerRef = { id: string; slug: string; displayName: string };

/** Every seller response names the storefronts in view and the one it scoped to. */
export type SellerScope = { sellers: SellerRef[]; sellerId: string };

/** `GET /api/seller/overview`, plus the storefronts the response was scoped against. */
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
  /** Written exactly once, by the request that wins the scheduled -> live transition. */
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
  /** Tier 1. `null` when this variant is not marked down from a list price. */
  mrpMinorUnits: number | null;
  stock: number;
};

/** A scheduled or live show this product is on the line-up of — the §4.13 "In shows" column. */
export type ProductShowRef = { id: string; slug: string; title: string; status: SessionStatus };

export type SellerProduct = {
  productId: string;
  slug: string;
  title: string;
  brand: string;
  categorySlug: string;
  imageUrl: string | null;
  rating: number;
  /** Lowest variant price. */
  priceMinorUnits: number;
  totalStock: number;
  lowStock: boolean;
  variants: SellerProductVariant[];
  /** Absent until the join lands server-side; consumers render `—`, never an empty claim. */
  inShows?: ProductShowRef[];
};

export type SellerSessionsDto = SellerScope & { sessions: SellerSessionRow[] };

export type SellerProductsDto = SellerScope & {
  lowStockThreshold: number;
  products: SellerProduct[];
};

/** Paid orders containing at least one line for a product this caller owns. */
export type SellerOrdersDto = SellerScope & { orders: OrderDto[] };

/** One pin window on the viewer curve: the stretch a product was on camera. */
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

/** `?sellerId=` narrows a multi-storefront caller to one; omitted spans all visible ones. */
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
    // A live row's viewer count and GMV move while you watch; a static list does not.
    refetchInterval: (query) =>
      query.state.data?.sessions.some((s) => s.status === 'live') === true ? 10_000 : false,
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
): UseQueryResult<{ entries: ModerationEntry[] }> =>
  useQuery({
    queryKey: operatorKeys.moderation(sessionId ?? 'none'),
    queryFn: () =>
      api.get<{ entries: ModerationEntry[] }>(`/api/seller/sessions/${sessionId ?? ''}/moderation`),
    enabled: enabled && sessionId !== null,
  });

/**
 * Operator writes that move a price.
 *
 * A shopper tab caches products, a product page, a session snapshot and a cart, and
 * every one of them carries a number derived from the row being written here. SSE
 * fans the same invalidation out to other clients (`catalog.price_changed`), but the
 * tab that issued the write must not wait for a round trip through Redis to stop
 * showing the old number.
 */
const SHOPPER_PRICE_KEYS = [['products'], ['product'], ['session'], ['cart']];

/** Server codes a seller can actually act on; anything else keeps the server's text. */
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

/**
 * `PATCH /api/seller/products/:productId/variants/:variantId`.
 *
 * Rejections are rethrown as plain readable text so a form can render
 * `mutation.error.message` without every caller re-deriving the same copy.
 */
export const useUpdateVariantPricing = (
  sellerId: string | null = null,
): UseMutationResult<{ variant: SellerProductVariant }, Error, VariantPricingInput> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, variantId, ...patch }: VariantPricingInput) => {
      try {
        return await api.patch<{ variant: SellerProductVariant }>(
          `/api/seller/products/${productId}/variants/${variantId}`,
          patch,
        );
      } catch (err) {
        throw new Error(pricingMessage(err));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: operatorKeys.products(sellerId) });
      // Stock value and the low-stock counters on the dashboard are derived from it too.
      await queryClient.invalidateQueries({ queryKey: operatorKeys.overview(sellerId) });
      for (const key of SHOPPER_PRICE_KEYS) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
};

/** `PUT /api/sessions/:id/cohost` — invite a registered user as a second publisher. */
export const useInviteCohost = (): UseMutationResult<
  LiveSessionDto,
  Error,
  { sessionId: string; email: string }
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, email }) => {
      const res = await api.put<{ session: LiveSessionDto }>(`/api/sessions/${sessionId}/cohost`, {
        email,
      });
      return res.session;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
    },
  });
};

export const useRemoveCohost = (): UseMutationResult<LiveSessionDto, Error, string> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (sessionId) => {
      const res = await api.del<{ session: LiveSessionDto }>(
        `/api/sessions/${sessionId}/cohost`,
      );
      return res.session;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
    },
  });
};

/**
 * `PATCH /api/sessions/:id/pricing` — the host moving this room's live markdown while
 * the show runs. `null` (and 0) mean "this room adds no rule of its own".
 */
export const useUpdateSessionPricing = (): UseMutationResult<
  LiveSessionDto,
  Error,
  { sessionId: string; discountPercent: number | null }
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ sessionId, discountPercent }) => {
      try {
        const res = await api.patch<{ session: LiveSessionDto }>(
          `/api/sessions/${sessionId}/pricing`,
          { discountPercent },
        );
        return res.session;
      } catch (err) {
        throw new Error(pricingMessage(err));
      }
    },
    onSuccess: async () => {
      // The ladder the room renders and every line already in a cart both move.
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      // Prefix match: every storefront scope of the operator sessions list is now stale.
      await queryClient.invalidateQueries({ queryKey: ['seller', 'sessions'] });
    },
  });
};

export type NewProductVariantInput = {
  label: string;
  /** Omitted lets the server derive one from the product slug, which is the common case. */
  sku?: string;
  priceMinorUnits: number;
  /** `null` means "not marked down"; a number must be strictly above the price. */
  mrpMinorUnits?: number | null;
  stock: number;
  isDefault?: boolean;
};

export type NewProductInput = {
  /** Omitted means the caller's primary storefront; the server rejects one they do not own. */
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

/**
 * `POST /api/seller/products` — the listing a seller could not create until now.
 *
 * A create is not a price edit, but it lands in the same caches: the console's product
 * table and overview counters, plus every shopper surface that renders a catalog page.
 * Both operator keys are invalidated by prefix rather than for one storefront, because
 * the new row belongs to both the `?sellerId=` scope it was filed under and the
 * seller's unfiltered storefront scope.
 *
 * Unlike the pricing writes above, the `ApiError` is deliberately not flattened into a
 * sentence: the form maps codes (`sku_taken`, `unknown_category`, …) back onto the field
 * that caused them, which needs the code and not prose.
 */
export const useCreateProduct = (): UseMutationResult<
  { product: SellerProduct },
  Error,
  NewProductInput
> => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProductInput) =>
      api.post<{ product: SellerProduct }>('/api/seller/products', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['seller', 'products'] });
      await queryClient.invalidateQueries({ queryKey: ['seller', 'overview'] });
      for (const key of SHOPPER_PRICE_KEYS) {
        await queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
};
