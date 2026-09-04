import type { CartDto, EventName, ServerEvent } from '@shop/shared';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { EVENTS } from '@shop/shared';

type Handler = (event: ServerEvent) => void;
const isCartDto = (data: unknown): data is CartDto =>
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    'totals' in data &&
    Array.isArray((data as CartDto).items);
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
                    if (isCartDto(event.data)) {
                        queryClient.setQueryData(['cart'], event.data);
                    } else {
                        void queryClient.refetchQueries({ queryKey: ['cart'] });
                    }
                    break;
                case EVENTS.promotionsChanged:
                case EVENTS.checkoutPolicyChanged:
                    refetchAuthoritative();
                    break;
                case EVENTS.catalogPriceChanged:
                    void queryClient.invalidateQueries({ queryKey: ['products'] });
                    void queryClient.invalidateQueries({ queryKey: ['product'] });
                    void queryClient.invalidateQueries({ queryKey: ['session'] });
                    void queryClient.invalidateQueries({ queryKey: ['cart'] });
                    break;
                case EVENTS.sessionPricingChanged:
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
