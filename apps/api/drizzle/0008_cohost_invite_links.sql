-- Co-host links are bearer credentials. Only their SHA-256 digest is persisted,
-- and links expire so a leaked URL cannot grant publishing access indefinitely.
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "co_host_invite_token_hash" text;
--> statement-breakpoint
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "co_host_invite_expires_at" timestamp with time zone;
