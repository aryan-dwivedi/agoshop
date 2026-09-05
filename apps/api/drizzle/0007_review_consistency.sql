-- Durable order, live-session, and MCP execution states.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'capturing';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'expiring';
--> statement-breakpoint
ALTER TABLE "live_sessions"
  ADD COLUMN IF NOT EXISTS "start_effects_completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "end_effects_completed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "delivery_tier_published_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ai_tool_calls" ALTER COLUMN "result" DROP NOT NULL;
ALTER TABLE "ai_tool_calls" ADD COLUMN IF NOT EXISTS "state" text DEFAULT 'completed' NOT NULL;
ALTER TABLE "ai_tool_calls" ADD COLUMN IF NOT EXISTS "claim_token" text;
ALTER TABLE "ai_tool_calls" ADD COLUMN IF NOT EXISTS "claim_expires_at" timestamp with time zone;
ALTER TABLE "ai_tool_calls" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "ai_tool_calls" ALTER COLUMN "state" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "ai_tool_calls" DROP CONSTRAINT IF EXISTS "ai_tool_calls_conversation_id_turn_id_name_args_hash_pk";
ALTER TABLE "ai_tool_calls" DROP CONSTRAINT IF EXISTS "ai_tool_calls_pkey";
ALTER TABLE "ai_tool_calls"
  ADD CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("conversation_id", "tool_call_id");
