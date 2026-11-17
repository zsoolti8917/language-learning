// Playwright for the reader (M3), against a mock build at 390 x 844.
// Run from apps/web: pnpm exec playwright test -c src/features/reader/e2e/playwright.config.ts
// It builds its own copy (into the ignored .local/ folder at the repository root) and serves
// it on its own port, so it never reuses a server of another checkout.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const CLOUD_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ?? (existsSync(CLOUD_CHROMIUM) ? CLOUD_CHROMIUM : undefined);

const PORT = Number(process.env.E2E_PORT ?? process.env.READER_E2E_PORT ?? 5191);
const WEB_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const OUT_DIR = process.env.E2E_DIST_DIR ?? '../../.local/web-reader-e2e';

// E2E_PORT and E2E_DIST_DIR (set by scripts/e2e-all.mjs) override the port and the build
// folder; a server already on the port is never reused (it may be another checkout's).
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  outputDir: '../../../../test-results/reader-e2e',
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
    command: `vite build --mode mock --outDir ${OUT_DIR} --emptyOutDir --logLevel warn && vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
    cwd: WEB_ROOT,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
