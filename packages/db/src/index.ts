// @app/db: tables, migrations, transactions, content loader (package F3).
export { AUTH_STUB_SQL } from './auth-stub';
export {
  createDb,
  type Database,
  type Db,
  type DbConfig,
  type Queryable,
  queryRows,
  type Schema,
  SYSTEM_ROLE,
  type Tx,
  USER_ROLE,
  withSystem,
  withUser,
} from './client';
export {
  ContentValidationError,
  currentContentVersion,
  type LoadResult,
  loadContent,
  validateContent,
} from './content/load';
export { installAuthStub, MIGRATIONS_FOLDER, type MigrateOptions, migrate } from './migrate';
export * from './schema';
export * as schema from './schema';
