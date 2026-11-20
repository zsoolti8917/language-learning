// `pnpm run vercel-build`: builds the whole deploy in Vercel's Build Output API format
// (https://vercel.com/docs/build-output-api), so Vercel needs no framework detection:
//   .vercel/output/static            the client (apps/web/dist)
//   .vercel/output/functions/api.func the API as one bundled Node 24 function in fra1
//   .vercel/output/config.json        /api/* to the function, everything else to the app
// The VITE_* variables must be set in Vercel before the build; they are baked into the page.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, '.vercel/output');
const FUNC = join(OUT, 'functions/api.func');

const json = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

rmSync(OUT, { recursive: true, force: true });

// 1. The client.
execSync('pnpm --filter @app/web run build', { cwd: ROOT, stdio: 'inherit' });
mkdirSync(join(OUT, 'static'), { recursive: true });
cpSync(join(ROOT, 'apps/web/dist'), join(OUT, 'static'), { recursive: true });

// 2. The API: one ESM file with every workspace package inlined.
mkdirSync(FUNC, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'apps/api/src/vercel-node.ts')],
  outfile: join(FUNC, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: 'linked',
  logLevel: 'info',
  // Some dependencies are CommonJS and call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
json(join(FUNC, 'package.json'), { type: 'module' });
json(join(FUNC, '.vc-config.json'), {
  runtime: 'nodejs24.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  maxDuration: 300,
  regions: ['fra1'],
});

// 3. Routing: the API, then real files, then the app shell for client side routes.
json(join(OUT, 'config.json'), {
  version: 3,
  routes: [
    { src: '^/api/(.*)$', dest: '/api' },
    {
      src: '^/(sw\\.js|registerSW\\.js|manifest\\.webmanifest)$',
      headers: { 'cache-control': 'public, max-age=0, must-revalidate' },
      continue: true,
    },
    {
      src: '^/assets/(.*)$',
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
      continue: true,
    },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
});

console.log('Vercel output written to .vercel/output');
