// Applies the SQL migrations in packages/db/drizzle. The same files run on Supabase and
// on PGlite; outside Supabase the auth stub has to be installed first.
import { fileURLToPath } from 'node:url';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import { AUTH_STUB_SQL } from './auth-stub';
import type { Database } from './client';

/** Absolute path of the migrations folder. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

export interface MigrateOptions {
  /**
   * Install the role `authenticated` and `auth.uid()` before migrating.
   * Default: true in pglite mode, false in postgres mode (Supabase has both).
   */
  authStub?: boolean;
}

/** Installs the stand in for Supabase Auth: role `authenticated` and `auth.uid()`. */
export async function installAuthStub(database: Database): Promise<void> {
  await database.exec(AUTH_STUB_SQL);
}

export async function migrate(database: Database, opts: MigrateOptions = {}): Promise<void> {
  const stub = opts.authStub ?? database.mode === 'pglite';
  if (stub) await installAuthStub(database);
  const config = { migrationsFolder: MIGRATIONS_FOLDER };
  if (database.mode === 'pglite')
    await migratePglite(database.db as unknown as PgliteDatabase<Record<string, unknown>>, config);
  else
    await migratePostgres(
      database.db as unknown as PostgresJsDatabase<Record<string, unknown>>,
      config,
    );
}
