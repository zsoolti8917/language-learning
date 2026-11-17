// Updates (I4): a new service worker is found, the app prompts, Reload activates it and reloads
// the page, and the answers still waiting in the outbox survive and are sent afterwards.
//
// The test serves the same client build from a small server of its own (another origin, so the
// other tests never see the new version) that proxies /api to the API, and can append a few
// bytes to sw.js: a byte change is what makes the browser install a new worker.
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import type { Page } from '@playwright/test';
import { API_URL, expect, onboard } from '../src/fixtures';
import {
  answerCard,
  learnWords,
  localQueue,
  openReview,
  outboxRows,
  setOnline,
  swControls,
  test,
} from './support';

/** Appended to sw.js for the new version: it answers with its name when asked. */
const NEXT_VERSION = `
self.addEventListener('message', (event) => {
  if (event.data === 'e2e:version' && event.ports[0]) event.ports[0].postMessage('next');
});
`;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const HOP_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'keep-alive',
]);

/** Serves `dist` like `vite preview` (index.html for unknown paths) and proxies /api. */
async function serveBuild(
  dist: string,
  swSuffix: () => string,
): Promise<{ origin: string; server: Server }> {
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers))
          if (typeof v === 'string' && !HOP_HEADERS.has(k)) headers.set(k, v);
        const upstream = await fetch(`${API_URL}${url.pathname}${url.search}`, {
          method: req.method ?? 'GET',
          headers,
          ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
        });
        const out: Record<string, string> = {};
        upstream.headers.forEach((v, k) => {
          if (!HOP_HEADERS.has(k)) out[k] = v;
        });
        res.writeHead(upstream.status, out);
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
      let file = join(dist, path);
      let data: Buffer;
      try {
        data = await readFile(file);
      } catch {
        file = join(dist, 'index.html');
        data = await readFile(file);
      }
      if (path === '/sw.js') data = Buffer.concat([data, Buffer.from(swSuffix())]);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      res.end(data);
    })().catch((e) => {
      res.writeHead(502);
      res.end(String(e));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { origin: `http://127.0.0.1:${port}`, server };
}

/** Asks the worker that controls the page for its version ('next' for the new one). */
function controllerVersion(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const controller = navigator.serviceWorker.controller;
        if (!controller) return resolve('none');
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => resolve(String(e.data));
        controller.postMessage('e2e:version', [channel.port2]);
        setTimeout(() => resolve('first'), 2000);
      }),
  );
}

test('a new version prompts, reloads into the new worker, and keeps the outbox', async ({
  page,
  context,
  api,
  watch,
}) => {
  const dist = process.env.E2E_DIST_DIR;
  test.skip(!dist, 'run through `pnpm e2e:offline`, which names the build folder');
  let next = false;
  const { origin, server } = await serveBuild(dist as string, () => (next ? NEXT_VERSION : ''));
  try {
    await onboard(api);
    await learnWords(api, 2);
    await openReview(page, `${origin}/review`);
    await swControls(page);
    await openReview(page, `${origin}/review`);
    expect(await controllerVersion(page)).toBe('first');
    const items = await localQueue(page);

    // An answer that has not reached the server yet; it stays unsent while the update runs.
    watch.allow(/ERR_FAILED|ERR_INTERNET_DISCONNECTED/);
    await page.route('**/api/v1/review/answers', (route) => route.abort('internetdisconnected'));
    await setOnline(context, false);
    const cardId = await answerCard(page, items, true);
    await setOnline(context, true);
    await expect
      .poll(async () => (await outboxRows(page)).map((r) => r.status))
      .toEqual(['pending']);

    // The server now has a new sw.js; the app checks for it (as on start or focus).
    next = true;
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    });
    const prompt = page.getByRole('region', { name: 'A new version is ready' });
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    await expect(prompt).toContainText('Your answers are saved.');
    expect((await outboxRows(page)).map((r) => r.status)).toEqual(['pending']);

    // Reload: the waiting worker takes over and the page reloads under it.
    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await prompt.getByRole('button', { name: 'Reload' }).click();
    await reloaded;
    await expect(page.getByRole('heading', { name: 'Review', level: 1 })).toBeVisible();
    await expect.poll(() => controllerVersion(page), { timeout: 30_000 }).toBe('next');
    await expect(page.getByRole('region', { name: 'A new version is ready' })).toHaveCount(0);

    // The outbox survived the update and goes out once the server is reachable.
    expect((await outboxRows(page)).map((r) => r.name)).toEqual(['review.submitAnswers']);
    await page.unroute('**/api/v1/review/answers');
    const synced = page.waitForResponse(
      (r) => r.url().endsWith('/api/v1/review/answers') && r.status() === 200,
    );
    await setOnline(context, false);
    await setOnline(context, true);
    await synced;
    await expect.poll(() => outboxRows(page)).toEqual([]);
    const noteId = items.find((i) => i.cardId === cardId)?.noteId ?? '';
    const note = await api.call('notes.get', { params: { id: noteId } });
    expect(note.body.reviews).toHaveLength(1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
