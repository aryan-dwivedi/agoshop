import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CartDto } from '@shop/shared';
import { api } from '../lib/api';
export const useCart = (enabled = true): UseQueryResult<CartDto, Error> => useQuery({
    queryKey: ['cart'],
    queryFn: () => api.get<CartDto>('/api/cart'),
    enabled,
    staleTime: 0,
});
