// Shared steps of the M5 browser tests.
import { expect, type Page } from '@playwright/test';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const DEV_SESSION = {
  userId: DEV_USER,
  email: 'dev@example.test',
  accessToken: `dev:${DEV_USER}`,
  expiresAt: null,
};

/** Signs in as the dev user before the page loads. */
export async function signIn(page: Page): Promise<void> {
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);
}

/** Collects console errors and page errors; the test expects none. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export async function noSidewaysScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}
