// createDb: one database handle for both run modes, with the two transaction helpers.
import { PGlite } from '@electric-sql/pglite';
import { type ExtractTablesWithRelations, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
type Relations = ExtractTablesWithRelations<Schema>;
/** A Drizzle database over either driver, typed with the full schema. */
export type Db = PgDatabase<PgQueryResultHKT, Schema, Relations>;
/** An open transaction. Services take it and never open their own. */
export type Tx = PgTransaction<PgQueryResultHKT, Schema, Relations>;
/** Something queries can run on: the database itself or a transaction. */
export type Queryable = Db | Tx;

export type DbConfig =
  | {
      mode: 'pglite';
      /** Folder for the data files, e.g. `.local/pgdata`. Omitted: in memory. */
      dataDir?: string;
      /** An existing PGlite instance to wrap instead of creating one. */
      client?: PGlite;
    }
  | {
      mode: 'postgres';
      /** Connection string. On Supabase, the transaction pooler (port 6543). */
      url: string;
      /** Pool size; default 5. */
      max?: number;
    };

export interface Database {
  readonly mode: DbConfig['mode'];
  /** The Drizzle handle. It runs as the login role (`app_api` in production). */
  readonly db: Db;
  /**
   * Runs `fn` in a transaction as the learner: `set local role authenticated` and the
   * request claim `{ sub: userId, role: 'authenticated' }`. Row level security applies.
   */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Runs `fn` in a transaction as `app_api`: reads reference data and stores glosses,
   * and holds no rights on schema `app`.
   */
  withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Raw multi statement SQL without parameters, as the login role. */
  exec(statements: string): Promise<void>;
  close(): Promise<void>;
  /** The PGlite instance in pglite mode, else null. */
  readonly pglite: PGlite | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The role `withSystem` switches to. */
export const SYSTEM_ROLE = 'app_api';
/** The role `withUser` switches to. */
export const USER_ROLE = 'authenticated';

export function createDb(config: DbConfig): Database {
  if (config.mode === 'pglite') {
    const client = config.client ?? new PGlite(config.dataDir);
    const db = drizzlePglite({ client, schema }) as unknown as Db;
    return wrap('pglite', db, {
      exec: async (s) => {
        await client.exec(s);
      },
      close: () => client.close(),
      pglite: client,
    });
  }
  const client = postgres(config.url, {
    max: config.max ?? 5,
    // The Supabase transaction pooler cannot keep prepared statements.
    prepare: false,
    onnotice: () => {},
  });
  const db = drizzlePostgres({ client, schema }) as unknown as Db;
  return wrap('postgres', db, {
    exec: async (s) => {
      await client.unsafe(s).simple();
    },
    close: () => client.end(),
    pglite: null,
  });
}

function wrap(
  mode: DbConfig['mode'],
  db: Db,
  io: { exec(s: string): Promise<void>; close(): Promise<void>; pglite: PGlite | null },
): Database {
  return {
    mode,
    db,
    pglite: io.pglite,
    exec: io.exec,
    close: io.close,
    withUser: (userId, fn) => withUser(db, userId, fn),
    withSystem: (fn) => withSystem(db, fn),
  };
}

/** `withUser` on a bare Drizzle handle. */
export function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error(`withUser: not a uuid: ${userId}`);
  const claims = JSON.stringify({ sub: userId.toLowerCase(), role: USER_ROLE });
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${USER_ROLE}`));
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    return fn(tx);
  });
}

/** `withSystem` on a bare Drizzle handle. */
export function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`set local role ${SYSTEM_ROLE}`));
    return fn(tx);
  });
}

/**
 * The rows of a raw `execute()` result. PGlite returns `{ rows }`, postgres.js an array.
 */
export async function queryRows<T = Record<string, unknown>>(
  q: Queryable,
  query: Parameters<Db['execute']>[0],
): Promise<T[]> {
  const res = (await q.execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
