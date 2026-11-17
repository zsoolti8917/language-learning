// The offline, sync and install suite (I4): the same two servers as the flows (the real client
// build with its service worker, the real API in local mode), other tests. Run it with
// `pnpm e2e:offline` (e2e/scripts/run.mjs with E2E_CONFIG), which picks free ports.
import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

// Inside the flows' (ignored) results folder, apart from theirs.
const OUTPUT = process.env.E2E_OUTPUT_DIR ?? `${base.outputDir}/offline`;

export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: OUTPUT,
});
