// The offline review session (M2, "Done when"), at 390 x 844 against the mock server:
// load the queue, go offline, answer five cards, reload the app, reconnect. One batch with the
// five answers goes out, and a second sync sends nothing.
import { type BrowserContext, expect, type Page, type Request, test } from '@playwright/test';
import { m } from '../messages';

const DEV_USER = '0193a1b2-c3d4-7e5f-8a6b-000000000001';
const DEV_SESSION = {
  userId: DEV_USER,
  email: 'dev@example.test',
  accessToken: `dev:${DEV_USER}`,
  expiresAt: null,
};

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * The mock build has no app service worker (the mock worker owns the scope), so nothing
 * serves the shell on an offline reload. This stands in for it: every file of the app seen
 * online is kept and served again while the browser is offline. API calls are not touched;
 * the mock worker answers those.
 */
async function cacheShell(context: BrowserContext, offline: () => boolean) {
  const files = new Map<
    string,
    { status: number; headers: Record<string, string>; body: Buffer }
  >();
  await context.route(
    (url) => !url.pathname.startsWith('/api/'),
    async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      // A route of the app (no file extension) is the shell, whether the page or the mock
      // worker asks for it.
      const cacheKey = /\.[a-z0-9]+$/i.test(path) ? path : '/index.html';
      if (offline()) {
        const hit = files.get(cacheKey);
        if (hit) await route.fulfill(hit);
        else await route.abort('internetdisconnected');
        return;
      }
      const res = await route.fetch();
      if (req.method() === 'GET' && res.ok()) {
        files.set(cacheKey, {
          status: res.status(),
          headers: res.headers(),
          body: await res.body(),
        });
      }
      await route.fulfill({ response: res });
    },
  );
}

async function noSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(390);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** The answers in the outbox of the local database, read in the page. */
function outboxAnswers(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const open = indexedDB.open('slovak-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('outbox', 'readonly');
          const all = tx.objectStore('outbox').getAll();
          all.onsuccess = () => {
            const rows = all.result as { name: string; input: { body: { answers: unknown[] } } }[];
            resolve(
              rows
                .filter((r) => r.name === 'review.submitAnswers')
                .map((r) => r.input.body.answers.length),
            );
            open.result.close();
          };
        };
      }),
  );
}

test('answers five cards offline; one batch after reconnecting, nothing on a second sync', async ({
  page,
  context,
}) => {
  const errors = watchErrors(page);
  let offline = false;
  await cacheShell(context, () => offline);
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);

  const batches: Request[] = [];
  context.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/api/v1/review/answers')) batches.push(req);
  });

  // Online: the queue is fetched and stored on the device.
  await page.goto('/review');
  const field = page.getByLabel(m.messages.review.answerLabel);
  await expect(field).toBeVisible();
  await expect(
    page.getByRole('heading', { name: m.messages.review.title, level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId('left')).toHaveText(m.t('review.left', { count: 5 }));
  await noSidewaysScroll(page);

  // Offline: five answers, each graded on the phone and kept in the outbox.
  offline = true;
  await context.setOffline(true);
  await expect(page.getByTestId('sync-line')).toContainText(m.messages.review.offline);
  for (let i = 0; i < 5; i++) {
    const prompt = await page.getByTestId('prompt').textContent();
    await field.fill('zzz');
    await field.press('Enter');
    await expect(page.getByText(m.messages.states.wrong, { exact: true })).toBeVisible();
    await noSidewaysScroll(page);
    await field.press('Enter');
    await expect(page.getByTestId('prompt')).not.toHaveText(prompt ?? '');
  }
  await expect(page.getByTestId('left')).toHaveText(m.t('review.left', { count: 5 }));
  await expect.poll(() => outboxAnswers(page)).toEqual([5]);

  // Reload while offline: the stored queue opens, the answered cards are not due now.
  await page.reload();
  await expect(field).toBeVisible();
  await expect(page.getByTestId('sync-line')).toContainText(m.messages.review.pending);
  await expect(page.getByTestId('left')).toHaveText(m.t('review.left', { count: 5 }));
  expect(batches).toHaveLength(0);
  expect(await outboxAnswers(page)).toEqual([5]);

  // Reconnect: one batch with the five answers.
  offline = false;
  await context.setOffline(false);
  await expect.poll(() => batches.length).toBe(1);
  const body = batches[0]?.postDataJSON() as { answers: { clientGrade: string; rating: number }[] };
  expect(body.answers).toHaveLength(5);
  expect(body.answers.every((a) => a.clientGrade === 'wrong' && a.rating === 1)).toBe(true);
  await expect.poll(() => outboxAnswers(page)).toEqual([]);
  await expect(page.getByTestId('sync-line')).toHaveCount(0);

  // A second sync (the app starting again, which also syncs before fetching) sends nothing.
  await page.reload();
  await expect(field).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(500);
  expect(batches).toHaveLength(1);

  expect(errors).toEqual([]);
});

test('deck: filter and open a note, with no sideways scroll', async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript((s) => {
    localStorage.setItem('app.devSession', JSON.stringify(s));
  }, DEV_SESSION);
  await page.goto('/review');
  await page.getByRole('link', { name: m.messages.review.deckLink }).click();
  await expect(page.getByRole('heading', { name: m.messages.deck.title, level: 1 })).toBeVisible();
  const list = page.getByRole('list', { name: m.messages.deck.title });
  await expect(list.getByRole('link')).not.toHaveCount(0);
  await noSidewaysScroll(page);
  const word = page.getByRole('button', { name: m.messages.kinds.word, exact: true });
  await word.click();
  await expect(word).toHaveAttribute('aria-pressed', 'true');
  await list.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: m.messages.note.title, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: m.messages.note.schedule })).toBeVisible();
  await expect(page.getByRole('button', { name: m.messages.note.suspend })).toBeVisible();
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});
