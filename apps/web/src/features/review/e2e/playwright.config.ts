// Playwright for the review feature (M2): the offline session at 390 x 844 against the mock
// server. Run: pnpm --filter @app/web exec playwright test -c src/features/review/e2e/playwright.config.ts
// It follows apps/web/e2e-app/playwright.config.ts (F6) and lives in the feature's own folder.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

// A port of its own: other features run their own preview servers at the same time.
const PORT = 5297;
const webRoot = fileURLToPath(new URL('../../../..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
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
    command: `vite build --mode mock --outDir dist-mock --logLevel warn && vite preview --outDir dist-mock --port ${PORT} --strictPort`,
    cwd: webRoot,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
