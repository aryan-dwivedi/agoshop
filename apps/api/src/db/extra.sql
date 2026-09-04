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

-- Numeric Agora RTC uids are handed out from one sequence so viewer, agent, recorder
-- and caption-bot uids can never collide.
CREATE SEQUENCE IF NOT EXISTS agora_uid_seq START WITH 100000 INCREMENT BY 1;

-- endSession fans cart.updated out to every user holding a line bound to the session.
-- Postgres does not index FK columns automatically, so without this the plan's
-- "one indexed query" is a sequential scan over every cart line.
CREATE INDEX IF NOT EXISTS cart_items_live_session_idx
  ON cart_items (live_session_id)
  WHERE live_session_id IS NOT NULL;
