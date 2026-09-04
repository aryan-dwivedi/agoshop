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
});
export type DbEnv = z.infer<typeof schema>;
export const env: DbEnv = schema.parse(process.env);
