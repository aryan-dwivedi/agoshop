import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse/sync';

/**
 * Loads marketplace listings from luminati-io/eCommerce-dataset-samples:
 *   - Walmart — full catalog (~1,000 rows)
 *   - Amazon — electronics & phones (~200+ rows)
 *   - Lazada — electronics & phones (~500+ rows)
 *   - Shopee — electronics & phones (~40+ rows)
 *
 * Curated demo products are seeded separately. Prices are converted to INR paise with
 * fixed demo FX rates so seeds stay reproducible.
 */

const DATASET_BASE =
  'https://raw.githubusercontent.com/luminati-io/eCommerce-dataset-samples/main';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');

export type MarketplaceSeedVariant = {
  sku: string;
  label: string;
  attrs: Record<string, string>;
  priceMinorUnits: number;
  mrpMinorUnits: number;
  stock: number;
};

export type MarketplaceSeedProduct = {
  slug: string;
  category: string;
  seller: string;
  title: string;
  brand: string;
  description: string;
  highlights: string[];
  specs: Record<string, string>;
  images: string[];
  rating: number;
  ratingCount: number;
  variants: MarketplaceSeedVariant[];
};

type MarketplaceSeller = { slug: string; displayName: string };
type CsvRow = Record<string, string>;

/** @deprecated use MarketplaceSeedProduct */
export type WalmartSeedProduct = MarketplaceSeedProduct;
/** @deprecated use MarketplaceSeedVariant */
export type WalmartSeedVariant = MarketplaceSeedVariant;

const USD_TO_INR = 83;

const CURRENCY_TO_INR: Record<string, number> = {
  USD: 83,
  MYR: 18,
  SGD: 62,
  IDR: 0.0052,
  PHP: 1.45,
  THB: 2.35,
  MXN: 4.8,
  CLP: 0.09,
  COP: 0.021,
  VND: 0.0033,
  BRL: 16,
  TWD: 2.6,
};

const ELECTRONICS_TERMS = [
  'phone',
  'iphone',
  'smartphone',
  'android',
  'galaxy',
  'pixel',
  'oneplus',
  'xiaomi',
  'redmi',
  'oppo',
  'vivo',
  'realme',
  'huawei',
  'nokia',
  'motorola',
  'laptop',
  'macbook',
  'notebook',
  'chromebook',
  'ultrabook',
  'tablet',
  'ipad',
  'headphone',
  'earbud',
  'earphone',
  'headset',
  'airpod',
  'speaker',
  'soundbar',
  'television',
  ' monitor',
  'monitor ',
  'projector',
  'camera',
  'webcam',
  'dslr',
  'gopro',
  'drone',
  'smartwatch',
  'fitbit',
  'garmin',
  'router',
  'modem',
  'mesh wifi',
  'keyboard',
  'mouse',
  'playstation',
  'xbox',
  'nintendo',
  'charger',
  'power bank',
  'usb-c',
  'hdmi',
  'ssd',
  'hard drive',
  'memory card',
  'graphics card',
  'motherboard',
  'processor',
  'bluetooth',
  'smart tv',
  'electronics',
  'electronic',
  'wireless',
  'smart home',
  'alexa',
  'echo dot',
  'kindle',
  'gpu',
  'cpu',
];

const ROOT_CATEGORY_MAP: Record<string, string> = {
  Clothing: 'apparel',
  Home: 'home',
  Beauty: 'cosmetics',
  'Premium Beauty': 'cosmetics',
  'Personal Care': 'cosmetics',
  Food: 'lifestyle',
  Pets: 'lifestyle',
  'Patio & Garden': 'home',
  'Health and Medicine': 'lifestyle',
  Baby: 'lifestyle',
  'Sports & Outdoors': 'lifestyle',
  Jewelry: 'jewellery',
  'Party & Occasions': 'lifestyle',
  Toys: 'lifestyle',
  'Household Essentials': 'home',
  Electronics: 'electronics',
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

const stableHash = (value: string): number =>
  Number(BigInt(`0x${createHash('sha256').update(value).digest('hex').slice(0, 8)}`) % 10_000n);

const stockFor = (sku: string): number => 8 + (stableHash(sku) % 72);

const parseJson = <T>(raw: string | undefined, fallback: T): T => {
  const trimmed = raw?.trim();
  if (trimmed === undefined || trimmed.length === 0) return fallback;
  try {
    const normalized = trimmed.replace(/^"+|"+$/g, '').replace(/""/g, '"');
    return JSON.parse(normalized) as T;
  } catch {
    return fallback;
  }
};

const parseStringArray = (raw: string | undefined): string[] => {
  const parsed = parseJson<unknown>(raw, []);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry: unknown) =>
      typeof entry === 'string' && entry.trim().length > 0 ? [entry.trim()] : [],
    );
  }
  if (typeof raw === 'string' && raw.startsWith('http')) return [raw.trim()];
  return [];
};

const parseSpecifications = (raw: string | undefined): Record<string, string> => {
  const entries = parseJson<{ name?: string; value?: string }[]>(raw, []);
  const specs: Record<string, string> = {};
  for (const entry of entries) {
    const name = entry.name?.trim();
    const value = entry.value?.trim();
    if (name && value) specs[name] = value;
  }
  return specs;
};

const parseAmount = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const cleaned = raw.replace(/["$,]/g, '').trim();
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
};

const toInrPaise = (amount: number, currency: string): number => {
  const code = currency.trim().toUpperCase() || 'USD';
  const rate = CURRENCY_TO_INR[code] ?? USD_TO_INR;
  return Math.max(100, Math.round(amount * rate * 100));
};

const matchesElectronics = (text: string): boolean => {
  const lower = ` ${text.toLowerCase()} `;
  if (lower.includes(' electronics') || lower.includes(' electronic')) return true;
  return ELECTRONICS_TERMS.some((term) => lower.includes(term));
};

const categoryFromText = (text: string, fallback = 'electronics'): string => {
  const lower = text.toLowerCase();
  if (
    lower.includes('phone') ||
    lower.includes('iphone') ||
    lower.includes('smartphone') ||
    lower.includes('galaxy') ||
    lower.includes('pixel') ||
    lower.includes('tablet') ||
    lower.includes('ipad') ||
    lower.includes('laptop') ||
    lower.includes('macbook') ||
    lower.includes('computer')
  ) {
    return 'electronics';
  }
  if (lower.includes('beauty') || lower.includes('makeup') || lower.includes('skin')) {
    return 'cosmetics';
  }
  if (lower.includes('cloth') || lower.includes('apparel') || lower.includes('wear')) {
    return 'apparel';
  }
  if (lower.includes('jewel')) return 'jewellery';
  if (lower.includes('fitness') || lower.includes('sport')) return 'lifestyle';
  if (lower.includes('home') || lower.includes('decor') || lower.includes('kitchen')) {
    return 'home';
  }
  return fallback;
};

const walmartCategoryFor = (row: CsvRow): string => {
  const root = row.root_category_name?.trim();
  if (root && ROOT_CATEGORY_MAP[root]) return ROOT_CATEGORY_MAP[root]!;
  return categoryFromText(
    [...parseStringArray(row.categories), row.product_name ?? '', row.description ?? ''].join(' '),
    'home',
  );
};

class CatalogRegistry {
  private readonly usedSlugs = new Set<string>();
  private readonly usedSkus = new Set<string>();
  private readonly usedImages = new Set<string>();

  claimImage(urls: string[]): string | null {
    for (const url of urls) {
      if (!url.startsWith('http') || this.usedImages.has(url)) continue;
      this.usedImages.add(url);
      return url;
    }
    return null;
  }

  claimSku(sku: string): boolean {
    if (this.usedSkus.has(sku)) return false;
    this.usedSkus.add(sku);
    return true;
  }

  claimSlug(prefix: string, title: string, id: string, index: number): string | null {
    let slug = `${prefix}-${slugify(title)}-${id}`;
    if (this.usedSlugs.has(slug)) slug = `${slug}-${index}`;
    if (this.usedSlugs.has(slug)) return null;
    this.usedSlugs.add(slug);
    return slug;
  }
}

const ensureDatasetCsv = async (fileName: string): Promise<string> => {
  const path = join(dataDir, fileName);
  if (existsSync(path)) return path;
  await mkdir(dataDir, { recursive: true });
  const response = await fetch(`${DATASET_BASE}/${fileName}`);
  if (!response.ok) {
    throw new Error(`seed: failed to download ${fileName} (${response.status})`);
  }
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
};

const readCsv = (path: string): CsvRow[] =>
  parse(readFileSync(path, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as CsvRow[];

const buildProduct = (input: {
  registry: CatalogRegistry;
  prefix: string;
  source: string;
  sourceId: string;
  index: number;
  seller: MarketplaceSeller;
  title: string;
  brand: string;
  description: string;
  category: string;
  images: string[];
  priceMinorUnits: number;
  mrpMinorUnits: number;
  rating: number;
  ratingCount: number;
  specs: Record<string, string>;
  highlights: string[];
  sku: string;
  colors: string[];
  sizes: string[];
}): MarketplaceSeedProduct | null => {
  const {
    registry,
    prefix,
    source,
    sourceId,
    index,
    seller,
    title,
    brand,
    description,
    category,
    images,
    priceMinorUnits,
    mrpMinorUnits,
    rating,
    ratingCount,
    specs,
    highlights,
    sku,
    colors,
    sizes,
  } = input;

  const image = registry.claimImage(images);
  if (image === null) return null;

  const slug = registry.claimSlug(prefix, title, sourceId, index);
  if (slug === null || !registry.claimSku(sku)) return null;

  const makeVariant = (
    label: string,
    attrs: Record<string, string>,
    variantSku: string,
  ): MarketplaceSeedVariant => ({
    sku: variantSku,
    label,
    attrs,
    priceMinorUnits,
    mrpMinorUnits,
    stock: stockFor(`${variantSku}:${label}`),
  });

  const variants =
    colors.length > 1
      ? colors
          .slice(0, 6)
          .map((color, colorIndex) =>
            makeVariant(color, { color }, `${sku}-C${colorIndex + 1}`),
          )
      : sizes.length > 1
        ? sizes
            .slice(0, 6)
            .map((size, sizeIndex) => makeVariant(size, { size }, `${sku}-S${sizeIndex + 1}`))
        : [makeVariant('Standard', colors[0] ? { color: colors[0] } : {}, sku)];

  return {
    slug,
    category,
    seller: seller.slug,
    title: title.slice(0, 240),
    brand: brand.slice(0, 80),
    description: description.slice(0, 4_000),
    highlights:
      highlights.length > 0 ? highlights : [brand, `Listed on ${source}`],
    specs: {
      ...specs,
      Seller: seller.displayName,
      Marketplace: source,
      'Source ID': sourceId,
    },
    images: [image],
    rating,
    ratingCount,
    variants,
  };
};

const loadWalmartRows = (
  rows: CsvRow[],
  sellers: MarketplaceSeller[],
  registry: CatalogRegistry,
): MarketplaceSeedProduct[] => {
  const products: MarketplaceSeedProduct[] = [];
  rows.forEach((row, index) => {
    const title = row.product_name?.trim();
    const brand = (row.brand?.trim() || 'Walmart').slice(0, 80);
    const sourceId = row.sku?.trim() || row.product_id?.trim();
    if (!title || !sourceId) return;

    const amount = parseAmount(row.final_price);
    if (amount === null) return;
    const priceMinorUnits = toInrPaise(amount, row.currency?.trim() || 'USD');
    const initial = parseAmount(row.initial_price);
    const mrpMinorUnits = Math.max(
      priceMinorUnits,
      initial === null ? Math.round((priceMinorUnits * 1.12) / 100) * 100 : toInrPaise(initial, row.currency?.trim() || 'USD'),
    );

    const main = row.main_image?.replace(/^"+|"+$/g, '').trim();
    const images = [...(main ? [main] : []), ...parseStringArray(row.image_urls)];

    const specs = parseSpecifications(row.specifications);
    if (!specs.Brand && brand) specs.Brand = brand;

    const product = buildProduct({
      registry,
      prefix: 'wm',
      source: 'Walmart',
      sourceId,
      index,
      seller: sellers[index % sellers.length]!,
      title,
      brand,
      description: row.description?.trim() || title,
      category: walmartCategoryFor(row),
      images,
      priceMinorUnits,
      mrpMinorUnits,
      rating: Math.min(5, Math.max(3.2, Number.parseFloat(row.rating ?? '4') || 4)),
      ratingCount: Math.max(0, Number.parseInt(row.review_count ?? '0', 10) || 0),
      specs,
      highlights: [
        ...parseStringArray(row.tags),
        ...parseStringArray(row.review_tags),
        row.root_category_name?.trim() ?? '',
      ]
        .map((item) => item.trim())
        .filter((item, itemIndex, all) => item.length > 0 && all.indexOf(item) === itemIndex)
        .slice(0, 4),
      sku: `WMT-${sourceId}`,
      colors: parseStringArray(row.colors),
      sizes: parseStringArray(row.sizes),
    });
    if (product) products.push(product);
  });
  return products;
};

const loadAmazonRows = (
  rows: CsvRow[],
  sellers: MarketplaceSeller[],
  registry: CatalogRegistry,
): MarketplaceSeedProduct[] => {
  const products: MarketplaceSeedProduct[] = [];
  let seen = 0;
  rows.forEach((row, index) => {
    const title = row.title?.trim();
    const sourceId = row.asin?.trim();
    if (!title || !sourceId) return;

    const blob = [
      title,
      row.description ?? '',
      row.categories ?? '',
      row.department ?? '',
      row.brand ?? '',
    ].join(' ');
    if (!matchesElectronics(blob)) return;

    const amount = parseAmount(row.final_price) ?? parseAmount(row.initial_price);
    if (amount === null) return;

    const priceMinorUnits = toInrPaise(amount, row.currency?.trim() || 'USD');
    const initial = parseAmount(row.initial_price);
    const mrpMinorUnits = Math.max(
      priceMinorUnits,
      initial === null ? Math.round((priceMinorUnits * 1.12) / 100) * 100 : toInrPaise(initial, row.currency?.trim() || 'USD'),
    );

    const brand = (row.brand?.trim() || row.manufacturer?.trim() || 'Amazon').slice(0, 80);
    const categories = parseStringArray(row.categories);
    const category = categoryFromText(
      [row.department ?? '', ...categories, title].join(' '),
      'electronics',
    );

    const product = buildProduct({
      registry,
      prefix: 'amz',
      source: 'Amazon',
      sourceId,
      index,
      seller: sellers[seen % sellers.length]!,
      title,
      brand,
      description: row.description?.trim() || title,
      category,
      images: row.image_url?.trim() ? [row.image_url.trim()] : [],
      priceMinorUnits,
      mrpMinorUnits,
      rating: Math.min(5, Math.max(3.2, Number.parseFloat(row.rating ?? '4') || 4)),
      ratingCount: Math.max(0, Number.parseInt(row.reviews_count ?? '0', 10) || 0),
      specs: {
        Brand: brand,
        Department: row.department?.trim() ?? 'Electronics',
        ASIN: sourceId,
        ...(row.model_number?.trim() ? { Model: row.model_number.trim() } : {}),
      },
      highlights: [brand, row.department?.trim() ?? 'Electronics', ...categories.slice(0, 2)],
      sku: `AMZ-${sourceId}`,
      colors: [],
      sizes: [],
    });
    if (product) {
      products.push(product);
      seen += 1;
    }
  });
  return products;
};

const loadLazadaRows = (
  rows: CsvRow[],
  sellers: MarketplaceSeller[],
  registry: CatalogRegistry,
): MarketplaceSeedProduct[] => {
  const products: MarketplaceSeedProduct[] = [];
  let seen = 0;
  rows.forEach((row, index) => {
    const title = row.title?.trim();
    if (!title) return;

    const breadcrumb = parseStringArray(row.breadcrumb);
    const blob = [title, row.product_description ?? '', breadcrumb.join(' ')].join(' ');
    if (!matchesElectronics(blob)) return;

    const sourceId = `${index}-${stableHash(`${title}:${row.url ?? ''}`)}`;
    const amount = parseAmount(row.final_price) ?? parseAmount(row.initial_price);
    if (amount === null) return;

    const currency = row.currency?.trim() || 'USD';
    const priceMinorUnits = toInrPaise(amount, currency);
    const initial = parseAmount(row.initial_price);
    const mrpMinorUnits = Math.max(
      priceMinorUnits,
      initial === null || initial <= amount
        ? Math.round((priceMinorUnits * 1.1) / 100) * 100
        : toInrPaise(initial, currency),
    );

    const specs = parseSpecifications(row.product_specifications);
    const brand = (specs.Merek ?? specs.Brand ?? row.seller_name?.trim() ?? 'Lazada').slice(0, 80);

    const product = buildProduct({
      registry,
      prefix: 'lzd',
      source: 'Lazada',
      sourceId,
      index,
      seller: sellers[seen % sellers.length]!,
      title,
      brand,
      description: row.product_description?.trim() || title,
      category: categoryFromText(blob, 'electronics'),
      images: parseStringArray(row.image),
      priceMinorUnits,
      mrpMinorUnits,
      rating: Math.min(5, Math.max(3.2, Number.parseFloat(row.rating ?? '4') || 4)),
      ratingCount: Math.max(0, Number.parseInt(row.reviews ?? '0', 10) || 0),
      specs: { ...specs, Brand: brand },
      highlights: [brand, ...breadcrumb.slice(0, 3)],
      sku: `LZD-${sourceId}`,
      colors: [],
      sizes: [],
    });
    if (product) {
      products.push(product);
      seen += 1;
    }
  });
  return products;
};

const loadShopeeRows = (
  rows: CsvRow[],
  sellers: MarketplaceSeller[],
  registry: CatalogRegistry,
): MarketplaceSeedProduct[] => {
  const products: MarketplaceSeedProduct[] = [];
  let seen = 0;
  rows.forEach((row, index) => {
    const title = row.title?.trim();
    const sourceId = row.id?.trim();
    if (!title || !sourceId) return;

    const blob = title;
    if (!matchesElectronics(blob)) return;

    const amount = parseAmount(row.final_price) ?? parseAmount(row.initial_price);
    if (amount === null) return;

    const currency = row.currency?.trim() || 'USD';
    const priceMinorUnits = toInrPaise(amount, currency);
    const initial = parseAmount(row.initial_price);
    const mrpMinorUnits = Math.max(
      priceMinorUnits,
      initial === null || initial <= amount
        ? Math.round((priceMinorUnits * 1.1) / 100) * 100
        : toInrPaise(initial, currency),
    );

    const brand = (row.seller_name?.trim() || 'Shopee').slice(0, 80);

    const product = buildProduct({
      registry,
      prefix: 'shp',
      source: 'Shopee',
      sourceId,
      index,
      seller: sellers[seen % sellers.length]!,
      title,
      brand,
      description: title,
      category: categoryFromText(blob, 'electronics'),
      images: parseStringArray(row.image),
      priceMinorUnits,
      mrpMinorUnits,
      rating: Math.min(5, Math.max(3.2, Number.parseFloat(row.rating ?? '4') || 4)),
      ratingCount: Math.max(0, Number.parseInt(row.reviews ?? '0', 10) || 0),
      specs: { Brand: brand, Seller: brand },
      highlights: [brand, 'Shopee electronics'],
      sku: `SHP-${sourceId}`,
      colors: [],
      sizes: [],
    });
    if (product) {
      products.push(product);
      seen += 1;
    }
  });
  return products;
};

export const loadMarketplaceCatalog = async (
  sellers: MarketplaceSeller[],
): Promise<MarketplaceSeedProduct[]> => {
  if (sellers.length === 0) {
    throw new Error('seed: marketplace sellers required for online catalog');
  }

  const registry = new CatalogRegistry();
  const counts: Record<string, number> = {};

  const walmart = loadWalmartRows(
    readCsv(await ensureDatasetCsv('walmart-products.csv')),
    sellers,
    registry,
  );
  counts.walmart = walmart.length;

  const amazon = loadAmazonRows(
    readCsv(await ensureDatasetCsv('amazon-products.csv')),
    sellers,
    registry,
  );
  counts.amazon_electronics = amazon.length;

  const lazada = loadLazadaRows(
    readCsv(await ensureDatasetCsv('lazada-products.csv')),
    sellers,
    registry,
  );
  counts.lazada_electronics = lazada.length;

  const shopee = loadShopeeRows(
    readCsv(await ensureDatasetCsv('shopee-products.csv')),
    sellers,
    registry,
  );
  counts.shopee_electronics = shopee.length;

  const products = [...walmart, ...amazon, ...lazada, ...shopee];
  if (products.length === 0) {
    throw new Error('seed: online marketplace catalogs produced zero rows');
  }

  const electronics = products.filter((product) => product.category === 'electronics').length;
  console.log(
    `seed: marketplace sources — walmart=${counts.walmart}, amazon_electronics=${counts.amazon_electronics}, lazada_electronics=${counts.lazada_electronics}, shopee_electronics=${counts.shopee_electronics} (${electronics} electronics total)`,
  );

  return products;
};

/** @deprecated use loadMarketplaceCatalog */
export const loadWalmartCatalog = loadMarketplaceCatalog;

export const WALMART_CSV_URL = `${DATASET_BASE}/walmart-products.csv`;
export const WALMART_CSV_PATH = join(dataDir, 'walmart-products.csv');
