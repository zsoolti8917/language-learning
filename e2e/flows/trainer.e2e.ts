// Flow 5: a trainer session that moves mastery. The learner starts a mixed session from the
// API's selection, answers it (the first item wrong with its retry, the rest right), the
// attempts are stored, and the mastery of the practised buckets moves on the server and in
// the course grid.
import type { BucketMastery, ExerciseItem } from '@app/contracts';
import { solve } from '../src/exercises';
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

const key = (b: BucketMastery) => `${b.case}.${b.number}.${b.gender}`;

test('a trainer session moves mastery', async ({ page, api }) => {
  await onboard(api);
  const before = (await api.call('declension.course')).body.mastery;
  const attemptsBefore = new Map(before.map((b) => [key(b), b.attempts]));

  await page.goto('/cases/train');
  await expect(page.getByRole('heading', { name: 'Trainer', level: 1 })).toBeVisible();
  // The current lesson, 20 items of its one case and number over four genders: at least one
  // bucket gets the five attempts that take it past "not yet".
  await page.getByRole('button', { name: /^Current lesson/ }).click();
  await page.getByRole('button', { name: /^20 items/ }).click();
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/declension/sessions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const session = (await (await started).json()) as { items: ExerciseItem[] };
  const items = session.items;
  expect(items.length).toBe(20);
  await expect(page.getByTestId('trainer-progress')).toHaveText(`1 / ${items.length}`);
  await noSidewaysScroll(page);

  const sent: { exerciseId: string; correct: boolean; retry: boolean }[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/declension/attempts'))
      sent.push(...(req.postDataJSON() as { attempts: typeof sent }).attempts);
  });

  for (const [i, item] of items.entries()) {
    await expect(page.getByTestId('trainer-progress')).toHaveText(`${i + 1} / ${items.length}`);
    await solve(page, item, i !== 0);
  }

  const summary = page.getByTestId('trainer-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(
    `${items.length - 1} of ${items.length} right on the first try`,
  );
  await expect(page.getByTestId('sync-state')).toHaveText('All answers are saved.');
  await expect(summary.getByTestId('improved').getByRole('listitem')).not.toHaveCount(0);
  await noSidewaysScroll(page);
  // Every first try is stored once; the wrong one also has its retry.
  expect(sent.filter((a) => !a.retry).map((a) => a.exerciseId)).toEqual(
    items.map((i) => i.exerciseId),
  );
  expect(sent.filter((a) => a.retry)).toHaveLength(1);

  // The server's mastery moved for the practised buckets.
  const after = (await api.call('declension.course')).body.mastery;
  const moved = after.filter((b) => b.attempts > (attemptsBefore.get(key(b)) ?? 0));
  expect(moved.length).toBeGreaterThan(0);
  expect(moved.reduce((n, b) => n + b.attempts - (attemptsBefore.get(key(b)) ?? 0), 0)).toBe(
    sent.length,
  );
  expect(moved.some((b) => b.level !== 'unseen' && b.mastery > 0)).toBe(true);

  // The grid of the course shows a practised cell with its level.
  await page.getByRole('link', { name: 'Back to the course' }).click();
  await expect(page.getByRole('heading', { name: 'Case course', level: 1 })).toBeVisible();
  const practised = moved.find((b) => b.level !== 'unseen');
  const cell = page.locator(`[data-cell="${practised?.case}.${practised?.number}"]`);
  await expect(cell).toBeVisible();
  await expect(cell).not.toContainText('Not yet');
});
