// Flow 4: a lesson with its checkpoint and cards. The learner walks the first lesson of the
// course step by step, fails the checkpoint once, passes it on the retry, and the completion
// creates review cards that the review session then serves.
import type { ExerciseItem, LessonDetail } from '@app/contracts';
import type { Page } from '@playwright/test';
import { solve } from '../src/exercises';
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

/** Step index and item index read from the screen ("Step 3 of 5", "Item 2 of 4"). */
async function position(page: Page): Promise<{ step: number; item: number }> {
  const label = (await page.getByTestId('step-label').textContent()) ?? '';
  const step = Number(/Step (\d+) of/.exec(label)?.[1] ?? 0) - 1;
  const itemOf = page.getByText(/^Item \d+ of \d+$/);
  const item = (await itemOf.isVisible())
    ? Number(/Item (\d+) of/.exec((await itemOf.textContent()) ?? '')?.[1] ?? 0) - 1
    : -1;
  return { step, item };
}

test('a lesson with its checkpoint: failed once, passed, cards in review', async ({
  page,
  api,
}) => {
  await onboard(api);
  const course = await api.call('declension.course');
  const first = course.body.lessons[0];
  expect(first?.status).toBe('available');
  const lessonId = first?.id ?? '';
  const detail: LessonDetail = (await api.call('declension.lesson', { params: { id: lessonId } }))
    .body;
  const checkpoint = detail.steps.findIndex((s) => s.content.kind === 'checkpoint');
  expect(checkpoint).toBeGreaterThan(0);

  const progress: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes(`/declension/lessons/${lessonId}/progress`))
      progress.push(req.postDataJSON());
  });

  await page.goto('/cases');
  await expect(page.getByRole('heading', { name: 'Case course', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Lesson \d/ })).toHaveCount(
    course.body.lessons.length,
  );
  await noSidewaysScroll(page);
  await page.getByRole('link', { name: /^Lesson 1\b/ }).click();
  await expect(page.getByRole('heading', { name: 'Lesson', level: 1 })).toBeVisible();
  await expect(page.getByTestId('step-label')).toHaveText(
    new RegExp(`^Step 1 of ${detail.steps.length}`),
  );

  const done = page.getByTestId('lesson-complete');
  const failed = page.getByTestId('checkpoint-failed');
  let failedOnce = false;
  for (let guard = 0; guard < 60; guard++) {
    await expect(done.or(failed).or(page.getByTestId('step-label')).first()).toBeVisible();
    if (await done.isVisible()) break;
    if (await failed.isVisible()) {
      failedOnce = true;
      await noSidewaysScroll(page);
      await page.getByRole('button', { name: 'Retry the checkpoint' }).click();
      continue;
    }
    const before = await position(page);
    const step = detail.steps[before.step];
    if (!step || before.item < 0) {
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    } else {
      const item = step.exercises[before.item];
      expect(item, `step ${before.step + 1}, item ${before.item + 1}`).toBeDefined();
      const right = !(before.step === checkpoint && !failedOnce);
      await solve(page, item as ExerciseItem, right);
    }
    await expect(async () => {
      if (await done.isVisible()) return;
      if (await failed.isVisible()) return;
      expect(await position(page)).not.toEqual(before);
    }).toPass({ timeout: 20_000 });
  }
  expect(failedOnce).toBe(true);
  await expect(done).toBeVisible();
  const total = detail.steps[checkpoint]?.exercises.length ?? 0;
  await expect(done).toContainText(`You scored ${total} of ${total}.`);
  await noSidewaysScroll(page);

  // The completion is stored, and the lesson's cards are listed and exist on the server.
  await expect
    .poll(
      async () =>
        (await api.call('declension.lesson', { params: { id: lessonId } })).body.progress?.status,
    )
    .toBe('completed');
  expect(progress.at(-1)).toEqual({
    stepIndex: detail.steps.length - 1,
    status: 'completed',
    score: { correct: total, total },
  });
  const notes = await api.call('notes.list', { query: { kind: 'case_sentence' } });
  expect(notes.body.items.length).toBeGreaterThan(0);
  const cards = done.getByTestId('added-cards').getByRole('link');
  await expect(cards).toHaveCount(notes.body.items.length);

  // The course shows it completed; the cards wait in review.
  await page.getByRole('link', { name: 'Back to the course' }).click();
  await expect(page.locator(`[data-lesson="${lessonId}"]`)).toContainText('Completed');
  const queue = await api.call('review.queue', { query: { limit: 50 } });
  const noteIds = new Set(notes.body.items.map((n) => n.id));
  expect(queue.body.items.filter((i) => noteIds.has(i.noteId)).length).toBeGreaterThan(0);
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Review' })
    .click();
  await expect(page.getByRole('textbox', { name: 'Your answer' })).toBeVisible();
  await expect(page.getByTestId('left')).toHaveText(`${queue.body.items.length} left`);
});
