import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { db, pool } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR ?? join(here, '../../drizzle');
const extraSqlPath = process.env.EXTRA_SQL_PATH ?? join(here, 'extra.sql');
const run = async (): Promise<void> => {
    await migrate(db, { migrationsFolder });
    const extra = readFileSync(extraSqlPath, 'utf8');
    for (const statement of extra.split(';')) {
        const ddl = statement
            .split('\n')
            .filter((line) => !line.trim().startsWith('--'))
            .join('\n')
            .trim();
        if (ddl.length > 0) await db.execute(sql.raw(ddl));
    }
    const { rows } = await pool.query(`select
       (select count(*)::int from information_schema.tables where table_schema = 'public') as tables,
       (select count(*)::int from pg_indexes where indexname in ('products_search_idx','transcripts_fts_idx')) as fts_indexes,
       (select count(*)::int from pg_sequences where sequencename = 'agora_uid_seq') as uid_sequence`);
    const { tables, fts_indexes, uid_sequence } = rows[0];
    if (fts_indexes !== 2 || uid_sequence !== 1) {
        throw new Error(
            `extra.sql did not fully apply: fts_indexes=${fts_indexes}/2 uid_sequence=${uid_sequence}/1`,
        );
    }
    console.log(
        `schema applied — ${tables} tables, ${fts_indexes} FTS indexes, agora_uid_seq present`,
    );
};
run()
    .then(() => pool.end())
    .catch(async (err) => {
        console.error(err);
        await pool.end();
        process.exit(1);
    });
