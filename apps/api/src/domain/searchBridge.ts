import { createSearchProvider, type SearchQuery } from '@shop/search';
import { env } from '../env.js';
import { listProducts } from './catalog.js';
const provider = createSearchProvider(env.SEARCH_PROVIDER, { listProducts }, env.OPENSEARCH_URL || undefined);
export const searchCatalog = (query: SearchQuery) => provider.search(query);
export const indexCatalogProduct = provider.index.bind(provider);
