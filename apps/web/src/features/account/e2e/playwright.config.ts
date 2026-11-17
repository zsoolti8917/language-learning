// Playwright for M1 (account and Today) at 390 x 844 against the mock server.
// Run: pnpm --filter @app/web exec playwright test -c src/features/account/e2e/playwright.config.ts
// F6's config (e2e-app) matches only its own files, so M1 keeps its config in its own folder,
// following the same pattern: a mock build served by `vite preview`.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = Number(process.env.E2E_PORT ?? process.env.M1_E2E_PORT ?? 5191);
const DIST = process.env.E2E_DIST_DIR ?? 'dist/e2e-m1';
const webRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const features = fileURLToPath(new URL('../..', import.meta.url));

// E2E_PORT and E2E_DIST_DIR (set by scripts/e2e-all.mjs) override the port and the build
// folder; a server already on the port is never reused (it may be another checkout's).
export default defineConfig({
  testDir: features,
  testMatch: ['**/account/e2e/*.e2e.ts', '**/today/e2e/*.e2e.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: `${webRoot}test-results/m1`,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    browserName: 'chromium',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: `vite build --mode mock --outDir ${DIST} --logLevel warn && vite preview --outDir ${DIST} --port ${PORT} --strictPort`,
    cwd: webRoot,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
