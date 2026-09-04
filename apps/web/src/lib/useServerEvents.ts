import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { EVENTS, type EventName, type ServerEvent } from '@shop/shared';

type Handler = (event: ServerEvent) => void;

/**
 * One EventSource per page, scoped with repeatable `?sessionId=`.
 *
 * Redis pub/sub and SSE offer no replay, so on (re)connect we refetch the
 * authoritative snapshots instead of assuming we missed nothing.
 */
export const useServerEvents = (opts: {
  enabled: boolean;
  sessionIds?: string[];
  onEvent?: Handler;
}): void => {
  const { enabled, sessionIds, onEvent } = opts;
  const queryClient = useQueryClient();
  const key = (sessionIds ?? []).join(',');

  useEffect(() => {
    if (!enabled) return;
    const params = new URLSearchParams();
    for (const id of key.length > 0 ? key.split(',') : []) params.append('sessionId', id);
    const url = `/api/events${params.toString() ? `?${params.toString()}` : ''}`;
    const source = new EventSource(url, { withCredentials: true });

    const refetchAuthoritative = () => {
      void queryClient.invalidateQueries({ queryKey: ['cart'] });
      void queryClient.invalidateQueries({ queryKey: ['checkout-options'] });
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    };

    source.onopen = refetchAuthoritative;

    source.onmessage = (raw) => {
      const event = JSON.parse(raw.data) as ServerEvent;
      switch (event.event as EventName) {
        case EVENTS.cartUpdated:
          void queryClient.invalidateQueries({ queryKey: ['cart'] });
          break;
        case EVENTS.promotionsChanged:
        case EVENTS.checkoutPolicyChanged:
          // Global rule change: never trust a cached price.
          refetchAuthoritative();
          break;
        case EVENTS.catalogPriceChanged:
          // A seller moved an MRP, a price or stock: never trust a cached price, and the
          // listings and product pages hold one just as much as the cart does.
          void queryClient.invalidateQueries({ queryKey: ['products'] });
          void queryClient.invalidateQueries({ queryKey: ['product'] });
          void queryClient.invalidateQueries({ queryKey: ['session'] });
          void queryClient.invalidateQueries({ queryKey: ['cart'] });
          break;
        case EVENTS.sessionPricingChanged:
          // Room-scoped markdown: the snapshot carries the ladder, the cart carries the
          // lines priced by it. Both are stale the instant the host moves it.
          void queryClient.invalidateQueries({ queryKey: ['session'] });
          void queryClient.invalidateQueries({ queryKey: ['cart'] });
          break;
        case EVENTS.sessionStatusChanged:
        case EVENTS.sessionDeliveryTierChanged:
        case EVENTS.sessionProductPinned:
          void queryClient.invalidateQueries({ queryKey: ['session'] });
          void queryClient.invalidateQueries({ queryKey: ['cart'] });
          break;
        case EVENTS.orderCreated:
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          break;
        default:
          break;
      }
      onEvent?.(event);
    };

    return () => source.close();
  }, [enabled, key, queryClient, onEvent]);
};
