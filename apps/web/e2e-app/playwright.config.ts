// Playwright for the app shell (F6). Run: pnpm --filter @app/web e2e
// Two built copies of the app, each served by `vite preview`:
//   mock  (port 5181): VITE_MOCK_API=true, every route against the mock server
//   pwa   (port 5182): the production build, for install and offline checks
// Kept apart from the design system gallery (e2e-ui, F7) and the full stack tests (e2e/, I1).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const MOCK_PORT = 5181;
const PWA_PORT = 5182;

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    browserName: 'chromium',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'mock',
      testMatch: 'routes.e2e.ts',
      use: { baseURL: `http://localhost:${MOCK_PORT}` },
    },
    {
      name: 'pwa',
      testMatch: 'pwa.e2e.ts',
      use: { baseURL: `http://localhost:${PWA_PORT}` },
    },
  ],
  webServer: [
    {
      command: `vite build --mode mock --outDir dist-mock --logLevel warn && vite preview --outDir dist-mock --port ${MOCK_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${MOCK_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `vite build --logLevel warn && vite preview --port ${PWA_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${PWA_PORT}/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
