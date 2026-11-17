// Local mode's database: migrations, then a content set (the mini Slovak dataset unless
// CONTENT_DIR names another folder). It lives under testing/ because only test code may
// import @app/testkit, and local mode is a stand in for the cloud.
import { type Database, type LoadResult, loadContent, migrate } from '@app/db';
import { MINI_DIR } from '@app/testkit/mini';

export const LOCAL_CONTENT_DIR = MINI_DIR;

/** Applies every migration and loads the content; both are safe to repeat. */
export async function prepareLocalDatabase(
  database: Database,
  contentDir: string = MINI_DIR,
): Promise<LoadResult> {
  await migrate(database);
  return loadContent(database, contentDir);
}
