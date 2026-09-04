ALTER TABLE "live_sessions" ADD COLUMN "co_host_user_id" uuid;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "source_video_url" text;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD COLUMN "auto_start" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_co_host_user_id_users_id_fk" FOREIGN KEY ("co_host_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;