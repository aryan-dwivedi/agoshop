import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { CartDto } from '@shop/shared';

import { api } from '../lib/api';

/**
 * Cart prices are recomputed server-side on every read. A 15 s default staleTime would
 * let a live discount linger in the UI after the show ends if the SSE event was missed.
 */
export const useCart = (enabled = true): UseQueryResult<CartDto, Error> =>
  useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
    enabled,
    staleTime: 0,
  });
