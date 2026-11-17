// Browser tests of the whole app (I1): the real client on the real API in local mode.
// Run with `pnpm e2e` (scripts/run.mjs), which picks free ports and a build folder of its own,
// so parallel runs and other checkouts never collide.
//
// Two servers, both started fresh for every run (a server already on a port is never reused):
//   api  apps/api in local mode: PGlite in memory with the mini dataset, the dev login, the mock
//        gateway with its scripted tutor answers, responses checked against the contracts.
//   web  a production build of apps/web without the mock server, served by `vite preview`,
//        which proxies /api to the api server.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const API_PORT = Number(process.env.E2E_API_PORT ?? 8797);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5197);
const DIST = process.env.E2E_DIST_DIR ?? `${ROOT}e2e/node_modules/.cache/e2e/dist`;
const OUTPUT = process.env.E2E_OUTPUT_DIR ?? `${ROOT}e2e/test-results`;

const API_URL = `http://localhost:${API_PORT}`;

export default defineConfig({
  testDir: './flows',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The machines that run this are often busy: one PGlite connection serves every test, so a
  // few workers are enough, and every wait is generous.
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  outputDir: OUTPUT,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    browserName: 'chromium',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    trace: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: [
    {
      name: 'api',
      command: 'pnpm exec tsx src/server.ts',
      cwd: `${ROOT}apps/api`,
      url: `${API_URL}/api/v1/health`,
      env: {
        APP_ENV: 'local',
        DB_MODE: 'pglite',
        // Empty: PGlite in memory, so every run starts from the mini dataset alone.
        PGLITE_DIR: '',
        AUTH_MODE: 'dev',
        AI_MODE: 'mock',
        VALIDATE_RESPONSES: 'true',
        PORT: String(API_PORT),
      },
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 180_000,
    },
    {
      name: 'web',
      // E2E_SKIP_BUILD=1 serves an existing build of E2E_DIST_DIR (for quick local reruns).
      command: `${process.env.E2E_SKIP_BUILD ? '' : `pnpm exec vite build --outDir ${DIST} --emptyOutDir --logLevel warn && `}pnpm exec vite preview --outDir ${DIST} --port ${WEB_PORT} --strictPort`,
      cwd: `${ROOT}apps/web`,
      url: `http://localhost:${WEB_PORT}/`,
      env: {
        API_URL,
        VITE_MOCK_API: 'false',
        VITE_AUTH_MODE: 'dev',
        VITE_API_BASE: '/api/v1',
      },
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
