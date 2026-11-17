// Shared steps of M1's browser tests.
import { expect, type Page } from '@playwright/test';

export const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';

/** Collects console errors and uncaught page errors. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** Starts signed in as the dev user (the dev login keeps its session in localStorage). */
export async function signIn(page: Page) {
  await page.addInitScript((userId) => {
    localStorage.setItem(
      'app.devSession',
      JSON.stringify({
        userId,
        email: 'dev@example.test',
        accessToken: `dev:${userId}`,
        expiresAt: null,
      }),
    );
  }, DEV_USER);
}

/** Seeds localStorage keys once (not again on later navigations of the same page). */
export async function seed(page: Page, values: Record<string, string>) {
  await page.addInitScript((v) => {
    for (const [k, value] of Object.entries(v)) {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, value);
    }
  }, values);
}

export async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** A fresh account's profile for the mock server (see features/account/mocks.ts). */
export const FRESH_PROFILE = {
  userId: DEV_USER,
  displayName: null,
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
  settings: {},
  placementDoneAt: null,
  currentLessonId: null,
  createdAt: '2026-11-17T08:00:00.000Z',
  updatedAt: '2026-11-17T08:00:00.000Z',
};
