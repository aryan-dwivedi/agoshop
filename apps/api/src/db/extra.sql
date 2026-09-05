-- Expression indexes Drizzle cannot express. Applied after every migration run.

-- The searchable document covers highlights and specs as well as title/brand/
-- description: the words shoppers use ("battery life", "wireless", "waterproof") live
-- in specs, not in the prose. Must match `FTS` in `domain/catalog.ts` verbatim, or
-- Postgres cannot use the index. The superseded index is dropped by name.
DROP INDEX IF EXISTS products_fts_idx;

CREATE INDEX IF NOT EXISTS products_search_idx
  ON products
  USING GIN (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(description, '')
    || ' ' || translate(highlights::text, '[]{}",:', '       ')
    || ' ' || translate(specs::text, '[]{}",:', '       ')));

CREATE INDEX IF NOT EXISTS transcripts_fts_idx
  ON session_transcripts
  USING GIN (to_tsvector('simple', coalesce(text, '')));

-- Catalog search also matches on variant text (SKU, label, attrs). `resolveTextMatch` in
-- `domain-commerce/catalog.ts` resolves that to a product-id list with one `ilike '%x%'`
-- scan; trigram indexes turn that scan into an index lookup. Categories and sellers are
-- small enough that a seq scan there is already free.
-- Guarded: these are an optimisation, not a correctness requirement, and a role that
-- cannot install pg_trgm must not take the whole service down at startup.
DO $trgm$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX IF NOT EXISTS variants_sku_trgm_idx
    ON product_variants USING GIN (sku gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS variants_label_trgm_idx
    ON product_variants USING GIN (label gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS variants_attrs_trgm_idx
    ON product_variants USING GIN ((attrs::text) gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pg_trgm unavailable (%); variant search falls back to a sequential scan', SQLERRM;
END
$trgm$;

-- Numeric Agora RTC uids are handed out from one sequence so viewer, agent, recorder
-- and caption-bot uids can never collide.
CREATE SEQUENCE IF NOT EXISTS agora_uid_seq START WITH 100000 INCREMENT BY 1;

-- endSession fans cart.updated out to every user holding a line bound to the session.
-- Postgres does not index FK columns automatically, so without this the plan's
-- "one indexed query" is a sequential scan over every cart line.
CREATE INDEX IF NOT EXISTS cart_items_live_session_idx
  ON cart_items (live_session_id)
  WHERE live_session_id IS NOT NULL;
