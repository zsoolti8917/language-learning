// Playwright for the tutor chat (M6), against the mock server at 390 x 844.
// Run: pnpm --filter @app/web exec playwright test -c src/features/tutor/e2e/playwright.config.ts
// The dev server in mock mode serves the app; the tutor's scripted mock stream (../mocks.ts)
// plays the conversation. Same browser settings as e2e-app (F6).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = 5183;
const WEB_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  // Kept out of the source tree (node_modules is ignored by git and Biome).
  outputDir: `${WEB_ROOT}node_modules/.cache/tutor-e2e-results`,
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
    command: `vite --mode mock --port ${PORT} --strictPort`,
    cwd: WEB_ROOT,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
