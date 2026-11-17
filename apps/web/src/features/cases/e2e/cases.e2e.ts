// The main flows of the cases feature at 390 x 844 against the mock server: the course map,
// a lesson to completion, the trainer with its feedback, the trainer offline, and a pattern.
// Every test checks for console errors and sideways scroll.
import { expect, type Page, type Request, test } from '@playwright/test';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const DEV_SESSION = {
  userId: DEV_USER,
  email: 'dev@example.test',
  accessToken: `dev:${DEV_USER}`,
  expiresAt: null,
};

type Attempt = { id: string; exerciseId: string; typed: string; retry: boolean; correct: boolean };

function watch(page: Page) {
  const errors: string[] = [];
  const attempts: Attempt[][] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/declension/attempts')) {
      attempts.push((req.postDataJSON() as { attempts: Attempt[] }).attempts);
    }
  });
  return { errors, attempts };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);
});

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

const gap = (page: Page) => page.getByLabel('Fill the gap');

async function type(page: Page, text: string) {
  await gap(page).fill(text);
  await gap(page).press('Enter');
}

test('the course map shows nine lessons and the mastery grid with labels', async ({ page }) => {
  const { errors } = watch(page);
  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Case course', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Lesson \d/ })).toHaveCount(9);
  for (const level of ['Strong', 'Fair', 'Weak', 'Not yet']) {
    await expect(page.locator('[data-cell]').getByText(level).first()).toBeVisible();
  }
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: 'Accusative singular: Strong' }).click();
  const sheet = page.getByRole('dialog', { name: 'Accusative singular' });
  await expect(sheet.getByText('Masculine animate')).toBeVisible();
  await expect(sheet.locator('[data-gender]')).toHaveCount(4);
  // Tap targets of the grid are at least 44 px tall.
  await page.keyboard.press('Escape');
  for (const cell of await page.locator('[data-cell]').all()) {
    expect((await cell.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test('a lesson runs from the first step to completion', async ({ page }) => {
  const { errors } = watch(page);
  const progress: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/declension/lessons/acc-sg/progress')) {
      progress.push(req.postDataJSON());
    }
  });
  await page.goto('/cases');
  await page.getByRole('link', { name: /Lesson 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Lesson', level: 1 })).toBeVisible();
  await expect(page.getByTestId('step-label')).toHaveText('Step 1 of 5 · Meaning');
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('step-label')).toHaveText('Step 2 of 5 · Triggers');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('step-label')).toHaveText('Step 3 of 5 · Comprehension');
  await page.getByRole('button', { name: 'žena', exact: true }).click();
  await expect(
    page.getByText('That is the nominative singular. This sentence needs the accusative.', {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'ženu', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('step-label')).toHaveText('Step 4 of 5 · Production');
  await type(page, 'knihu');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('step-label')).toHaveText('Step 5 of 5 · Checkpoint');
  await type(page, 'knihu');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'ženu', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const done = page.getByTestId('lesson-complete');
  await expect(done).toContainText('You scored 2 of 2.');
  await expect(done.getByTestId('added-cards').getByRole('link')).toHaveText(['žena', 'kniha']);
  await noSidewaysScroll(page);
  expect(progress.at(-1)).toEqual({
    stepIndex: 4,
    status: 'completed',
    score: { correct: 2, total: 2 },
  });
  expect(progress).toHaveLength(5);
  // The course shows the lesson as completed.
  await page.getByRole('link', { name: 'Back to the course' }).click();
  await expect(page.locator('[data-lesson="acc-sg"]')).toContainText('Completed · 2 of 2');
  expect(errors).toEqual([]);
});

test('the trainer names the mistake and allows one retry', async ({ page }) => {
  const { errors, attempts } = watch(page);
  await page.goto('/cases/train');
  await page.getByRole('button', { name: /^5 items/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('trainer-progress')).toHaveText('1 / 5');
  await noSidewaysScroll(page);

  await type(page, 'meste');
  await expect(page.getByRole('status').filter({ hasText: 'Try once more.' })).toContainText(
    'That is the locative singular. After do comes the genitive.',
  );
  await type(page, 'mesta');
  await expect(page.getByText('Right: do mesta.')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await type(page, 'ulicy');
  await expect(page.getByText('The ending -y belongs to hard nouns like žena.')).toBeVisible();
  await type(page, 'ulicy');
  await expect(page.getByText('Ulica is a soft noun: z ulice.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();

  await type(page, 'zenam');
  await expect(page.getByText('Watch ž, á.', { exact: false })).toBeVisible();
  await type(page, 'ženám');
  await page.getByRole('button', { name: 'Next' }).click();

  await page.getByRole('button', { name: 'kine', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await type(page, 'bratovi');
  await page.getByRole('button', { name: 'Finish' }).click();

  const summary = page.getByTestId('trainer-summary');
  await expect(summary).toContainText('2 of 5 right on the first try');
  await expect(page.getByTestId('sync-state')).toHaveText('All answers are saved.');
  await expect(summary.getByTestId('weak')).toBeVisible();
  await noSidewaysScroll(page);
  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.map((a) => [a.typed, a.retry])).toEqual([
    ['meste', false],
    ['mesta', true],
    ['ulicy', false],
    ['ulicy', true],
    ['zenam', false],
    ['ženám', true],
    ['kine', false],
    ['bratovi', false],
  ]);
  expect(errors).toEqual([]);
});

test('a trainer session finishes offline and its attempts are sent once', async ({
  page,
  context,
}) => {
  const { errors, attempts } = watch(page);
  await page.goto('/cases/train');
  await page.getByRole('button', { name: /^5 items/ }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByTestId('trainer-progress')).toHaveText('1 / 5');

  await context.setOffline(true);
  for (const answer of ['mesta', 'ulice', 'ženám']) {
    await type(page, answer);
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await page.getByRole('button', { name: 'kine', exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await type(page, 'bratovi');
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByTestId('trainer-summary')).toContainText('5 of 5 right on the first try');
  await expect(page.getByTestId('sync-state')).toHaveText(
    'Some answers wait to be sent. They go out when you are online.',
  );
  expect(attempts).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.getByTestId('sync-state')).toHaveText('All answers are saved.');
  const sent = attempts.flat();
  expect(sent).toHaveLength(5);
  expect(new Set(sent.map((a) => a.id)).size).toBe(5);
  // Nothing goes out twice later on.
  await page.waitForTimeout(500);
  expect(attempts.flat()).toHaveLength(5);
  expect(errors).toEqual([]);
});

test('a pattern shows its endings and the everyday word', async ({ page }) => {
  const { errors } = watch(page);
  await page.goto('/cases');
  await page.getByRole('link', { name: 'ulica', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pattern', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ulica', level: 2 })).toBeVisible();
  await expect(page.getByTestId('everyday')).toHaveText('práca');
  await expect(page.getByRole('row', { name: /Genitive/ })).toContainText('-e');
  await noSidewaysScroll(page);
  await page.goto('/cases/pattern/pekny');
  await expect(page.getByRole('heading', { name: 'pekný', level: 2 })).toBeVisible();
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});
