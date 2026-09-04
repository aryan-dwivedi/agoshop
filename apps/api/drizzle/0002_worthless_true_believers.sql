-- Both columns are additive and nullable, so `IF NOT EXISTS` keeps `db:push`
-- convergent on an environment where the column was already added out of band.
ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "discount_percent" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "mrp_minor_units" integer;
