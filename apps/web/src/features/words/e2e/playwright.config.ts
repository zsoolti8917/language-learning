// Playwright for the words track and the placement check (M5), at 390 x 844 against the mock
// server. Run from apps/web:
//   pnpm exec playwright test -c src/features/words/e2e/playwright.config.ts
// It builds the app in mock mode into dist/m5-mock and serves it with `vite preview` on 5185,
// apart from the shell's own projects (e2e-app, ports 5181 and 5182).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = 5185;

export default defineConfig({
  // Both feature folders: features/words/e2e and features/placement/e2e.
  testDir: '../..',
  testMatch: /(words|placement)\/e2e\/.*\.e2e\.ts$/,
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
    command: `vite build --mode mock --outDir dist/m5-mock --logLevel warn && vite preview --outDir dist/m5-mock --port ${PORT} --strictPort`,
    cwd: '../../../..',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
