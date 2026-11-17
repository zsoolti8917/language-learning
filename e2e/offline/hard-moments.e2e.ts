// The hard moments of sync (I4): the app closed while a batch is on its way, a batch that
// reaches the server twice, a login that expired while the learner was offline, and one write
// the server refuses while the others go through.
import type { Request } from '@playwright/test';
import { type ApiClient, expect, onboard } from '../src/fixtures';
import {
  addOutboxRow,
  answerCard,
  answersIn,
  learnWords,
  localQueue,
  openReview,
  outboxRows,
  setOnline,
  swControls,
  test,
} from './support';

/** Every card answered once: the server holds one review per card. */
async function expectOneReviewEach(api: ApiClient, noteIds: string[]) {
  for (const id of noteIds) {
    const note = await api.call('notes.get', { params: { id } });
    expect(note.body.reviews, `reviews of note ${id}`).toHaveLength(1);
    expect(note.body.card?.reps).toBe(1);
  }
}

test('the app closed in the middle of a sync sends the batch again, stored once', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  await learnWords(api, 2);
  await openReview(page);
  const items = await localQueue(page);

  // The server gets the batch, but its answer never reaches the page, which is then closed.
  let arrived = 0;
  await page.route('**/api/v1/review/answers', async (route) => {
    await route.fetch();
    arrived++;
    // No answer: the page closes while the request is still open.
  });
  const cardId = await answerCard(page, items, true);
  await expect.poll(() => arrived).toBe(1);
  await expect.poll(async () => (await outboxRows(page)).map((r) => r.status)).toEqual(['sending']);
  await page.close();

  // Opened again: the half sent batch goes out again, and the server skips what it has.
  const again = await context.newPage();
  const resent: Request[] = [];
  again.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/review/answers')) resent.push(req);
  });
  const synced = again.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
  await again.goto('/review');
  expect((await synced).status()).toBe(200);
  await expect.poll(() => outboxRows(again)).toEqual([]);
  expect(resent).toHaveLength(1);
  const body = resent[0]?.postDataJSON() as { answers: { cardId: string }[] };
  expect(body.answers.map((a) => a.cardId)).toEqual([cardId]);
  const noteId = items.find((i) => i.cardId === cardId)?.noteId ?? '';
  await expectOneReviewEach(api, [noteId]);
});

test('a batch that reaches the server twice is stored once', async ({ page, context, api }) => {
  await onboard(api);
  await learnWords(api, 2);
  await openReview(page);
  const items = await localQueue(page);

  // Every batch is delivered twice (a retry after a lost answer, a proxy repeating it). The
  // page gets the answer to the repeat.
  let batches = 0;
  const answeredByServer: string[] = [];
  await page.route('**/api/v1/review/answers', async (route) => {
    await route.fetch();
    const second = await route.fetch();
    batches++;
    // The repeat still answers every answer with the card's state, which the page applies.
    const body = (await second.json()) as { results: { cardId: string }[] };
    answeredByServer.push(...body.results.map((r) => r.cardId));
    await route.fulfill({ response: second });
  });
  await setOnline(context, false);
  const answered = [await answerCard(page, items, true), await answerCard(page, items, false)];
  await setOnline(context, true);
  await expect.poll(() => outboxRows(page)).toEqual([]);
  expect(batches).toBeGreaterThanOrEqual(1);
  expect([...answeredByServer].sort()).toEqual([...answered].sort());
  await expect.poll(() => outboxRows(page)).toEqual([]);
  await expectOneReviewEach(
    api,
    answered.map((c) => items.find((i) => i.cardId === c)?.noteId ?? ''),
  );
});

test('a login that expired while offline keeps the answers until the learner is back', async ({
  page,
  context,
  api,
  learner,
  watch,
}) => {
  await onboard(api);
  await learnWords(api, 2);
  await openReview(page);
  await swControls(page);
  await openReview(page);
  const items = await localQueue(page);
  // Answer batches sent without a login (there must be none).
  const withoutLogin: string[] = [];
  page.on('request', (req) => {
    if (
      req.method() === 'POST' &&
      req.url().endsWith('/api/v1/review/answers') &&
      !req.headers().authorization
    )
      withoutLogin.push(req.url());
  });

  await setOnline(context, false);
  const answered = [await answerCard(page, items, true), await answerCard(page, items, true)];
  await expect.poll(async () => answersIn((await outboxRows(page))[0])).toBe(2);

  // Meanwhile the login expired: every API call answers 401 and no refresh helps.
  watch.allow(/status of 401/);
  await context.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'unauthorized', message: 'The login expired.' } }),
    }),
  );
  await setOnline(context, true);
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  // Signed out of the page, but the answers wait on the device.
  const rows = await outboxRows(page);
  expect(rows.map((r) => [r.name, r.status])).toEqual([['review.submitAnswers', 'pending']]);
  expect(answersIn(rows[0])).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('app.devSession'))).toBeNull();
  // While nobody is signed in, nothing is sent and nothing is dropped, also across a restart.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
  await page.waitForTimeout(1000);
  expect(withoutLogin).toEqual([]);
  expect((await outboxRows(page)).map((r) => [r.name, r.status])).toEqual([
    ['review.submitAnswers', 'pending'],
  ]);

  // The same learner signs in again: the answers go out under the new login.
  await context.unroute('**/api/v1/**');
  await page.evaluate(
    (l) =>
      localStorage.setItem(
        'app.devSession',
        JSON.stringify({
          userId: l.id,
          email: 'learner@example.test',
          accessToken: l.token,
          expiresAt: null,
        }),
      ),
    learner,
  );
  const synced = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/review/answers') && r.status() === 200,
  );
  await page.goto('/');
  await synced;
  await expect.poll(() => outboxRows(page)).toEqual([]);
  await expectOneReviewEach(
    api,
    answered.map((c) => items.find((i) => i.cardId === c)?.noteId ?? ''),
  );
});

test('one write the server refuses is shown with retry and discard; the others go through', async ({
  page,
  context,
  api,
  watch,
}) => {
  await onboard(api);
  await learnWords(api, 2);
  await openReview(page);
  const items = await localQueue(page);

  await setOnline(context, false);
  // A word status for a word the server does not know: it answers 404 for this one item.
  await addOutboxRow(page, 'lemmas.setStatus', {
    params: { id: 987654321 },
    body: { status: 'known' },
  });
  const answered = [await answerCard(page, items, true), await answerCard(page, items, true)];
  await expect
    .poll(async () => (await outboxRows(page)).map((r) => [r.name, answersIn(r)]))
    .toEqual([
      ['lemmas.setStatus', 0],
      ['review.submitAnswers', 2],
    ]);

  watch.allow(/status of 404/);
  const refused = page.waitForResponse((r) => /\/lemmas\/987654321\/status$/.test(r.url()));
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
  await setOnline(context, true);
  expect((await refused).status()).toBe(404);
  expect((await synced).status()).toBe(200);
  await expectOneReviewEach(
    api,
    answered.map((c) => items.find((i) => i.cardId === c)?.noteId ?? ''),
  );

  // The refused item is visible, with its reason.
  const notice = page.getByRole('region', { name: 'Not saved' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Word status');
  await expect(notice).toContainText('The server said:');
  expect((await outboxRows(page)).map((r) => [r.name, r.status])).toEqual([
    ['lemmas.setStatus', 'failed'],
  ]);

  // Try again: refused again, still shown.
  const retried = page.waitForResponse((r) => /\/lemmas\/987654321\/status$/.test(r.url()));
  await notice.getByRole('button', { name: 'Try again: Word status' }).click();
  expect((await retried).status()).toBe(404);
  await expect(notice).toBeVisible();
  await expect
    .poll(async () => (await outboxRows(page)).map((r) => [r.status, r.attempts]))
    .toEqual([['failed', 2]]);

  // Discard: gone from the device and from the screen.
  await notice.getByRole('button', { name: 'Discard: Word status' }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => outboxRows(page)).toEqual([]);
});
