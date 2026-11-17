// The placement check in the browser at 390 x 844 against the mock server (M5).
import { expect, type Page, test } from '@playwright/test';
import { en } from '../../../messages/en';
import { noSidewaysScroll, signIn, watchErrors } from '../../words/e2e/helpers';
import { m } from '../messages';
import { MINI_CASE_ITEMS } from '../mockData';

// The mock's round sizes (../mocks.ts, which needs Vite and is not loaded here).
const VOCAB_ROUNDS = 3;
const VOCAB_PER_ROUND = 6;

async function answerVocab(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const group = page.getByRole('group', { name: /^Meanings of / });
    const lemma = await page.getByTestId('placement-lemma').textContent();
    // The first meaning, or "I don't know" for every third word.
    const options = group.getByRole('button');
    await (i % 3 === 2 ? options.last() : options.first()).click();
    const same = new RegExp(`^${(lemma ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
    await expect(page.getByTestId('placement-lemma').filter({ hasText: same })).toHaveCount(0);
  }
}

test('the placement check reaches the result, resumes after a reload and moves on to Today', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await signIn(page);
  await page.goto('/placement');
  await expect(page.getByRole('heading', { name: en.screens.placement, level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: en.tabs.label })).toHaveCount(0);
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: m.t('intro.start') }).click();

  const bar = page.getByRole('progressbar', { name: m.t('progress.label') });
  await expect(bar).toHaveAttribute('aria-valuenow', '0');
  await answerVocab(page, VOCAB_PER_ROUND + 2);
  await expect(page.getByText(/Round 2 of 4/)).toBeVisible();
  await expect(page.getByText(`3 of ${VOCAB_PER_ROUND}`)).toBeVisible();
  const shown = await page.getByTestId('placement-lemma').textContent();
  await noSidewaysScroll(page);

  // A reload in the middle resumes the run at the same question.
  await page.reload();
  await expect(page.getByText(/Round 2 of 4/)).toBeVisible();
  await expect(page.getByTestId('placement-lemma')).toHaveText(shown ?? '');
  await expect(page.getByRole('button', { name: m.t('intro.start') })).toHaveCount(0);

  await answerVocab(page, VOCAB_PER_ROUND * VOCAB_ROUNDS - VOCAB_PER_ROUND - 2);
  await expect(page.getByText(/Round 4 of 4/)).toBeVisible();

  // The case round: typed answers with the accent bar, no feedback.
  for (const [i, item] of MINI_CASE_ITEMS.entries()) {
    const field = page.getByRole('textbox', { name: m.t('cases.answerLabel') });
    await expect(field).toBeVisible();
    await expect(page.getByText(item.cue, { exact: true })).toBeVisible();
    if (i % 2 === 0) {
      await field.fill(item.answers[0] ?? '');
      await page.getByRole('button', { name: m.t('cases.next') }).click();
    } else {
      await page.getByRole('button', { name: m.t('cases.dontKnow') }).click();
    }
    if (i === 0) {
      await expect(page.getByText(/Correct|Wrong|Almost/)).toHaveCount(0);
      await noSidewaysScroll(page);
    }
  }

  const result = page.getByTestId('placement-result');
  await expect(result).toBeVisible();
  await expect(result.getByText(/count as known/)).toBeVisible();
  await expect(result.getByText('Accusative singular')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await noSidewaysScroll(page);

  await page.getByRole('button', { name: m.t('result.continue') }).click();
  await expect(page.getByRole('heading', { name: en.screens.today, level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(errors).toEqual([]);
});
