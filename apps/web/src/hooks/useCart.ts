import type { CartDto } from '@shop/shared';
import type { UseQueryResult } from '@tanstack/react-query';

import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';

export const useCart = (enabled = true): UseQueryResult<CartDto, Error> =>
    useQuery({
        queryKey: ['cart'],
        queryFn: () => api.get<CartDto>('/api/cart'),
        enabled,
        staleTime: 0,
    });
