import type { SearchProvider, SearchQuery, SearchResult } from './types.js';

export type PostgresSearchDeps = {
  listProducts: (query: {
    q?: string;
    categorySlug?: string;
    maxPriceMinorUnits?: number;
    minRating?: number;
    sort?: 'relevance' | 'price_asc' | 'price_desc' | 'rating';
    page?: number;
    pageSize?: number;
  }) => Promise<{ total: number; items: import('@shop/shared').ProductDto[] }>;
};

/** Default provider: Postgres full-text search via the catalog domain. */
export const createPostgresSearchProvider = (deps: PostgresSearchDeps): SearchProvider => ({
  async search(query: SearchQuery): Promise<SearchResult> {
    return deps.listProducts({
      q: query.q,
      categorySlug: query.categorySlug,
      maxPriceMinorUnits: query.maxPriceMinorUnits,
      minRating: query.minRating,
      sort: query.sort ?? 'relevance',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 12,
    });
  },
  async index() {
    // FTS reads live rows; no separate index step for Postgres.
  },
});

export type OpenSearchConfig = {
  url: string;
  indexName: string;
};

/**
 * Optional OpenSearch backend. When `OPENSEARCH_URL` is unset, use postgres instead.
 * Indexing is a no-op until a cluster is configured.
 */
export const createOpenSearchProvider = (
  config: OpenSearchConfig,
  fallback: SearchProvider,
): SearchProvider => ({
  async search(query: SearchQuery): Promise<SearchResult> {
    try {
      const res = await fetch(`${config.url}/${config.indexName}/_search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: ((query.page ?? 1) - 1) * (query.pageSize ?? 12),
          size: query.pageSize ?? 12,
          query: { multi_match: { query: query.q, fields: ['title^3', 'brand^2', 'description'] } },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return fallback.search(query);
      const body = (await res.json()) as {
        hits: { total: { value: number }; hits: { _source: import('@shop/shared').ProductDto }[] };
      };
      return {
        total: body.hits.total.value,
        items: body.hits.hits.map((h) => h._source),
      };
    } catch {
      return fallback.search(query);
    }
  },
  async index(product) {
    const res = await fetch(`${config.url}/${config.indexName}/_doc/${product.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(product),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      throw new Error(`opensearch_index_failed:${res.status}`);
    }
  },
});
