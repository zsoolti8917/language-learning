// `pnpm e2e`: the browser flows against the real API in local mode.
//   pnpm e2e                         every flow
//   pnpm e2e -- --repeat-each=3      every flow three times
//   pnpm e2e -- flows/review         one file (any Playwright argument works)
//   pnpm e2e:offline                 the offline, sync and install suite (I4): E2E_CONFIG
//                                    names another config, relative to e2e/
// Each run gets two free ports (API and web) and a build folder of its own, passed through
// E2E_API_PORT, E2E_WEB_PORT and E2E_DIST_DIR, so parallel runs and other checkouts never
// collide (the same approach as apps/web/scripts/e2e-all.mjs).
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

const argv = process.argv.slice(2).filter((a) => a !== '--');
const apiPort = await freePort();
let webPort = await freePort();
while (webPort === apiPort) webPort = await freePort();

const runDir = join(e2eRoot, 'node_modules', '.cache', 'e2e', `run-${process.pid}`);
mkdirSync(runDir, { recursive: true });
const env = {
  ...process.env,
  E2E_API_PORT: String(apiPort),
  E2E_WEB_PORT: String(webPort),
  E2E_DIST_DIR: process.env.E2E_DIST_DIR ?? join(runDir, 'dist'),
};
console.log(`e2e: api on ${apiPort}, web on ${webPort}, build in ${env.E2E_DIST_DIR}`);
const run = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', process.env.E2E_CONFIG ?? 'playwright.config.ts', ...argv],
  {
    cwd: e2eRoot,
    env,
    stdio: 'inherit',
  },
);
if (!process.env.E2E_KEEP) rmSync(runDir, { recursive: true, force: true });
process.exit(run.status ?? 1);
