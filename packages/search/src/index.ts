export type { SearchProvider, SearchQuery, SearchResult, SearchProviderId } from './types.js';
export {
  createOpenSearchProvider,
  createPostgresSearchProvider,
  type PostgresSearchDeps,
  type OpenSearchConfig,
} from './providers.js';

import type { SearchProvider } from './types.js';
import { createOpenSearchProvider, createPostgresSearchProvider } from './providers.js';
import type { PostgresSearchDeps } from './providers.js';

export const createSearchProvider = (
  providerId: 'postgres' | 'opensearch',
  deps: PostgresSearchDeps,
  openSearchUrl?: string,
): SearchProvider => {
  const postgres = createPostgresSearchProvider(deps);
  if (providerId === 'opensearch' && openSearchUrl) {
    return createOpenSearchProvider(
      { url: openSearchUrl.replace(/\/$/, ''), indexName: 'products' },
      postgres,
    );
  }
  return postgres;
};
