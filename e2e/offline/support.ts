// Helpers of the offline suite (I4): the service worker, the local database read from the
// page, and review answers on screen.
import type { ReviewItem } from '@app/contracts';
import { type BrowserContext, expect, type Page } from '@playwright/test';
import { type ApiClient, test as base } from '../src/fixtures';

/**
 * The flows' fixture (fresh learner, contract checks, console errors fail a test), where a
 * request the browser could not send because the test took the connection away is expected.
 */
export const test = base.extend<{ offlineRequestsAllowed: undefined }>({
  offlineRequestsAllowed: [
    async ({ watch }, use) => {
      watch.allow(/net::ERR_INTERNET_DISCONNECTED/);
      await use(undefined);
    },
    { auto: true },
  ],
});

/** The client's IndexedDB database (apps/web/src/lib/db/db.ts). */
export const DB_NAME = 'slovak-app';

export type StoreName = 'kv' | 'reviewQueue' | 'outbox' | 'texts' | 'lemmaStatus';

/** Every row of one table of the local database, read straight from IndexedDB. */
export function readStore<T = Record<string, unknown>>(page: Page, store: StoreName): Promise<T[]> {
  return page.evaluate(
    ([name, table]) =>
      new Promise<T[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          if (!database.objectStoreNames.contains(table)) {
            database.close();
            resolve([]);
            return;
          }
          const req = database.transaction(table, 'readonly').objectStore(table).getAll();
          req.onsuccess = () => {
            database.close();
            resolve(req.result as T[]);
          };
          req.onerror = () => {
            database.close();
            reject(req.error);
          };
        };
      }),
    [DB_NAME, store] as const,
  );
}

/** The outbox rows: name and status of each, in order. */
export async function outboxRows(page: Page) {
  const rows = await readStore<{
    seq: number;
    name: string;
    status: string;
    attempts: number;
    input: unknown;
    lastError?: { status: number; code: string };
  }>(page, 'outbox');
  return rows.sort((a, b) => a.seq - b.seq);
}

/** How many answers an outbox row of `review.submitAnswers` carries. */
export function answersIn(row: { input: unknown } | undefined): number {
  return (row?.input as { body?: { answers?: unknown[] } } | undefined)?.body?.answers?.length ?? 0;
}

/** Adds a row to the outbox as the client would (`Outbox.enqueue` without the merge). */
export function addOutboxRow(page: Page, name: string, input: unknown): Promise<void> {
  return page.evaluate(
    ([dbName, row]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const database = open.result;
          const tx = database.transaction('outbox', 'readwrite');
          tx.objectStore('outbox').add(row);
          tx.oncomplete = () => {
            database.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [
      DB_NAME,
      {
        id: crypto.randomUUID(),
        name,
        input,
        createdAt: new Date().toISOString(),
        status: 'pending',
        attempts: 0,
        nextAttemptAt: 0,
      },
    ] as const,
  );
}

/**
 * Waits until the service worker is active and controls the page, so the shell (and every
 * screen's code) opens offline from now on.
 */
export async function swControls(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {
      timeout: 60_000,
    })
    .toBe(true);
}

/** Goes offline and online the way a phone does: the context's network and the events. */
export async function setOnline(context: BrowserContext, online: boolean): Promise<void> {
  await context.setOffline(!online);
  // The pages see the change before the test goes on.
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    await expect.poll(() => p.evaluate(() => navigator.onLine).catch(() => online)).toBe(online);
  }
}

/** Makes `count` common words of the first band into word notes, each with a new card. */
export async function learnWords(api: ApiClient, count: number): Promise<void> {
  const words = await api.call('words.list', {
    query: { band: 0, status: 'unknown', limit: count },
  });
  expect(words.body.items).toHaveLength(count);
  const triage = await api.call('words.triage', {
    body: { decisions: words.body.items.map((w) => ({ lemmaId: w.lemmaId, decision: 'learn' })) },
  });
  expect(triage.body.notesCreated).toBe(count);
}

/** The review queue as the device holds it (what an offline session shows). */
export function localQueue(page: Page): Promise<ReviewItem[]> {
  return readStore<ReviewItem>(page, 'reviewQueue');
}

/** Opens the review screen and returns the queue the client fetched. */
export async function openReview(page: Page, url = '/review'): Promise<ReviewItem[]> {
  const queueSeen = page.waitForResponse(
    (r) => r.url().includes('/api/v1/review/queue') && r.status() === 200,
  );
  await page.goto(url);
  const items = ((await (await queueSeen).json()) as { items: ReviewItem[] }).items;
  await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
  return items;
}

/** The queue item a prompt on screen shows: sentence before the gap, a space, the rest. */
export function itemOf(items: ReviewItem[], prompt: string): ReviewItem | undefined {
  // Spaces around the gap may be no-break spaces on screen.
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return items.find((i) => {
    const { sentenceSk, blank } = i.prompt;
    return (
      norm(`${sentenceSk.slice(0, blank.start)} ${sentenceSk.slice(blank.end)}`) === norm(prompt)
    );
  });
}

/**
 * Answers the card on screen right or wrong and accepts the default rating (Good after a right
 * answer, Again after a wrong one). Returns the card id.
 */
export async function answerCard(page: Page, items: ReviewItem[], right: boolean): Promise<string> {
  const field = page.getByRole('textbox', { name: 'Your answer' });
  const prompt = page.getByTestId('prompt');
  await expect(prompt).toBeVisible();
  const text = (await prompt.textContent()) ?? '';
  const item = itemOf(items, text);
  expect(
    item,
    `no queue item shows ${JSON.stringify(text)}: ${JSON.stringify(items.map((i) => i.prompt))}`,
  ).toBeDefined();
  await field.fill(right ? (item?.answers[0] ?? '') : 'zzz');
  await field.press('Enter');
  await expect(page.getByText(right ? 'Correct' : 'Wrong', { exact: true })).toBeVisible();
  await field.press('Enter');
  // The next card (which may be the same one again, in its learning step) or the end.
  await expect(page.getByText(right ? 'Correct' : 'Wrong', { exact: true })).toHaveCount(0);
  await expect(prompt.or(page.getByText('Done for now'))).toBeVisible();
  if (await prompt.isVisible()) await expect(field).toHaveValue('');
  return item?.cardId ?? '';
}

/** Answers made on this page: every `POST /review/answers` body. */
export function recordAnswerBatches(page: Page): { cardId: string; id: string }[][] {
  const batches: { cardId: string; id: string }[][] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/review/answers'))
      batches.push((req.postDataJSON() as { answers: { cardId: string; id: string }[] }).answers);
  });
  return batches;
}
