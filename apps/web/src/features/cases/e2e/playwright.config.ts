// Playwright for the cases feature (M4), at 390 x 844 against the mock server.
// Run from apps/web:  pnpm exec playwright test -c src/features/cases/e2e/playwright.config.ts
// It follows e2e-app/playwright.config.ts (F6), on a port of its own.
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = Number(process.env.E2E_PORT ?? 5191);
const DIST = process.env.E2E_DIST_DIR ?? 'dist-mock';

// E2E_PORT and E2E_DIST_DIR (set by scripts/e2e-all.mjs) override the port and the build
// folder; a server already on the port is never reused (it may be another checkout's).
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
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
    cwd: '../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
