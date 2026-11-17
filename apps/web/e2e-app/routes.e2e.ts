// Smoke run of the shell at 390 x 844 with the mock server on: every route shows its
// placeholder, tab screens under the tab bar, with no console error and no sideways scroll.
import { expect, type Page, test } from '@playwright/test';
import { en } from '../src/messages/en';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const DEV_SESSION = {
  userId: DEV_USER,
  email: 'dev@example.test',
  accessToken: `dev:${DEV_USER}`,
  expiresAt: null,
};

const TAB_ROUTES: [url: string, title: string, tab: string][] = [
  ['/', en.screens.today, 'today'],
  ['/settings', en.screens.settings, 'today'],
  ['/settings/about', en.screens.about, 'today'],
  ['/review', en.screens.review, 'review'],
  ['/deck', en.screens.deck, 'review'],
  ['/deck/0193a1b2-c3d4-7e5f-8a6b-000000000010', en.screens.note, 'review'],
  ['/words', en.screens.words, 'review'],
  ['/words/band/2', en.screens.band, 'review'],
  ['/lemma/20', en.screens.lemma, 'review'],
  ['/read', en.screens.library, 'read'],
  ['/read/import', en.screens.import, 'read'],
  ['/read/0193a1b2-c3d4-7e5f-8a6b-000000000020', en.screens.reader, 'read'],
  ['/cases', en.screens.course, 'cases'],
  ['/cases/lesson/loc-sg', en.screens.lesson, 'cases'],
  ['/cases/train', en.screens.trainer, 'cases'],
  ['/cases/pattern/mesto', en.screens.pattern, 'cases'],
  ['/tutor', en.screens.scenarios, 'tutor'],
  ['/tutor/0193a1b2-c3d4-7e5f-8a6b-000000000030', en.screens.chat, 'tutor'],
];

const BARE_ROUTES: [url: string, title: string, signedIn: boolean][] = [
  ['/login', en.screens.login, false],
  ['/signup', en.screens.signup, false],
  ['/verify', en.screens.verify, false],
  ['/reset', en.screens.reset, false],
  ['/onboarding', en.screens.onboarding, true],
  ['/placement', en.screens.placement, true],
];

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function signIn(page: Page) {
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);
}

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const [url, title, tab] of TAB_ROUTES) {
  test(`${url} shows its placeholder under the tab bar`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto(url);
    const heading = page.getByRole('heading', { name: title, level: 1 });
    await expect(heading).toBeVisible();
    const nav = page.getByRole('navigation', { name: en.tabs.label });
    await expect(nav).toBeVisible();
    await expect(nav.locator('[aria-current="page"]')).toHaveAttribute('data-tab', tab);

    // The tab bar sits at the bottom edge, the screen above it, each tab at least 44 px tall.
    const navBox = await nav.boundingBox();
    const headBox = await heading.boundingBox();
    expect(navBox && headBox).toBeTruthy();
    if (navBox && headBox) {
      expect(Math.round(navBox.y + navBox.height)).toBe(844);
      expect(headBox.y + headBox.height).toBeLessThanOrEqual(navBox.y);
    }
    for (const link of await nav.getByRole('link').all()) {
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
}

for (const [url, title, signedIn] of BARE_ROUTES) {
  test(`${url} shows its placeholder without a tab bar`, async ({ page }) => {
    const errors = watchErrors(page);
    if (signedIn) await signIn(page);
    await page.goto(url);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: en.tabs.label })).toHaveCount(0);
    await noSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
}

test('a signed out visitor lands on the login, signs in and reaches the screen', async ({
  page,
}) => {
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: en.screens.login, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: en.dev.signIn }).click();
  await expect(page.getByRole('heading', { name: en.screens.course, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: en.tabs.tutor }).click();
  await expect(page.getByRole('heading', { name: en.screens.scenarios, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/tutor$/);
});

test('the mock server answers the API with the contract examples', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  const profile = await page.evaluate(async () => {
    const res = await fetch('/api/v1/me', { headers: { Authorization: 'Bearer dev:x' } });
    return res.json();
  });
  expect(profile).toMatchObject({ userId: DEV_USER, displayName: 'Learner' });
});
