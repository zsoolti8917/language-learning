// M1's main flow at 390 x 844 on the mock server: sign up, the code, onboarding, Today.
import { expect, test } from '@playwright/test';
import { en } from '../../../messages/en';
import { m as tm } from '../../today/messages';
import { m } from '../messages';
import { FRESH_PROFILE, noSidewaysScroll, seed, watchErrors } from './helpers';

test('sign up, enter the code, onboard and land on Today', async ({ page }) => {
  const errors = watchErrors(page);
  await seed(page, { 'm1.mockProfile': JSON.stringify(FRESH_PROFILE) });

  await page.goto('/signup');
  await expect(page.getByRole('heading', { name: en.screens.signup, level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByLabel(m.t('fields.email')).fill('new@example.test');
  await page.getByLabel(m.t('fields.password')).fill('short');
  await page.getByRole('button', { name: m.t('signup.submit') }).click();
  await expect(page.getByText(m.t('errors.weakPassword', { min: 8 }))).toBeVisible();
  await page.getByLabel(m.t('fields.password')).fill('long-enough-1');
  await page.getByRole('button', { name: m.t('signup.submit') }).click();

  await expect(page.getByRole('heading', { name: en.screens.verify, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/verify$/);
  await expect(page.getByRole('button', { name: /Send a new code in \d+ s/ })).toBeDisabled();
  await noSidewaysScroll(page);
  const code = page.getByLabel(m.t('fields.code'));
  await code.fill('000000');
  await expect(page.getByRole('alert')).toHaveText(m.t('errors.invalid_code'));
  await code.fill('');
  // Paste a code with a space, as it often comes from a mail.
  await code.focus();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text', '123 456');
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByRole('heading', { name: en.screens.onboarding, level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByLabel(m.t('onboarding.name')).fill('Zuzka');
  await page.getByRole('radio', { name: '30 min' }).click();
  await expect(page.getByRole('radio', { name: '30 min' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel(m.t('onboarding.timezone'))).not.toHaveValue('');
  const patch = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith('/me'));
  await page.getByRole('button', { name: m.t('onboarding.submit') }).click();
  const body = (await patch).postDataJSON();
  expect(body).toMatchObject({
    displayName: 'Zuzka',
    dailyNewLimit: 20,
    dailyReviewLimit: 160,
    settings: { minutesPerDay: 30 },
  });
  expect(typeof body.settings.onboardedAt).toBe('string');

  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(tm.t('today.greeting', { name: 'Zuzka' }))).toBeVisible();
  const placement = page.getByRole('link', { name: tm.t('today.firstRunAction') });
  await expect(placement).toBeVisible();
  await expect(page.getByRole('navigation', { name: en.tabs.label })).toBeVisible();
  await noSidewaysScroll(page);

  // A reload keeps the learner past onboarding.
  await page.reload();
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();

  await placement.click();
  await expect(page).toHaveURL(/\/placement$/);
  expect(errors).toEqual([]);
});

test('sign in with email and password, and the one tap dev login', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: en.screens.login, level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: m.t('login.submit') }).click();
  await expect(page.getByText(m.t('errors.emailRequired'))).toBeVisible();
  await page.getByLabel(m.t('fields.email')).fill('me@example.test');
  await page.getByLabel(m.t('fields.password')).fill('whatever');
  await page.getByRole('button', { name: m.t('login.submit') }).click();
  await expect(page.getByRole('heading', { name: en.screens.review, level: 1 })).toBeVisible();

  await page.evaluate(() => localStorage.removeItem('app.devSession'));
  await page.goto('/login');
  await page.getByRole('button', { name: en.dev.signIn }).click();
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});

test('reset the password with a code', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/login');
  await page.getByRole('link', { name: m.t('login.forgot') }).click();
  await expect(page.getByRole('heading', { name: en.screens.reset, level: 1 })).toBeVisible();
  await page.getByLabel(m.t('fields.email')).fill('me@example.test');
  await page.getByRole('button', { name: m.t('reset.sendCode') }).click();
  await page.getByLabel(m.t('fields.code')).fill('123456');
  await page.getByLabel(m.t('fields.newPassword')).fill('new-password-1');
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: m.t('reset.submit') }).click();
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
});
