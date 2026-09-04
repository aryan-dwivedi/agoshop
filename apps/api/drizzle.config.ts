import { defineConfig } from 'drizzle-kit';
export default defineConfig({
    schema: '../../packages/db/src/schema.ts',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/live_commerce' },
    strict: false,
    verbose: true,
});
