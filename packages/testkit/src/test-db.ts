// createTestDb: a real Postgres (PGlite) inside the test process, with the auth stub,
// every migration and, on request, a content set loaded.
import { fileURLToPath } from 'node:url';
import { createDb, type Database, type LoadResult, loadContent, migrate } from '@app/db';
import { sql } from 'drizzle-orm';
import { createFactories, type Factories } from './factories';

/** The folder of the mini Slovak dataset, which package F9 fills. */
export const MINI_CONTENT_DIR = fileURLToPath(new URL('../mini', import.meta.url));

export interface TestDbOptions {
  /**
   * A content set to load: a folder of content files, or `'mini'` for the mini Slovak
   * dataset. Omitted: schema `ling` stays empty.
   */
  content?: 'mini' | (string & {});
}

export interface TestDb extends Database {
  /** Factories for every table of schema `app`. */
  factory: Factories;
  /** The result of the content load, or null when no content was asked for. */
  content: LoadResult | null;
  /** Removes every learner row (all of schema `app`), so tests can share one database. */
  resetApp(): Promise<void>;
}

/**
 * Starts an in-memory PGlite, installs the role `authenticated` and `auth.uid()`, applies
 * every migration and loads the content. Close it in `afterAll`. Starting one takes
 * about two seconds, so share one per test file.
 */
export async function createTestDb(opts: TestDbOptions = {}): Promise<TestDb> {
  const database = createDb({ mode: 'pglite' });
  try {
    await migrate(database, { authStub: true });
    const folder = opts.content === 'mini' ? MINI_CONTENT_DIR : opts.content;
    const content = folder ? await loadContent(database.db, folder) : null;
    return {
      ...database,
      factory: createFactories(database.db),
      content,
      resetApp: async () => {
        // Every app table cascades from profile.
        await database.db.execute(sql`truncate app.profile cascade`);
      },
    };
  } catch (e) {
    await database.close();
    throw e;
  }
}
