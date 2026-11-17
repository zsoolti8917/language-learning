// Playwright for the design system gallery only (F7). Run: pnpm --filter @app/web test:ui
// Kept apart from the app's own browser tests (F6) and from e2e/ (I1).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's
// own browser is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = 5179;

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
  // One project per theme: the page is forced to it and the system scheme matches.
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: `vite --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}/gallery.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
