// Flow 8: export and deletion. A learner with some history downloads every row as JSON from
// Settings, then deletes the account (asked twice). The app signs out, and the API holds
// nothing of the learner any more: the next call starts a fresh profile.
import { readFile } from 'node:fs/promises';
import { ExportSchema } from '@app/contracts';
import { expect, noSidewaysScroll, onboard, test, uuidv7 } from '../src/fixtures';

test('export every row, then delete the account', async ({ page, api }) => {
  await onboard(api, 'Jana');
  // Some history: two words to learn, a pasted text, one answered card.
  const words = await api.call('words.list', { query: { band: 0, status: 'unknown', limit: 2 } });
  await api.call('words.triage', {
    body: { decisions: words.body.items.map((w) => ({ lemmaId: w.lemmaId, decision: 'learn' })) },
  });
  const textId = uuidv7();
  await api.call('texts.create', { body: { id: textId, title: 'Doma', body: 'Bývam v meste.' } });
  await expect
    .poll(async () => (await api.call('texts.get', { params: { id: textId } })).body.status)
    .toBe('ready');
  const queue = await api.call('review.queue', { query: { limit: 10 } });
  const item = queue.body.items[0];
  await api.call('review.submitAnswers', {
    body: {
      clientId: 'e2e',
      answers: [
        {
          id: uuidv7(),
          cardId: item?.cardId ?? '',
          answeredAt: new Date().toISOString(),
          typed: item?.answers[0] ?? '',
          variant: item?.variant ?? 0,
          clientGrade: 'correct',
          rating: 3,
          overridden: false,
          durationMs: 4000,
        },
      ],
    },
  });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await noSidewaysScroll(page);

  // Export: a JSON file with the profile and every learner table.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export my data' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^slovak-export-\d{4}-\d{2}-\d{2}\.json$/);
  const data = ExportSchema.parse(JSON.parse(await readFile((await file.path()) ?? '', 'utf8')));
  await expect(page.getByText('Your data is downloaded.', { exact: true })).toBeVisible();
  expect(data.profile.displayName).toBe('Jana');
  expect(data.tables.note).toHaveLength(2);
  expect(data.tables.card).toHaveLength(2);
  expect(data.tables.review).toHaveLength(1);
  expect(data.tables.text?.map((t) => t.id)).toEqual([textId]);
  expect(data.tables.userLemma?.length).toBeGreaterThanOrEqual(2);
  // Nothing of any other learner, and no user id column in the rows.
  for (const rows of Object.values(data.tables))
    for (const row of rows) expect(row).not.toHaveProperty('userId');

  // Deletion asks twice.
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('dialog', { name: 'Delete your account?' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog', { name: 'Are you sure?' })).toBeVisible();
  const deleted = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/me') && r.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Delete for good' }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('app.devSession'))).toBeNull();

  // The API holds nothing of the learner: a new call starts a fresh profile.
  const me = await api.call('profile.get');
  expect(me.body.displayName).toBeNull();
  expect(me.body.settings).toEqual({});
  const after = await api.call('profile.export');
  for (const [name, rows] of Object.entries(after.body.tables))
    expect(rows, `table ${name} after deletion`).toHaveLength(0);
  expect((await api.raw('texts.get', { params: { id: textId } })).status()).toBe(404);
});
