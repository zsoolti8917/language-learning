// The reader's main flow at 390 x 844 against the mock server: import a text, see it
// processing, read it, tap words, save one, and find it saved after a reload. No console
// error and no sideways scroll on the way.
import { expect, type Page, test } from '@playwright/test';
import { m } from '../messages';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const BODY = 'Mám rád kávu. Dnes idem do kina.';
const TITLE = 'Káva a kino';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript((id) => {
    localStorage.setItem(
      'app.devSession',
      JSON.stringify({
        userId: id,
        email: 'dev@example.test',
        accessToken: `dev:${id}`,
        expiresAt: null,
      }),
    );
  }, DEV_USER);
});

test('import, processing, tap and save', async ({ page }) => {
  const errors = watchErrors(page);

  // The library.
  await page.goto('/read');
  await expect(page.getByRole('heading', { name: m.t('library.title'), level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: /V Bratislave/ })).toBeVisible();
  await noSidewaysScroll(page);

  // Import: paste, title, counter.
  await page
    .getByRole('link', { name: m.t('library.import') })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: m.t('import.title'), level: 1 })).toBeVisible();
  await page.getByLabel(m.t('import.titleLabel')).fill(TITLE);
  await page.getByLabel(m.t('import.bodyLabel')).fill(BODY);
  await expect(page.getByTestId('char-counter')).toHaveText(`${BODY.length} / 20,000`);
  await noSidewaysScroll(page);
  await page.getByRole('button', { name: m.t('import.submit') }).click();

  // Processing, then the reader opens by itself.
  await expect(page.getByText(m.t('import.processingTitle'))).toBeVisible();
  await expect(page.getByRole('heading', { name: TITLE, level: 2 })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page).toHaveURL(/\/read\/[0-9a-f-]{36}$/);
  await noSidewaysScroll(page);

  // A noun after a preposition: the sheet explains the case.
  const kina = page.locator('[data-sentence="1"] [data-token="3"]');
  await expect(kina).toHaveText('kina');
  await kina.click();
  const kinaSheet = page.getByRole('dialog', { name: 'kina' });
  await expect(kinaSheet).toBeVisible();
  await expect(kinaSheet.getByTestId('trigger')).toHaveText('After “do” comes the genitive.');
  await expect(kinaSheet.getByTestId('form')).toContainText('Genitive');
  // Once it has slid in, the sheet sits at the bottom edge of the screen.
  await expect
    .poll(async () => {
      const box = await kinaSheet.boundingBox();
      return Math.round((box?.y ?? 0) + (box?.height ?? 0));
    })
    .toBe(844);
  await page.keyboard.press('Escape');
  await expect(kinaSheet).toBeHidden();

  // Punctuation opens nothing.
  await page.locator('[data-sentence="0"]').getByText('.', { exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // A new, guessed word: save it.
  const kavu = page.locator('[data-sentence="0"] [data-token="2"]');
  await expect(kavu).toHaveAttribute('data-status', 'unknown');
  await kavu.click();
  const sheet = page.getByRole('dialog', { name: 'kávu' });
  await expect(sheet.getByRole('note')).toHaveText(m.t('sheet.guess'));
  const request = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/notes') && r.method() === 'POST',
  );
  await sheet.getByRole('button', { name: m.t('sheet.save'), exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body).toMatchObject({
    kind: 'word',
    source: 'reader',
    context: { sentenceSk: 'Mám rád kávu.', blank: { start: 8, end: 12 } },
  });
  await expect(kavu).toHaveAttribute('data-status', 'learning');
  await expect(page.getByText('“kávu” is in your deck.', { exact: true })).toBeVisible();

  // Phrase capture: two words of a sentence, with an edited meaning.
  await page.locator('[data-sentence="1"] [data-token="2"]').click();
  await page
    .getByRole('dialog', { name: 'do' })
    .getByRole('button', { name: m.t('sheet.selectPhrase') })
    .click();
  const bar = page.getByTestId('phrase-bar');
  await expect(bar).toContainText(m.t('phrase.hint'));
  await kina.click();
  await expect(bar).toContainText('2 words: do kina');
  await bar.getByRole('button', { name: m.t('phrase.save') }).click();
  const phraseSheet = page.getByRole('dialog', { name: m.t('phrase.sheetTitle') });
  await phraseSheet.getByLabel(m.t('phrase.meaning')).fill('to the cinema');
  const phraseRequest = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/notes') && r.method() === 'POST',
  );
  await phraseSheet.getByRole('button', { name: m.t('phrase.save') }).click();
  expect((await phraseRequest).postDataJSON()).toMatchObject({
    kind: 'phrase',
    content: { textSk: 'do kina', glossEn: 'to the cinema' },
  });
  await expect(bar).toBeHidden();

  // After a reload the word keeps its colour.
  await page.reload();
  await expect(page.getByRole('heading', { name: TITLE, level: 2 })).toBeVisible();
  await expect(page.locator('[data-sentence="0"] [data-token="2"]')).toHaveAttribute(
    'data-status',
    'learning',
  );
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});

test('a long text stays light in the DOM while scrolling', async ({ page }) => {
  const errors = watchErrors(page);
  const sentences = Array.from({ length: 450 }, (_, i) =>
    i % 2 === 0 ? 'Bývam v Bratislave.' : 'Dnes idem do kina.',
  ).join(' ');
  await page.goto('/read/import');
  await page.getByLabel(m.t('import.bodyLabel')).fill(sentences);
  await page.getByRole('button', { name: m.t('import.submit') }).click();
  const text = page.getByRole('region', { name: m.t('reader.textLabel') });
  await expect(text).toBeVisible({ timeout: 15_000 });
  const count = () => page.locator('[data-token]').count();
  expect(await count()).toBeLessThan(600);
  await page.mouse.wheel(0, 20_000);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.locator('[data-sentence="449"]')).toBeAttached({ timeout: 5_000 });
  expect(await count()).toBeLessThan(600);
  await expect(page.locator('[data-sentence="0"]')).toHaveCount(0);
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});
