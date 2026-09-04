import type { ProductDto } from '@shop/shared';

export type SearchQuery = {
  q: string;
  categorySlug?: string;
  maxPriceMinorUnits?: number;
  minRating?: number;
  sort?: 'relevance' | 'price_asc' | 'price_desc' | 'rating';
  page?: number;
  pageSize?: number;
};

export type SearchResult = {
  total: number;
  items: ProductDto[];
};

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResult>;
  index(_product: ProductDto): Promise<void>;
}

export type SearchProviderId = 'postgres' | 'opensearch';
