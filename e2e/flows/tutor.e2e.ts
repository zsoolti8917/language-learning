// Flow 7: a tutor scenario with one fixed and one corrected error. The gateway is the mock with
// its scripted tutor answers (packages/ai/prompts/tutor.*): the analysis finds "s kamarát" and
// "do mesto", the reply is a fixed line. Everything else is the real tutor module: verification
// against the dictionary, the decision table, the stream, the stored conversation and the card.
import type { Locator, Page } from '@playwright/test';
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

const field = (page: Page) => page.getByRole('textbox', { name: 'Your message in Slovak' });
const list = (page: Page) => page.getByRole('list', { name: 'Messages' });
const replies = (page: Page): Locator =>
  list(page).locator('li[data-role="tutor"][data-state="sent"]');

async function send(page: Page, text: string, replyCount: number): Promise<void> {
  const streamed = page.waitForResponse(
    (r) => r.url().endsWith('/messages') && r.request().method() === 'POST',
  );
  await field(page).fill(text);
  await field(page).press('Enter');
  const res = await streamed;
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/event-stream');
  await expect(replies(page)).toHaveCount(replyCount);
}

test('tutor scenario: one error fixed by the learner, one corrected, a card in review', async ({
  page,
  api,
}) => {
  await onboard(api);
  await page.goto('/tutor');
  await expect(page.getByRole('heading', { name: 'Tutor', level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  const card = page.locator('[data-scenario="scn-city-walk"]');
  await card.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('heading', { name: 'Conversation', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/tutor\/[0-9a-f-]{36}$/);
  const conversationId = new URL(page.url()).pathname.split('/').pop() ?? '';
  // The opening line of the scenario.
  await expect(replies(page)).toHaveCount(1);
  await expect(replies(page).first()).toContainText('Ahoj! Ideš dnes do mesta?');

  // 1. "s kamarát": prompted, the answer is not shown. Typed with the accent bar.
  await field(page).click();
  await page.keyboard.type('Dnes idem do kina s kamar');
  await page
    .getByRole('toolbar', { name: 'Slovak letters' })
    .getByRole('button', { name: 'á', exact: true })
    .click();
  await page.keyboard.type('t.');
  await expect(field(page)).toHaveValue('Dnes idem do kina s kamarát.');
  await send(page, 'Dnes idem do kina s kamarát.', 2);
  const kamarat = list(page).locator('[data-mark]', { hasText: 'kamarát' });
  await expect(kamarat).toHaveAttribute('data-mark', 'prompted');
  await expect(
    page.getByText('Check “kamarát”. Something about this word is off; try writing it again.'),
  ).toBeVisible();
  await expect(list(page).getByText('kamarátom')).toHaveCount(0);

  // 2. The learner fixes it; "do mesto" is the next prompted error.
  await send(page, 'Idem s kamarátom. Potom ideme do mesto.', 3);
  await expect(kamarat).toHaveAttribute('data-mark', 'self_corrected');
  await expect(page.getByText('Fixed: “kamarát”. Well done.')).toBeVisible();
  const mesto = list(page).locator('[data-mark]', { hasText: /^mesto$/ });
  await expect(mesto).toHaveAttribute('data-mark', 'prompted');

  // 3. The same mistake again: the tutor corrects it and a card is added.
  await send(page, 'Ideme do mesto.', 4);
  await expect(mesto.first()).toHaveAttribute('data-mark', 'corrected');
  await expect(page.getByText('“mesto” should be “mesta”.').first()).toBeVisible();
  await expect(page.locator('[data-card-chip]')).toHaveCount(1);
  await noSidewaysScroll(page);

  // The stored conversation agrees.
  const detail = await api.call('tutor.getConversation', { params: { id: conversationId } });
  const statuses = detail.body.errors.map((e) => [e.given, e.status]);
  expect(statuses).toContainEqual(['kamarát', 'self_corrected']);
  expect(statuses).toContainEqual(['mesto', 'corrected']);
  expect(detail.body.messages.filter((m) => m.role === 'learner')).toHaveLength(3);

  // 4. End: the summary lists the corrections and the one card.
  await page.getByRole('button', { name: 'End', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Summary' });
  await expect(summary).toBeVisible();
  await expect(summary.getByText('1 card added to your review.')).toBeVisible();
  await expect(summary.locator('[data-correction]')).not.toHaveCount(0);
  await noSidewaysScroll(page);

  // The card waits in review: a case sentence with "mesta" as the answer.
  const queue = await api.call('review.queue', { query: { limit: 50 } });
  const tutorCard = queue.body.items.find((i) => i.answers.includes('mesta'));
  expect(tutorCard?.kind).toBe('case_sentence');
  await summary.getByRole('link', { name: 'Go to review' }).click();
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  await expect(page.getByTestId('left')).toHaveText('1 left');
});
