// The words track in the browser at 390 x 844 against the mock server (M5).
import { expect, test } from '@playwright/test';
import { en } from '../../../messages/en';
import { m } from '../messages';
import { noSidewaysScroll, signIn, watchErrors } from './helpers';

test('sorting 45 words sends two full batches and one partial batch on leaving', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const batches: number[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/words/triage')) {
      batches.push((req.postDataJSON() as { decisions: unknown[] }).decisions.length);
    }
  });
  await signIn(page);
  await page.goto('/words');
  await expect(page.getByRole('heading', { name: en.screens.words, level: 1 })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Known in words 1–500' })).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole('link', { name: /Words 1–500/ }).click();
  await expect(page.getByRole('heading', { name: en.screens.band, level: 1 })).toBeVisible();
  await expect(page.getByRole('tabpanel').getByRole('link').first()).toBeVisible();
  await noSidewaysScroll(page);

  await page.getByRole('button', { name: m.t('band.sort') }).click();
  await expect(page.getByText('0 of 62')).toBeVisible();
  await expect(page.getByTestId('sort-gloss')).toHaveCount(0);
  await page.getByRole('button', { name: m.t('sort.showMeaning') }).click();
  await expect(page.getByTestId('sort-gloss')).toBeVisible();
  await noSidewaysScroll(page);

  const choices = [m.t('sort.known'), m.t('sort.learn'), m.t('sort.ignore')];
  for (let i = 0; i < 44; i++) {
    await page.getByRole('button', { name: choices[i % 3], exact: true }).click();
    await expect(page.getByText(`${i + 1} of 62`)).toBeVisible();
  }
  // A swipe to the right decides Known for the 45th word.
  const card = page.getByTestId('sort-card');
  const box = await card.boundingBox();
  if (!box) throw new Error('no card');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 60, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, y + 4, { steps: 4 });
  await page.mouse.move(box.x + 220, y + 6, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByText('45 of 62')).toBeVisible();

  // Two full batches went out while sorting; the newest five still wait.
  await expect.poll(() => batches).toEqual([20, 20]);

  // Undo takes the last decision back out of the waiting batch.
  const before = await page.getByTestId('sort-lemma').textContent();
  await page.getByRole('button', { name: m.t('sort.undo') }).click();
  await expect(page.getByText('44 of 62')).toBeVisible();
  await expect(page.getByTestId('sort-lemma')).not.toHaveText(before ?? '');
  await page.getByRole('button', { name: m.t('sort.known'), exact: true }).click();
  await expect(page.getByText('45 of 62')).toBeVisible();

  await page.getByRole('button', { name: m.t('sort.finish') }).click();
  await expect.poll(() => batches).toEqual([20, 20, 5]);
  await expect(page.getByRole('button', { name: m.t('band.sort') })).toBeVisible();

  // The sorted words left the new list.
  await page.getByRole('tab', { name: m.t('status.unknown') }).click();
  await expect(page.getByRole('tabpanel').getByRole('link')).toHaveCount(17);
  expect(errors).toEqual([]);
});

test('the word page renders mesto with six cases by two numbers', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto('/lemma/20');
  await expect(page.getByRole('heading', { name: en.screens.lemma, level: 1 })).toBeVisible();
  await expect(page.getByTestId('lemma-title')).toHaveText('mesto');
  const table = page.getByRole('table', { name: m.t('lemma.formsLabel', { lemma: 'mesto' }) });
  await expect(table.getByRole('row')).toHaveCount(7);
  await expect(table.getByRole('cell')).toHaveCount(12);
  await expect(table.locator('[data-case-row="loc"]')).toContainText('meste');
  await expect(table.locator('[data-top]')).toHaveCount(3);
  await expect(page.getByText('Idem do mesta.')).toBeVisible();
  await noSidewaysScroll(page);

  // The status control and the note link.
  await page.getByRole('button', { name: m.t('status.known') }).click();
  await expect(page.getByRole('button', { name: /Known/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /Open the note/ })).toBeVisible();

  // Every control is at least 44 px tall.
  for (const b of await page.getByRole('main').getByRole('button').all()) {
    expect((await b.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(errors).toEqual([]);
});

test('a word from the band list opens its page', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto('/words/band/0');
  await page.getByRole('tab', { name: m.t('status.learning') }).click();
  await page.getByRole('tabpanel').getByRole('link', { name: /dom/ }).click();
  await expect(page.getByTestId('lemma-title')).toHaveText('dom');
  await expect(page.getByRole('table')).toBeVisible();
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});
