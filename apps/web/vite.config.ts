/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { msw } from 'msw/vite';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Client variables live in the repository root .env (see .env.example).
const envDir = fileURLToPath(new URL('../..', import.meta.url));

/** The web package version, plus the short git sha when git is at hand: `0.0.0+abc1234`. */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  // Vercel builds without a .git folder but names the commit.
  const ci = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  if (ci) return `${pkg.version}+${ci}`;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    })
      .toString()
      .trim();
    return sha ? `${pkg.version}+${sha}` : pkg.version;
  } catch {
    return pkg.version;
  }
}

export default defineConfig(({ mode }) => {
  // About (features/today) shows it. A value set in the environment wins.
  process.env.VITE_APP_VERSION ||= appVersion();
  // `--mode mock` (dev or build) is the same as VITE_MOCK_API=true.
  if (mode === 'mock') process.env.VITE_MOCK_API = 'true';
  const env = loadEnv(mode, envDir, 'VITE_');
  const mockApi = (process.env.VITE_MOCK_API ?? env.VITE_MOCK_API) === 'true';
  return {
    envDir,
    plugins: [
      react(),
      tailwindcss(),
      // Serves (and in a mock build emits) mockServiceWorker.js; the app starts it itself.
      mockApi && msw({ mode: 'worker-only' }),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        // In mock mode the mock worker owns the scope; the app does not register this one.
        manifest: {
          id: '/',
          name: 'Slovak',
          short_name: 'Slovak',
          description: 'Daily Slovak practice: reviews, reading, cases and a tutor.',
          lang: 'en',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#f6f6f4',
          theme_color: '#f6f6f4',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
        workbox: {
          // The app shell only: HTML, scripts, styles, icons. API data is the app's own job.
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          globIgnores: ['**/mockServiceWorker.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/gallery/],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    server: {
      proxy: {
        // The local API (F5). API_URL overrides the address.
        '/api': process.env.API_URL ?? 'http://localhost:8787',
      },
    },
    build: {
      // The size budget check reads it (scripts/size-budget.mjs).
      manifest: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Contract and DB code under test may run longer than the 5 s default on a cold start,
      // and each findBy… may wait 5 s (src/test/setup.ts) on a loaded machine.
      testTimeout: 30_000,
    },
  };
});
