import type { ServerEvent } from '@shop/shared';
import type { QueryClient } from '@tanstack/react-query';

import { describe, expect, it, vi } from 'vitest';

import { EVENTS } from '@shop/shared';

import { routeServerEvent } from './useServerEvents.js';

describe('server event cache routing', () => {
    it('invalidates orders for asynchronous order updates', () => {
        const invalidateQueries = vi.fn();
        const queryClient = {
            invalidateQueries,
            refetchQueries: vi.fn(),
            setQueryData: vi.fn(),
        } as unknown as Pick<QueryClient, 'invalidateQueries' | 'refetchQueries' | 'setQueryData'>;
        const event: ServerEvent = {
            event: EVENTS.orderUpdated,
            data: { id: 'order-1', status: 'paid' },
            ts: Date.now(),
        };

        routeServerEvent(queryClient, event);

        expect(invalidateQueries).toHaveBeenCalledOnce();
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['orders'] });
    });
});
