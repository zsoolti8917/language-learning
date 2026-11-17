// The plain Node entry. `pnpm dev` runs it with `--local`: PGlite in .local/pgdata, the dev
// login and the mock gateway. Without `--local` it reads every variable from the environment.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serve } from '@hono/node-server';
import { LOCAL_DEFAULTS } from './platform/config';
import { createRuntime, type Runtime } from './runtime';

/** `<repo>/.local/pgdata`; deleting the folder resets the local database. */
export const LOCAL_PGDATA = fileURLToPath(new URL('../../../.local/pgdata', import.meta.url));

/** The variables of local mode; values already set in `env` win. */
export function localEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...LOCAL_DEFAULTS, PGLITE_DIR: LOCAL_PGDATA, ...env };
}

export interface RunningServer {
  runtime: Runtime;
  url: string;
  close(): Promise<void>;
}

/** Builds the runtime and listens on `port` (default from PORT, 8787; 0 picks a free one). */
export async function startServer(
  env: Record<string, string | undefined>,
  port?: number,
): Promise<RunningServer> {
  const runtime = await createRuntime(env);
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: runtime.app.fetch, port: port ?? runtime.config.port }, () =>
      resolve(s),
    );
  });
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : (port ?? runtime.config.port);
  return {
    runtime,
    url: `http://localhost:${actual}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
    },
  };
}

async function main(): Promise<void> {
  const local = process.argv.includes('--local');
  const env = local ? localEnv(process.env) : process.env;
  try {
    const running = await startServer(env);
    const c = running.runtime.config;
    console.log(
      `API on ${running.url}/api/v1 (APP_ENV=${c.appEnv}, DB_MODE=${c.dbMode}, AUTH_MODE=${c.authMode}, AI_MODE=${c.aiMode})`,
    );
    const stop = () => {
      running.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (e) {
    console.error(`API did not start: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
