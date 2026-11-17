// Runs every browser suite of the web app, one after another:
//   pnpm --filter @app/web e2e:all            all suites
//   pnpm --filter @app/web e2e:all reader tutor   only those (names below)
// Each suite gets free ports and a build folder of its own (under node_modules/.cache/e2e),
// passed through E2E_PORT / E2E_DIST_DIR (and the shell's E2E_MOCK_* / E2E_PWA_*), so suites
// never share a dist folder and never test a server another checkout left on a fixed port.
// Extra Playwright arguments go after `--`: `e2e:all reader -- --retries=1`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** name → Playwright config (relative to apps/web) and which variables it reads. */
const SUITES = [
  { name: 'shell', config: 'e2e-app/playwright.config.ts', kind: 'shell' },
  { name: 'gallery', config: 'e2e-ui/playwright.config.ts', kind: 'dev' },
  { name: 'account', config: 'src/features/account/e2e/playwright.config.ts', kind: 'build' },
  { name: 'review', config: 'src/features/review/e2e/playwright.config.ts', kind: 'build' },
  { name: 'reader', config: 'src/features/reader/e2e/playwright.config.ts', kind: 'build' },
  { name: 'cases', config: 'src/features/cases/e2e/playwright.config.ts', kind: 'build' },
  { name: 'words', config: 'src/features/words/e2e/playwright.config.ts', kind: 'build' },
  { name: 'tutor', config: 'src/features/tutor/e2e/playwright.config.ts', kind: 'dev' },
];

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

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
// pnpm may drop the `--`; anything that starts with "-" goes to Playwright either way.
const head = dash === -1 ? argv : argv.slice(0, dash);
const names = head.filter((a) => !a.startsWith('-'));
const extra = [
  ...head.filter((a) => a.startsWith('-')),
  ...(dash === -1 ? [] : argv.slice(dash + 1)),
];
const unknown = names.filter((n) => !SUITES.some((s) => s.name === n));
if (unknown.length) {
  console.error(
    `Unknown suite(s): ${unknown.join(', ')}. Known: ${SUITES.map((s) => s.name).join(', ')}`,
  );
  process.exit(2);
}
const chosen = names.length ? SUITES.filter((s) => names.includes(s.name)) : SUITES;

const cache = join('node_modules', '.cache', 'e2e');
const results = [];
for (const suite of chosen) {
  if (!existsSync(join(webRoot, suite.config))) {
    results.push({ name: suite.name, status: 'missing' });
    continue;
  }
  const env = { ...process.env };
  if (suite.kind === 'shell') {
    env.E2E_MOCK_PORT = String(await freePort());
    env.E2E_PWA_PORT = String(await freePort());
    env.E2E_MOCK_DIST_DIR = join(cache, suite.name, 'mock');
    env.E2E_PWA_DIST_DIR = join(cache, suite.name, 'pwa');
  } else {
    env.E2E_PORT = String(await freePort());
    if (suite.kind === 'build') env.E2E_DIST_DIR = join(cache, suite.name, 'dist');
  }
  mkdirSync(join(webRoot, cache, suite.name), { recursive: true });
  console.log(`\n=== ${suite.name} (${suite.config})`);
  const started = Date.now();
  const run = spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', suite.config, ...extra], {
    cwd: webRoot,
    env,
    stdio: 'inherit',
  });
  results.push({
    name: suite.name,
    status: run.status === 0 ? 'passed' : 'failed',
    seconds: Math.round((Date.now() - started) / 1000),
  });
}

console.log('\n=== e2e:all');
for (const r of results) {
  console.log(
    `${r.status.padEnd(8)} ${r.name}${r.seconds !== undefined ? ` (${r.seconds} s)` : ''}`,
  );
}
process.exit(results.every((r) => r.status === 'passed') ? 0 : 1);
