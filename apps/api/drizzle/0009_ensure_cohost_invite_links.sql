-- 0008 previously repaired the Seller 2 demo account. Deployments that applied
-- that version still need the link-based co-host columns introduced later.
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "co_host_invite_token_hash" text;
--> statement-breakpoint
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "co_host_invite_expires_at" timestamp with time zone;
