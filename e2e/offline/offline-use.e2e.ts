// Offline use (I4): review, the case trainer, the reader and word sorting, each loaded online
// once, then used with no connection (the shell from the service worker, the data from the
// local database), and synced to the real API when the connection returns.
import type { ExerciseItem } from '@app/contracts';
import { solve } from '../src/exercises';
import { expect, noSidewaysScroll, onboard } from '../src/fixtures';
import {
  answerCard,
  answersIn,
  learnWords,
  localQueue,
  openReview,
  outboxRows,
  readStore,
  recordAnswerBatches,
  setOnline,
  swControls,
  test,
} from './support';

test('review offline: reload with no connection, answer, sync later', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  await learnWords(api, 3);
  await openReview(page);
  await swControls(page);
  await openReview(page);
  const batches = recordAnswerBatches(page);

  // No connection: the app opens from the service worker, the queue from the device.
  await setOnline(context, false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  await expect(page.getByTestId('sync-line')).toContainText('Offline');
  await expect(page.getByTestId('left')).toHaveText('3 left');
  const items = await localQueue(page);
  expect(items).toHaveLength(3);
  const answered = [
    await answerCard(page, items, true),
    await answerCard(page, items, false),
    await answerCard(page, items, true),
  ];
  await noSidewaysScroll(page);
  expect(batches).toHaveLength(0);
  // The three answers wait as one batch (each is stored just after the screen moves on).
  await expect.poll(async () => answersIn((await outboxRows(page))[0])).toBe(3);
  const rows = await outboxRows(page);
  expect(rows.map((r) => [r.name, r.status])).toEqual([['review.submitAnswers', 'pending']]);

  // The connection returns: one batch, the server's card states replace the local ones.
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
  await setOnline(context, true);
  expect((await synced).status()).toBe(200);
  await expect.poll(() => outboxRows(page)).toEqual([]);
  expect(batches.map((b) => b.map((a) => a.cardId))).toEqual([answered]);
  for (const cardId of answered) {
    const item = items.find((i) => i.cardId === cardId);
    const note = await api.call('notes.get', { params: { id: item?.noteId ?? '' } });
    expect(note.body.card?.reps).toBe(1);
    const local = (
      await readStore<{ cardId: string; dueAt: string; state: string }>(page, 'reviewQueue')
    ).find((r) => r.cardId === cardId);
    expect(local?.dueAt).toBe(note.body.card?.dueAt);
    expect(local?.state).toBe(note.body.card?.state);
  }
});

test('trainer offline: a fetched session is answered and reloaded offline, then saved', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  await page.goto('/cases/train');
  await expect(page.getByRole('heading', { name: 'Trainer', level: 1 })).toBeVisible();
  await swControls(page);
  await expect(page.getByRole('heading', { name: 'Trainer', level: 1 })).toBeVisible();
  const started = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/declension/sessions') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const items = ((await (await started).json()) as { items: ExerciseItem[] }).items;
  expect(items.length).toBeGreaterThanOrEqual(5);
  const sent: { exerciseId: string; retry: boolean }[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/declension/attempts'))
      sent.push(...(req.postDataJSON() as { attempts: typeof sent }).attempts);
  });

  await setOnline(context, false);
  const half = Math.floor(items.length / 2);
  for (const [i, item] of items.slice(0, half).entries()) {
    await expect(page.getByTestId('trainer-progress')).toHaveText(`${i + 1} / ${items.length}`);
    await solve(page, item, true);
  }
  // The app is closed and opened again with no connection: the run goes on where it was.
  // (Once the last answer is stored: the run is written to the device after each item.)
  await expect
    .poll(async () => {
      const kv = await readStore<{ key: string; value: { results?: unknown[] } }>(page, 'kv');
      return kv.find((r) => r.key === 'cases.trainer.run')?.value.results?.length;
    })
    .toBe(half);
  await page.reload();
  await expect(page.getByText(`${half} of ${items.length} items done.`)).toBeVisible();
  await page.getByRole('button', { name: 'Resume the session' }).click();
  await expect(page.getByTestId('trainer-progress')).toHaveText(`${half + 1} / ${items.length}`);
  for (const [i, item] of items.slice(half).entries()) {
    await expect(page.getByTestId('trainer-progress')).toHaveText(
      `${half + i + 1} / ${items.length}`,
    );
    await solve(page, item, true);
  }
  await expect(page.getByTestId('trainer-summary')).toBeVisible();
  await expect(page.getByTestId('sync-state')).not.toHaveText('All answers are saved.');
  expect(sent).toHaveLength(0);
  expect((await outboxRows(page)).every((r) => r.status === 'pending')).toBe(true);

  await setOnline(context, true);
  await expect(page.getByTestId('sync-state')).toHaveText('All answers are saved.');
  await expect.poll(() => outboxRows(page)).toEqual([]);
  expect(sent.map((a) => a.exerciseId).sort()).toEqual(items.map((i) => i.exerciseId).sort());
  const mastery = (await api.call('declension.course')).body.mastery;
  expect(mastery.reduce((n, b) => n + b.attempts, 0)).toBe(items.length);
});

test('reader offline: an opened text reads offline, a status set offline syncs later', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  await page.goto('/read/import');
  await expect(page.getByRole('heading', { name: 'Import a text', level: 1 })).toBeVisible();
  await page.getByLabel('Title (optional)').fill('Kino');
  await page.getByLabel('Slovak text').fill('Mám rád kávu. Dnes idem do kina.');
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Kino', level: 2 })).toBeVisible({
    timeout: 60_000,
  });
  const textId = new URL(page.url()).pathname.split('/').pop() ?? '';
  await swControls(page);
  await expect(page.getByRole('heading', { name: 'Kino', level: 2 })).toBeVisible();

  await setOnline(context, false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Kino', level: 2 })).toBeVisible();
  await expect(page.getByText('Offline copy')).toBeVisible();
  const kina = page.locator('[data-sentence="1"] [data-token="3"]');
  await kina.click();
  const sheet = page.getByRole('dialog', { name: 'kina' });
  await expect(sheet.getByTestId('trigger')).toHaveText('After “do” comes the genitive.');
  await sheet.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(kina).toHaveAttribute('data-status', 'known');
  const rows = await outboxRows(page);
  expect(rows.map((r) => [r.name, r.status])).toContainEqual(['lemmas.setStatus', 'pending']);

  // The library shows the opened text while offline.
  await page.goto('/read');
  await expect(
    page.getByText('You are offline. These are the texts you opened before.'),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Kino/ })).toBeVisible();

  const statusSet = page.waitForResponse(
    (r) => /\/api\/v1\/lemmas\/\d+\/status$/.test(r.url()) && r.request().method() === 'PUT',
  );
  await setOnline(context, true);
  expect((await statusSet).status()).toBe(200);
  await expect.poll(() => outboxRows(page)).toEqual([]);
  const detail = await api.call('texts.get', { params: { id: textId } });
  const lemmaId = detail.body.analysis?.sentences[1]?.tokens[3]?.l;
  expect(lemmaId).toBeDefined();
  expect((await api.call('lemmas.get', { params: { id: lemmaId as number } })).body.status).toBe(
    'known',
  );
});

test('word sorting offline: decisions wait and reach the server on reconnect', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  const band = (await api.call('words.bands')).body.bands[0];
  await page.goto('/words/band/0');
  await expect(page.getByRole('heading', { name: 'Word band', level: 1 })).toBeVisible();
  await swControls(page);
  await page.getByRole('button', { name: 'Sort new words' }).click();
  await expect(page.getByText(`0 of ${band?.unknown}`)).toBeVisible();
  const posted: { lemmaId: number; decision: string }[][] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/words/triage'))
      posted.push((req.postDataJSON() as { decisions: (typeof posted)[number] }).decisions);
  });

  await setOnline(context, false);
  const choices = ['Known', 'Learn', 'Known', 'Ignore', 'Learn'];
  for (const [i, choice] of choices.entries()) {
    await page.getByRole('button', { name: choice, exact: true }).click();
    await expect(page.getByText(`${i + 1} of ${band?.unknown}`)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('button', { name: 'Sort new words' })).toBeVisible();
  await expect
    .poll(async () => (await outboxRows(page)).map((r) => [r.name, r.status]))
    .toEqual([['words.triage', 'pending']]);
  expect(posted).toHaveLength(0);

  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/words/triage'));
  await setOnline(context, true);
  expect((await sent).status()).toBe(200);
  await expect.poll(() => outboxRows(page)).toEqual([]);
  expect(posted.flat().map((d) => d.decision)).toEqual([
    'known',
    'learn',
    'known',
    'ignored',
    'learn',
  ]);
  const after = (await api.call('words.bands')).body.bands[0];
  expect(after?.known).toBe((band?.known ?? 0) + 2);
  expect(after?.learning).toBe((band?.learning ?? 0) + 2);
  expect(after?.unknown).toBe((band?.unknown ?? 0) - 5);
});
