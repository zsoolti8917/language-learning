// `pnpm db:migrate` and `pnpm db:load <folder>`.
//   DB_MODE=postgres (default) DATABASE_URL=<direct connection, as the owner role>
//   DB_MODE=pglite            PGLITE_DATA_DIR=<folder>, default <repo>/.local/pgdata
// Migrations run from CI or by hand through a direct connection, never from the API.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, type Database, loadContent, migrate } from '../src/index';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

function open(): Database {
  if (process.env.DB_MODE === 'pglite')
    return createDb({
      mode: 'pglite',
      dataDir: process.env.PGLITE_DATA_DIR ?? resolve(REPO, '.local/pgdata'),
    });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (or set DB_MODE=pglite)');
  return createDb({ mode: 'postgres', url, max: 1 });
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  const database = open();
  try {
    if (command === 'migrate') {
      await migrate(database, {
        authStub: database.mode === 'pglite' || !!process.env.DB_AUTH_STUB,
      });
      console.log(`migrations applied (${database.mode})`);
    } else if (command === 'load') {
      if (!arg) throw new Error('usage: db:load <content folder>');
      const r = await loadContent(database, resolve(process.env.INIT_CWD ?? process.cwd(), arg));
      console.log(`content ${r.version} loaded`, r.rows, r.versionWritten ? '' : '(unchanged)');
    } else throw new Error(`unknown command: ${command ?? '(none)'}`);
  } finally {
    await database.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
