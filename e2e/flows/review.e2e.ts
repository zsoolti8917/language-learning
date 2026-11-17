// Flow 2: a review session with sync. Words the learner chose to learn become cards; the
// session grades on the phone, answers part of it offline, and the outbox sends every answer
// to the API once the connection returns. The server's schedule then matches what was answered.
import type { ReviewItem } from '@app/contracts';
import type { Page, Request } from '@playwright/test';
import { expect, noSidewaysScroll, onboard, test } from '../src/fixtures';

/** The queue item a prompt on screen shows: sentence before the gap, a space, the rest. */
function itemOf(items: ReviewItem[], prompt: string): ReviewItem | undefined {
  return items.find((i) => {
    const { sentenceSk, blank } = i.prompt;
    const shown = `${sentenceSk.slice(0, blank.start)} ${sentenceSk.slice(blank.end)}`;
    return shown === prompt;
  });
}

async function answer(page: Page, items: ReviewItem[], right: boolean): Promise<string> {
  const field = page.getByRole('textbox', { name: 'Your answer' });
  const prompt = page.getByTestId('prompt');
  const text = (await prompt.textContent()) ?? '';
  const item = itemOf(items, text);
  expect(item, `no queue item shows "${text}"`).toBeDefined();
  await field.fill(right ? (item?.answers[0] ?? '') : 'zzz');
  await field.press('Enter');
  await expect(page.getByText(right ? 'Correct' : 'Wrong', { exact: true })).toBeVisible();
  // Enter again accepts the default rating (Good after a right answer, Again after a wrong one).
  await field.press('Enter');
  await expect(prompt.or(page.getByText('Done for now'))).toBeVisible();
  if (await prompt.isVisible()) await expect(prompt).not.toHaveText(text);
  return item?.cardId ?? '';
}

test('review session: answers graded on the phone, sent through the outbox, stored by the API', async ({
  page,
  context,
  api,
}) => {
  await onboard(api);
  // Four common words to learn: each becomes a word note with a new card.
  const words = await api.call('words.list', { query: { band: 0, status: 'unknown', limit: 4 } });
  expect(words.body.items).toHaveLength(4);
  const triage = await api.call('words.triage', {
    body: { decisions: words.body.items.map((w) => ({ lemmaId: w.lemmaId, decision: 'learn' })) },
  });
  expect(triage.body.notesCreated).toBe(4);

  const queueSeen = page.waitForResponse(
    (r) => r.url().includes('/api/v1/review/queue') && r.status() === 200,
  );
  await page.goto('/review');
  const items = ((await (await queueSeen).json()) as { items: ReviewItem[] }).items;
  expect(items).toHaveLength(4);
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  await expect(page.getByTestId('left')).toHaveText('4 left');
  await noSidewaysScroll(page);

  const batches: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/review/answers')) batches.push(req);
  });

  // Online: one right answer, sent at once.
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
  const first = await answer(page, items, true);
  expect((await sent).status()).toBe(200);

  // Offline: two answers wait in the outbox.
  await context.setOffline(true);
  await expect(page.getByTestId('sync-line')).toContainText('Offline');
  const second = await answer(page, items, false);
  const third = await answer(page, items, true);
  await noSidewaysScroll(page);
  expect(batches).toHaveLength(1);

  // Back online: one batch with both answers, and the outbox empties.
  const synced = page.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
  await context.setOffline(false);
  const res = await synced;
  expect(res.status()).toBe(200);
  const body = res.request().postDataJSON() as {
    answers: { cardId: string; clientGrade: string }[];
  };
  expect(body.answers.map((a) => [a.cardId, a.clientGrade])).toEqual([
    [second, 'wrong'],
    [third, 'correct'],
  ]);
  await expect(page.getByTestId('sync-line')).toHaveCount(0);
  expect(batches).toHaveLength(2);

  // The server stored the three reviews with its own grades.
  for (const [cardId, grade] of [
    [first, 'correct'],
    [second, 'wrong'],
    [third, 'correct'],
  ] as const) {
    const item = items.find((i) => i.cardId === cardId);
    const note = await api.call('notes.get', { params: { id: item?.noteId ?? '' } });
    expect(note.body.reviews.map((r) => r.grade)).toEqual([grade]);
    expect(note.body.card?.reps).toBe(1);
  }

  // The last new card, then the cards in their learning steps come back until the session ends.
  await answer(page, items, true);
  await expect.poll(() => batches.length).toBe(3);
  let more = 0;
  while (!(await page.getByText('Done for now').isVisible()) && more < 12) {
    await answer(page, items, true);
    more++;
  }
  await expect(page.getByText('Done for now')).toBeVisible();
  await expect.poll(() => batches.length).toBe(3 + more);
  await expect(page.getByTestId('sync-line')).toHaveCount(0);

  // A new queue from the server holds no card answered today as new.
  const queue = await api.call('review.queue', { query: { limit: 50 } });
  expect(queue.body.counts.new).toBe(0);
  expect(queue.body.items.every((i) => i.state !== 'new')).toBe(true);
});

test('deck: search, report from a card, suspend, edit and delete a note', async ({
  page,
  api,
}) => {
  await onboard(api);
  const words = await api.call('words.list', { query: { band: 0, status: 'unknown', limit: 3 } });
  await api.call('words.triage', {
    body: { decisions: words.body.items.map((w) => ({ lemmaId: w.lemmaId, decision: 'learn' })) },
  });
  const notes = (await api.call('notes.list', { query: { kind: 'word' } })).body.items;
  expect(notes).toHaveLength(3);

  // A report from the review card goes to the API.
  await page.goto('/review');
  await expect(page.getByTestId('left')).toHaveText('3 left');
  await page.getByRole('button', { name: 'Report a problem' }).click();
  await page.getByLabel('What is wrong?').fill('The English sentence reads oddly.');
  const reported = page.waitForResponse((r) => r.url().endsWith('/api/v1/reports'));
  await page.getByRole('button', { name: 'Send report' }).click();
  expect((await reported).status()).toBe(201);

  // The deck lists the three notes; a search narrows it.
  await page.getByRole('link', { name: 'Deck' }).click();
  await expect(page.getByRole('heading', { name: 'Deck', level: 1 })).toBeVisible();
  const list = page.getByRole('list', { name: 'Deck' });
  await expect(list.getByRole('link')).toHaveCount(3);
  const target = notes[0];
  const label = target?.label ?? '';
  await page.getByLabel('Search notes').fill(label);
  await expect(list.getByRole('link').first()).toContainText(label);
  await noSidewaysScroll(page);

  // The note: suspend, then resume.
  await page.goto(`/deck/${target?.id}`);
  await expect(page.getByRole('heading', { name: 'Note', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await page.getByRole('button', { name: 'Suspend' }).click();
  await expect(page.getByText('Suspended. This note stays out of the review queue.')).toBeVisible();
  let detail = await api.call('notes.get', { params: { id: target?.id ?? '' } });
  expect(detail.body.note.suspended).toBe(true);
  expect((await api.call('review.queue', { query: { limit: 50 } })).body.items).toHaveLength(2);
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByRole('button', { name: 'Suspend' })).toBeVisible();
  detail = await api.call('notes.get', { params: { id: target?.id ?? '' } });
  expect(detail.body.note.suspended).toBe(false);

  // Edit the meaning.
  await page.getByRole('button', { name: 'Edit' }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit note' });
  await sheet.getByLabel('Meaning in English').fill('my own meaning');
  const patched = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/notes/${target?.id}`) && r.request().method() === 'PATCH',
  );
  await sheet.getByRole('button', { name: 'Save' }).click();
  expect((await patched).status()).toBe(200);
  await expect(page.getByText('my own meaning').first()).toBeVisible();

  // Delete it: it leaves the deck and the queue.
  await page.getByRole('button', { name: 'Delete' }).click();
  const deleted = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/notes/${target?.id}`) && r.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: 'Delete note' }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole('heading', { name: 'Deck', level: 1 })).toBeVisible();
  expect((await api.call('notes.list', { query: { kind: 'word' } })).body.items).toHaveLength(2);
  expect((await api.call('review.queue', { query: { limit: 50 } })).body.items).toHaveLength(2);
});
