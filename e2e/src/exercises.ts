// Answering one exercise of the cases feature (lesson or trainer) on screen.
import type { ExerciseItem } from '@app/contracts';
import { expect, type Page } from '@playwright/test';

/** The button that moves on after an answer, whatever the screen calls it. */
export const NEXT = /^(Next|Continue|Finish)$/;

/**
 * Answers the exercise on screen, right or wrong (a wrong answer outside the checkpoint gets
 * one retry, which is answered wrong too), then moves on.
 */
export async function solve(page: Page, item: ExerciseItem, right: boolean): Promise<void> {
  const next = page.getByRole('button', { name: NEXT });
  if (item.kind === 'cloze') {
    const field = page.getByLabel('Fill the gap');
    await field.fill(right ? (item.answers[0] ?? '') : 'zzz');
    await field.press('Enter');
    if (!right) {
      await expect(next.or(page.getByText('Try once more.', { exact: false }))).toBeVisible();
      if (!(await next.isVisible())) {
        await field.fill('zzz');
        await field.press('Enter');
      }
    }
  } else {
    const options = item.options ?? [];
    const pick = options.find((o) => o.correct === right) ?? options[0];
    await page.getByRole('button', { name: pick?.text ?? '', exact: true }).click();
    if (!right) {
      const other = options.find((o) => !o.correct && o.text !== pick?.text);
      await expect(next.or(page.getByText('Try once more.', { exact: false }))).toBeVisible();
      if (!(await next.isVisible()) && other)
        await page.getByRole('button', { name: other.text, exact: true }).click();
    }
  }
  await expect(next).toBeVisible();
  await next.click();
}
