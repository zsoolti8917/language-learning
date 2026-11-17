// Performance checks (I4): the first load budget of the build under test, long content kept
// out of the DOM (the reader's virtualised text, the deck's pages), and start up time on a
// slowed down phone profile (4x slower CPU, a slow mobile network), cold and from the cache.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, onboard } from '../src/fixtures';
import { learnWords, swControls, test } from './support';

/** docs/architecture.md, "Limits and checks": at most 200 KB of compressed JavaScript. */
const BUDGET_BYTES = 200 * 1024;

/** The JS files of the first load: the HTML entry and its static imports (as size-budget.mjs). */
function firstLoadFiles(manifest: Record<string, { file: string; imports?: string[] }>) {
  const seen = new Set<string>();
  const files: string[] = [];
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`manifest has no entry "${key}"`);
    if (chunk.file.endsWith('.js')) files.push(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  visit('index.html');
  return files;
}

test('the first load of the served build stays within the size budget', () => {
  const dist = process.env.E2E_DIST_DIR;
  test.skip(!dist, 'run through `pnpm e2e:offline`, which names the build folder');
  const manifest = JSON.parse(readFileSync(join(dist as string, '.vite/manifest.json'), 'utf8'));
  const files = firstLoadFiles(manifest);
  const total = files.reduce(
    (n, f) => n + gzipSync(readFileSync(join(dist as string, f)), { level: 9 }).length,
    0,
  );
  test.info().annotations.push({
    type: 'first load',
    description: `${(total / 1024).toFixed(1)} KB gzip of ${BUDGET_BYTES / 1024} KB`,
  });
  expect(total).toBeLessThanOrEqual(BUDGET_BYTES);
});

test('a long text keeps only the part near the screen in the DOM', async ({ page, api }) => {
  await onboard(api);
  const sentences = 400;
  const body = Array.from({ length: sentences / 2 }, () => 'Mám rád kávu. Dnes idem do kina.').join(
    ' ',
  );
  await page.goto('/read/import');
  await page.getByLabel('Title (optional)').fill('Dlhý text');
  await page.getByLabel('Slovak text').fill(body);
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Dlhý text', level: 2 })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.locator('[data-sentence="0"]')).toBeVisible();

  // 400 sentences hold about 2,600 words and stops; the reader keeps at most 16 chunks of about
  // 40 tokens each (VirtualText) in the DOM.
  const rendered = () => page.locator('[data-sentence]').count();
  const tokens = () => page.locator('[data-token]').count();
  const atTop = await rendered();
  expect(atTop).toBeGreaterThan(0);
  expect(atTop).toBeLessThan(sentences / 2);
  expect(await tokens()).toBeLessThanOrEqual(16 * 48);

  // Scrolling to the end brings the last sentence in and leaves the first ones out.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        return page.locator(`[data-sentence="${sentences - 1}"]`).count();
      },
      { timeout: 30_000 },
    )
    .toBe(1);
  await expect(page.locator('[data-sentence="0"]')).toHaveCount(0);
  expect(await rendered()).toBeLessThan(sentences / 2);
  expect(await tokens()).toBeLessThanOrEqual(16 * 48);
});

test('the deck renders a long list one page at a time', async ({ page, api }) => {
  await onboard(api);
  await learnWords(api, 60);
  await page.goto('/deck');
  const list = page.getByRole('list', { name: 'Deck' });
  await expect(list.getByRole('link')).toHaveCount(50);
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(list.getByRole('link')).toHaveCount(60);
});

test('start up on a slowed down phone profile, cold and from the cache', async ({ page, api }) => {
  await onboard(api);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable');
  // A slow mobile connection: 150 ms round trips, 1.6 Mbit/s down, 750 kbit/s up.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  /** Milliseconds from navigation start until Today shows its heading. */
  const startUp = async () => {
    await page.goto('/', { waitUntil: 'commit' });
    await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible({
      timeout: 90_000,
    });
    return page.evaluate(() => Math.round(performance.now()));
  };

  const cold = await startUp();
  await swControls(page);
  const warm = await startUp();
  test
    .info()
    .annotations.push({ type: 'start up', description: `cold ${cold} ms, warm ${warm} ms` });
  // Generous limits: the machines that run this are busy; a regression of several seconds
  // still fails.
  expect(cold).toBeLessThan(20_000);
  expect(warm).toBeLessThan(12_000);
});
