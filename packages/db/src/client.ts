import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { env } from './env.js';
import * as schema from './schema.js';

export const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.PG_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // A runaway query otherwise holds its connection until the client gives up, starving
    // the pool and turning one slow statement into pool-wide connection timeouts.
    statement_timeout: env.PG_STATEMENT_TIMEOUT_MS,
});
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };
