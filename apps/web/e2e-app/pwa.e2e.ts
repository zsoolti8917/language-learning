// The production build: installable, and the shell opens offline after one visit.
import { expect, test } from '@playwright/test';
import { en } from '../src/messages/en';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';

test.beforeEach(async ({ context }) => {
  await context.addInitScript((id) => {
    localStorage.setItem(
      'app.devSession',
      JSON.stringify({ userId: id, email: null, accessToken: `dev:${id}`, expiresAt: null }),
    );
  }, DEV_USER);
  // No API runs behind `vite preview`: answer the profile as the API would.
  await context.route('**/api/v1/me', (route) =>
    route.fulfill({
      json: {
        userId: DEV_USER,
        displayName: 'Learner',
        uiLang: 'en',
        explainLang: 'en',
        level: 'A2',
        timezone: 'Europe/Bratislava',
        dayStartHour: 4,
        dailyNewLimit: 10,
        dailyReviewLimit: 80,
        desiredRetention: 0.9,
        strictDiacritics: false,
        wordsBandTarget: 1000,
        settings: { onboardedAt: '2026-11-01T08:00:00.000Z' },
        placementDoneAt: null,
        currentLessonId: null,
        createdAt: '2026-11-01T08:00:00.000Z',
        updatedAt: '2026-11-01T08:00:00.000Z',
      },
    }),
  );
});

test('the manifest makes the app installable', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href as string)).json();
  expect(manifest).toMatchObject({ name: 'Slovak', display: 'standalone', start_url: '/' });
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  // Chromium's own check, as used for the install prompt.
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  // Playwright contexts are incognito, which Chromium reports on its own; nothing else may show.
  const errors = installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito');
  expect(errors).toEqual([]);
});

test('the shell loads offline after one visit', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  // The service worker installs and precaches the shell (every screen chunk included).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: en.tabs.label })).toBeVisible();
  // A screen not opened before also comes from the cache.
  await page.getByRole('link', { name: en.tabs.cases }).click();
  await expect(page.getByRole('heading', { name: en.screens.course, level: 1 })).toBeVisible();
  // A deep link opens from the cached shell.
  await page.goto('/read/import');
  await expect(page.getByRole('heading', { name: en.screens.import, level: 1 })).toBeVisible();
  await context.setOffline(false);
});
