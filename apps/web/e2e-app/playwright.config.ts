// Playwright for the app shell (F6). Run: pnpm --filter @app/web e2e
// Two built copies of the app, each served by `vite preview`:
//   mock  (port 5181, E2E_MOCK_PORT): VITE_MOCK_API=true, every route against the mock server
//   pwa   (port 5182, E2E_PWA_PORT): the production build, for install and offline checks
// Kept apart from the design system gallery (e2e-ui, F7) and the full stack tests (e2e/, I1).
import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// The cloud containers ship a Chromium at /opt/pw-browsers/chromium (never run
// "playwright install" there). PW_CHROMIUM_PATH overrides; elsewhere Playwright's own is used.
const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

// Ports and build folders: E2E_MOCK_PORT, E2E_PWA_PORT, E2E_MOCK_DIST_DIR, E2E_PWA_DIST_DIR
// (scripts/e2e-all.mjs sets them). A server already on a port is never reused: it may belong
// to another checkout, and testing its build would prove nothing about this one.
const MOCK_PORT = Number(process.env.E2E_MOCK_PORT ?? 5181);
const PWA_PORT = Number(process.env.E2E_PWA_PORT ?? 5182);
const MOCK_DIST = process.env.E2E_MOCK_DIST_DIR ?? 'dist-mock';
const PWA_DIST = process.env.E2E_PWA_DIST_DIR ?? 'dist';

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
      command: `vite build --mode mock --outDir ${MOCK_DIST} --logLevel warn && vite preview --outDir ${MOCK_DIST} --port ${MOCK_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${MOCK_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `vite build --outDir ${PWA_DIST} --logLevel warn && vite preview --outDir ${PWA_DIST} --port ${PWA_PORT} --strictPort`,
      cwd: '..',
      url: `http://localhost:${PWA_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
