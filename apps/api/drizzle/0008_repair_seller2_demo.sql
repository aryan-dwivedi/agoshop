-- Seller 2 was added after the long-lived demo database was initially seeded.
-- Preserve an existing password, but repair accounts created through customer registration.
INSERT INTO "users" (
  "email",
  "password_hash",
  "display_name",
  "role",
  "default_pincode",
  "preferred_language"
)
VALUES (
  'seller2@demo.test',
  '$2a$10$AtQ2nqw8USdqtSjPN/ZEbeV8r8luU8VYq1ZP5blGqOiTjEFyl25F2',
  'Priya Sharma',
  'seller',
  '560103',
  'en-US'
)
ON CONFLICT ("email") DO UPDATE
SET "display_name" = EXCLUDED."display_name",
    "role" = EXCLUDED."role",
    "default_pincode" = COALESCE("users"."default_pincode", EXCLUDED."default_pincode");
--> statement-breakpoint
INSERT INTO "sellers" (
  "slug",
  "display_name",
  "logo_url",
  "owner_user_id",
  "rating"
)
SELECT
  'priya-studio',
  'Priya Studio',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
  "id",
  4.3
FROM "users"
WHERE "email" = 'seller2@demo.test'
ON CONFLICT ("slug") DO UPDATE
SET "display_name" = EXCLUDED."display_name",
    "logo_url" = EXCLUDED."logo_url",
    "owner_user_id" = EXCLUDED."owner_user_id",
    "rating" = EXCLUDED."rating";
