// Flow 3: import and reading with a capture. The learner pastes a text, the API analyses it in
// the background, the reader explains a case after a preposition, a word is saved and a known
// word marked, the sentence is translated, and the saved word turns up as a card in review.
import type { ReviewItem } from '@app/contracts';
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

const TITLE = 'Káva a kino';
const BODY = 'Mám rád kávu. Dnes idem do kina.';

test('import a text, read it, save a word, and review it', async ({ page, api }) => {
  await onboard(api);

  await page.goto('/read');
  await expect(page.getByRole('heading', { name: 'Library', level: 1 })).toBeVisible();
  await noSidewaysScroll(page);
  await page.getByRole('link', { name: 'Import a text' }).first().click();
  await expect(page.getByRole('heading', { name: 'Import a text', level: 1 })).toBeVisible();
  await page.getByLabel('Title (optional)').fill(TITLE);
  await page.getByLabel('Slovak text').fill(BODY);
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/texts') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Import' }).click();
  expect((await created).status()).toBe(202);

  // The reader opens once the analysis is stored.
  await expect(page.getByRole('heading', { name: TITLE, level: 2 })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/);
  const textId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await noSidewaysScroll(page);

  // A noun after a preposition: the sheet names the case and the trigger.
  const kina = page.locator('[data-sentence="1"] [data-token="3"]');
  await expect(kina).toHaveText('kina');
  await kina.click();
  const kinaSheet = page.getByRole('dialog', { name: 'kina' });
  await expect(kinaSheet).toBeVisible();
  await expect(kinaSheet.getByTestId('trigger')).toHaveText('After “do” comes the genitive.');
  await expect(kinaSheet.getByTestId('form')).toContainText('Genitive');

  // Translate the sentence (the mock gateway marks it as untranslated).
  await kinaSheet.getByRole('button', { name: 'Translate the sentence' }).click();
  await expect(kinaSheet.getByText('[EN] Dnes idem do kina.')).toBeVisible();

  // Mark it known: the API stores the status.
  const statusSet = page.waitForResponse(
    (r) => /\/api\/v1\/lemmas\/\d+\/status$/.test(r.url()) && r.request().method() === 'PUT',
  );
  await kinaSheet.getByRole('button', { name: 'Known', exact: true }).click();
  expect((await statusSet).status()).toBe(200);
  await expect(kina).toHaveAttribute('data-status', 'known');

  // Save kávu with its sentence.
  const kavu = page.locator('[data-sentence="0"] [data-token="2"]');
  await expect(kavu).toHaveText('kávu');
  await expect(kavu).toHaveAttribute('data-status', 'unknown');
  await kavu.click();
  const sheet = page.getByRole('dialog', { name: 'kávu' });
  await expect(sheet).toBeVisible();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/notes') && r.request().method() === 'POST',
  );
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  const noteId = ((await res.json()) as { note: { id: string } }).note.id;
  expect(res.request().postDataJSON()).toMatchObject({
    kind: 'word',
    source: 'reader',
    textId,
    context: { sentenceSk: 'Mám rád kávu.', blank: { start: 8, end: 12 } },
  });
  await expect(kavu).toHaveAttribute('data-status', 'learning');

  // The server's text detail agrees after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: TITLE, level: 2 })).toBeVisible();
  await expect(page.locator('[data-sentence="0"] [data-token="2"]')).toHaveAttribute(
    'data-status',
    'learning',
  );
  await expect(page.locator('[data-sentence="1"] [data-token="3"]')).toHaveAttribute(
    'data-status',
    'known',
  );
  const detail = await api.call('texts.get', { params: { id: textId } });
  expect(detail.body.status).toBe('ready');

  // The capture is a card in review, with the sentence it was saved from.
  const queueSeen = page.waitForResponse(
    (r) => r.url().includes('/api/v1/review/queue') && r.status() === 200,
  );
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Review' })
    .click();
  const items = ((await (await queueSeen).json()) as { items: ReviewItem[] }).items;
  const card = items.find((i) => i.noteId === noteId);
  expect(card).toBeDefined();
  expect(items).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  await expect(page.getByTestId('left')).toHaveText('1 left');
  const { sentenceSk, blank } = card?.prompt ?? { sentenceSk: '', blank: { start: 0, end: 0 } };
  await expect(page.getByTestId('prompt')).toHaveText(
    `${sentenceSk.slice(0, blank.start)} ${sentenceSk.slice(blank.end)}`,
  );
  const field = page.getByRole('textbox', { name: 'Your answer' });
  await field.fill(card?.answers[0] ?? '');
  await field.press('Enter');
  await expect(page.getByText('Correct', { exact: true })).toBeVisible();
  await noSidewaysScroll(page);
});
