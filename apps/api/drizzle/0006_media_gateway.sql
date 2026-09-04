ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "media_gateway_uid" integer;
ALTER TABLE "live_sessions" ADD COLUMN IF NOT EXISTS "media_gateway_status" "side_service_status" DEFAULT 'off' NOT NULL;
