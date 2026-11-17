// Two devices (I4): two browser contexts of the same learner answer the same card offline,
// one right and one wrong. The later answer reaches the server first; the older one then forces
// the server to replay the card's log in time order. After syncing, both devices hold the
// server's card state, identical on both sides and on the server.
import type { ReviewItem } from '@app/contracts';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, onboard } from '../src/fixtures';
import {
  answerCard,
  learnWords,
  localQueue,
  openReview,
  outboxRows,
  setOnline,
  test,
} from './support';

/** The card's state as one device stores it, in the fields both sides must agree on. */
function cardState(item: ReviewItem | undefined) {
  return item && { state: item.state, dueAt: item.dueAt, scheduler: item.scheduler };
}

test('two devices answer the same card offline and converge after syncing', async ({
  page,
  context,
  browser,
  api,
  learner,
}) => {
  // The second sync waits for the card's one minute learning step to come due.
  test.setTimeout(420_000);
  await onboard(api);
  await learnWords(api, 1);

  // Device B: a second browser context of the same learner, same phone size.
  const { baseURL, viewport, isMobile, hasTouch, deviceScaleFactor } = test.info().project.use;
  const contextB: BrowserContext = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    ...(viewport ? { viewport } : {}),
    ...(isMobile !== undefined ? { isMobile } : {}),
    ...(hasTouch !== undefined ? { hasTouch } : {}),
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
  });
  await contextB.addInitScript((l) => {
    localStorage.setItem(
      'app.devSession',
      JSON.stringify({
        userId: l.id,
        email: 'learner@example.test',
        accessToken: l.token,
        expiresAt: null,
      }),
    );
  }, learner);
  const pageB: Page = await contextB.newPage();

  try {
    // Both devices fetch the queue with the one new card.
    await openReview(page);
    await openReview(pageB);
    const [itemsA, itemsB] = [await localQueue(page), await localQueue(pageB)];
    expect(itemsA).toHaveLength(1);
    expect(itemsB.map((i) => i.cardId)).toEqual(itemsA.map((i) => i.cardId));
    const cardId = itemsA[0]?.cardId ?? '';
    const noteId = itemsA[0]?.noteId ?? '';

    // Both go offline. A answers right (Good) first; B answers wrong (Again) a little later.
    await setOnline(context, false);
    await setOnline(contextB, false);
    expect(await answerCard(page, itemsA, true)).toBe(cardId);
    await page.waitForTimeout(1500);
    expect(await answerCard(pageB, itemsB, false)).toBe(cardId);

    // B, with the later answer, syncs first.
    const syncedB = pageB.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
    await setOnline(contextB, true);
    expect((await syncedB).status()).toBe(200);
    await expect.poll(() => outboxRows(pageB)).toEqual([]);
    let note = await api.call('notes.get', { params: { id: noteId } });
    expect(note.body.reviews).toHaveLength(1);

    // A syncs its older answer: the server replays both in the order they were given.
    const syncedA = page.waitForResponse((r) => r.url().endsWith('/api/v1/review/answers'));
    await setOnline(context, true);
    expect((await syncedA).status()).toBe(200);
    await expect.poll(() => outboxRows(page)).toEqual([]);
    note = await api.call('notes.get', { params: { id: noteId } });
    // The log lists the newest first: B's wrong answer, then A's older right one.
    expect(note.body.reviews.map((r) => r.grade)).toEqual(['wrong', 'correct']);
    expect(note.body.card?.reps).toBe(2);
    const server = note.body.card;

    // Once the card comes due again, each device fetches the queue: both hold the server's state.
    let serverItem: ReviewItem | undefined;
    await expect
      .poll(
        async () => {
          const queue = await api.call('review.queue', { query: { limit: 50 } });
          serverItem = queue.body.items.find((i) => i.cardId === cardId);
          return serverItem !== undefined;
        },
        { timeout: 180_000, intervals: [5_000] },
      )
      .toBe(true);
    expect(serverItem?.dueAt).toBe(server?.dueAt);
    expect(serverItem?.state).toBe(server?.state);

    await openReview(page);
    await openReview(pageB);
    const onA = (await localQueue(page)).find((i) => i.cardId === cardId);
    const onB = (await localQueue(pageB)).find((i) => i.cardId === cardId);
    expect(cardState(onA)).toEqual(cardState(serverItem));
    expect(cardState(onB)).toEqual(cardState(serverItem));
    expect(cardState(onA)).toEqual(cardState(onB));
  } finally {
    await contextB.close();
  }
});
