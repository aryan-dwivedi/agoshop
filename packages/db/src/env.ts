import { z } from 'zod';

const int = (fallback: number) =>
    z
        .string()
        .default(String(fallback))
        .transform((v) => Number.parseInt(v, 10))
        .pipe(z.number().int());
const schema = z.object({
    DATABASE_URL: z.string().min(1),
    PG_POOL_MAX: int(20),
    PG_STATEMENT_TIMEOUT_MS: int(15000),
    // Render free Postgres hibernates; waking it can take longer than the pg default.
    PG_CONNECTION_TIMEOUT_MS: int(5000),
});
export type DbEnv = z.infer<typeof schema>;
export const env: DbEnv = schema.parse(process.env);
