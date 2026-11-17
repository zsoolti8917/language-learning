// Storage on the device (I4): persistent storage is asked for at sign in, a browser that
// refuses the local database gets a clear message (and the app still runs online), and a sign
// out leaves no learner row behind.
import { expect, noSidewaysScroll, onboard } from '../src/fixtures';
import { learnWords, openReview, readStore, type StoreName, test } from './support';

const STORES: StoreName[] = ['kv', 'reviewQueue', 'outbox', 'texts', 'lemmaStatus'];

test('signing in asks the browser to keep the local database', async ({ browser }) => {
  const { baseURL, viewport } = test.info().project.use;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    ...(viewport ? { viewport } : {}),
  });
  try {
    await context.addInitScript(() => {
      const w = window as unknown as { persistCalls: number };
      w.persistCalls = 0;
      const storage = navigator.storage;
      const original = storage.persist.bind(storage);
      storage.persist = () => {
        w.persistCalls++;
        return original();
      };
    });
    const page = await context.newPage();
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
    expect(
      await page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls),
    ).toBe(0);
    // The one tap dev login (local mode).
    await page.getByRole('button', { name: 'Continue as the dev user' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { persistCalls: number }).persistCalls))
      .toBe(1);
  } finally {
    await context.close();
  }
});

test('a browser that refuses the local database gets a clear message', async ({
  page,
  api,
  watch,
}) => {
  await onboard(api);
  // As in a private window that blocks site data: IndexedDB refuses to open.
  await page.addInitScript(() => {
    IDBFactory.prototype.open = () => {
      throw new DOMException('The user denied permission to access the database.', 'SecurityError');
    };
  });
  // Features that read the local database report the failure on the console.
  watch.allow(/SecurityError|DatabaseClosedError|OpenFailedError|denied permission/);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();
  const notice = page.getByRole('alert').filter({ hasText: 'store data on this device' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('nothing works offline');
  await noSidewaysScroll(page);
  // Online screens still work.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Read' }).click();
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await expect(notice).toBeVisible();
});

test('signing out wipes every learner row from the device', async ({ page, api }) => {
  await onboard(api);
  await learnWords(api, 2);
  await openReview(page);
  await expect.poll(async () => (await readStore(page, 'reviewQueue')).length).toBe(2);
  expect((await readStore(page, 'kv')).length).toBeGreaterThan(0);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  for (const store of STORES) {
    await expect
      .poll(async () => (await readStore(page, store)).length, { message: store })
      .toBe(0);
  }
  expect(await page.evaluate(() => localStorage.getItem('app.devSession'))).toBeNull();
});
