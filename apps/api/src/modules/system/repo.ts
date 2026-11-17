// SQL of the system module. Owner: F5.
import { currentContentVersion, type Database } from '@app/db';

/** The version of the content set loaded last, or null before any load. */
export async function contentVersion(database: Database): Promise<string | null> {
  const v = await currentContentVersion(database.db);
  return v?.version ?? null;
}
