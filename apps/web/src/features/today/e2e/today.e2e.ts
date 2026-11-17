// Today in its three mock variants, settings and about, at 390 x 844 on the mock server.
import { expect, test } from '@playwright/test';
import { en } from '../../../messages/en';
import {
  FRESH_PROFILE,
  noSidewaysScroll,
  seed,
  signIn,
  watchErrors,
} from '../../account/e2e/helpers';
import { m } from '../messages';

const VARIANTS = [
  {
    name: 'fresh',
    profile: { ...FRESH_PROFILE, settings: { onboardedAt: '2026-11-17T08:00:00.000Z' } },
    visible: [m.t('today.firstRunTitle'), m.t('today.reviewsNone')],
    hidden: [m.t('today.doneTitle'), m.t('today.reviewsStart')],
  },
  {
    name: 'middle',
    profile: null,
    visible: ['12 due', m.t('today.readTitle'), m.t('today.weakTitle'), m.t('today.tutorTitle')],
    hidden: [m.t('today.firstRunTitle'), m.t('today.doneTitle')],
  },
  {
    name: 'done',
    profile: null,
    visible: [m.t('today.doneTitle'), m.t('today.reviewsNone')],
    hidden: [m.t('today.firstRunTitle'), m.t('today.reviewsStart')],
  },
] as const;

for (const v of VARIANTS) {
  test(`Today: ${v.name}`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await seed(page, {
      'm1.mockToday': v.name,
      ...(v.profile ? { 'm1.mockProfile': JSON.stringify(v.profile) } : {}),
    });
    await page.goto('/');
    const heading = page.getByRole('heading', { name: en.screens.today, level: 1 });
    await expect(heading).toBeVisible();
    for (const text of v.visible) await expect(page.getByText(text).first()).toBeVisible();
    for (const text of v.hidden) await expect(page.getByText(text)).toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: m.t('today.wordsRing') })).toBeVisible();

    // The last card scrolls clear of the tab bar.
    const nav = page.getByRole('navigation', { name: en.tabs.label });
    const last = page.getByRole('link', { name: m.t('today.wordsAction') });
    await last.scrollIntoViewIfNeeded();
    const [navBox, lastBox] = [await nav.boundingBox(), await last.boundingBox()];
    expect(navBox && lastBox).toBeTruthy();
    if (navBox && lastBox) expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y);
    for (const link of await page.locator('main a, main button').all()) {
      const box = await link.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
}

test('settings: a change sends PATCH /me, the theme switches, about lists the sources', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto('/');
  await page.getByRole('link', { name: m.t('today.settings') }).click();
  await expect(page.getByRole('heading', { name: en.screens.settings, level: 1 })).toBeVisible();
  await noSidewaysScroll(page);

  const strict = page.getByRole('switch', { name: m.t('settings.strict') });
  const patch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/me'));
  await strict.click();
  expect((await patch).postDataJSON()).toEqual({ strictDiacritics: true });
  await expect(strict).toHaveAttribute('aria-checked', 'true');

  const themePatch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/me'));
  await page.getByRole('radio', { name: m.t('settings.themeDark') }).click();
  expect((await themePatch).postDataJSON()).toEqual({ settings: { theme: 'dark' } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await noSidewaysScroll(page);

  // Deletion asks twice; cancel at the second question.
  await page.getByRole('button', { name: m.t('settings.delete') }).click();
  await page.getByRole('button', { name: m.t('settings.deleteContinue') }).click();
  await expect(
    page.getByRole('dialog', { name: m.t('settings.deleteConfirmTitle') }),
  ).toBeVisible();
  await page.getByRole('button', { name: m.t('settings.deleteCancel') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('link', { name: m.t('settings.about') }).click();
  await expect(page.getByRole('heading', { name: en.screens.about, level: 1 })).toBeVisible();
  await expect(page.getByText('2026-11-17.1')).toBeVisible();
  await expect(page.getByText('Tatoeba')).toBeVisible();
  await noSidewaysScroll(page);

  // The setting survives a reload on the mock server.
  await page.goto('/settings');
  await expect(page.getByRole('switch', { name: m.t('settings.strict') })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(errors).toEqual([]);
});

test('offline: Today says so', async ({ page, context }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto('/');
  await expect(page.getByText('12 due')).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(m.t('notices.offline'))).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(m.t('notices.offline'))).toHaveCount(0);
  expect(errors).toEqual([]);
});
