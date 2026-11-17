// Builds the whole API from the server variables: config (with its start up guards),
// database, container and app. Both entries use it: server.ts (plain Node) and vercel.ts.
import { mkdirSync } from 'node:fs';
import { createDb, type Database } from '@app/db';
import { type App, createApp } from './app';
import { createContainer } from './container';
import { type Config, loadConfig } from './platform/config';
import type { AppDeps } from './platform/deps';
import { assertRealPorts, type PortKind } from './platform/stand-in';

export interface Runtime {
  config: Config;
  database: Database;
  deps: AppDeps;
  app: App;
  /** What each port resolves to; checked at start up (only the gateway may be a mock). */
  ports: Record<string, PortKind>;
  /** Waits for background work, then closes the database. */
  close(): Promise<void>;
}

export async function createRuntime(env: Record<string, string | undefined>): Promise<Runtime> {
  // The guards run first: nothing starts with the dev login or the mock in production.
  const config = loadConfig(env);
  if (config.dbMode === 'pglite' && config.pgliteDir)
    mkdirSync(config.pgliteDir, { recursive: true });
  const database =
    config.dbMode === 'pglite'
      ? createDb({ mode: 'pglite', ...(config.pgliteDir ? { dataDir: config.pgliteDir } : {}) })
      : createDb({ mode: 'postgres', url: config.databaseUrl ?? '' });
  try {
    if (config.dbMode === 'pglite') {
      // Loaded only in local mode, so production never reads the test kit at start up.
      const { prepareLocalDatabase } = await import('./testing/local');
      await prepareLocalDatabase(database, env.CONTENT_DIR || undefined);
    }
    const deps = createContainer({ config, database });
    // Every port must be the real one outside tests; only AI_MODE=mock keeps the mock gateway.
    const ports = assertRealPorts(deps, config.aiMode);
    return {
      config,
      database,
      deps,
      app: createApp(deps),
      ports,
      close: async () => {
        await deps.background.drain();
        await database.close();
      },
    };
  } catch (e) {
    await database.close();
    throw e;
  }
}
