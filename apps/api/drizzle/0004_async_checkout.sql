-- Async checkout: order lifecycle states and stock reservations.
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'payment_failed';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'cancelled';
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "reservation_status" AS ENUM('active', 'confirmed', 'released', 'expired');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "variant_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "status" "reservation_status" DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_reservations_order_idx" ON "stock_reservations" USING btree ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_reservations_variant_status_idx" ON "stock_reservations" USING btree ("variant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_reservations_expires_idx" ON "stock_reservations" USING btree ("expires_at");
