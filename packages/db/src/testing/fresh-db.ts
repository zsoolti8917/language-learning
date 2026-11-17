// For this package's own tests: an in-memory PGlite with the migrations applied.
// Other packages use createTestDb from @app/testkit.
import { createDb, type Database } from '../client';
import { migrate } from '../migrate';

export async function freshDb(): Promise<Database> {
  const database = createDb({ mode: 'pglite' });
  await migrate(database);
  return database;
}

export const USER_A = '0190a000-0000-7000-8000-00000000000a';
export const USER_B = '0190b000-0000-7000-8000-00000000000b';
