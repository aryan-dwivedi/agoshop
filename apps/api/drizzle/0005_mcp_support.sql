ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'support';

DO $$ BEGIN
  CREATE TYPE "fulfilment_status" AS ENUM(
    'processing', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "support_ticket_status" AS ENUM(
    'queued', 'assigned', 'active', 'closed', 'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "fulfilment_status" "fulfilment_status";
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "tracking_number" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "carrier" text;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "estimated_delivery_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL REFERENCES "ai_conversations"("id") ON DELETE cascade,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "status" "support_ticket_status" DEFAULT 'queued' NOT NULL,
  "reason" text NOT NULL,
  "order_id" uuid REFERENCES "orders"("id") ON DELETE set null,
  "preference" text,
  "phone_e164" text,
  "transcript_snapshot" jsonb,
  "assigned_agent_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "support_rtc_uid" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "accepted_at" timestamp with time zone,
  "closed_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "support_tickets_status_idx"
  ON "support_tickets" ("status", "created_at");
