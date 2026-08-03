import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { schema } from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

/**
 * The handle Drizzle hands to a `db.transaction(tx => …)` callback.
 *
 * Repository write methods take `tx?: DbTx` and resolve `const invoker = tx ?? this.db`,
 * so the same method works inside and outside a transaction. That keeps the
 * boundary where onion §8 puts it — the SERVICE decides what is atomic, because
 * it is the only layer that knows where one business operation starts and ends.
 *
 * The rule that makes this worth the alias: never call `.transaction()` inside a
 * repository. Two repositories each opening their own gives you two transactions
 * and no atomicity — which reads exactly like the code that works.
 */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Either a pooled connection or an open transaction — anything you can query. */
export type DbInvoker = Db | DbTx;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Create a Drizzle client over postgres-js. Used by the app (one shared handle)
 * and by the Testcontainers harness (per-test handle).
 */
export function createDb(databaseUrl: string, opts?: { max?: number }): DbHandle {
  const sql = postgres(databaseUrl, { max: opts?.max ?? 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
