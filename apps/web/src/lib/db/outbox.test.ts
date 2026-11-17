import {
  type CardSnapshot,
  examples,
  type ReviewAnswer,
  type ReviewQueue,
  type SubmitAnswersResult,
} from '@app/contracts';
import { HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mockEndpoint, server, testOutbox } from '../../test/utils';
import { newId } from '../ids';
import type { Outbox } from './outbox';
import { getLemmaStatus, getReviewQueue, replaceReviewQueue } from './store';

const QUEUE = examples['review.queue'].ok[0]?.response.body as ReviewQueue;
const ITEM = QUEUE.items[0] as ReviewQueue['items'][number];
const SNAPSHOT = examples['review.submitAnswers'].ok[0]?.response.body?.results[0]
  ?.card as CardSnapshot;

function answer(cardId = ITEM.cardId, typed = 'mesta'): ReviewAnswer {
  return {
    id: newId(),
    cardId,
    answeredAt: '2026-11-17T08:00:00.000Z',
    typed,
    variant: 0,
    clientGrade: 'correct',
    rating: 3,
    overridden: false,
    durationMs: 1000,
  };
}

/**
 * A small server for `POST /review/answers` and `PUT /lemmas/:id/status` that remembers what
 * it stored, skips answers it already has (as the real API does) and logs each request.
 */
function fakeServer() {
  const stored = new Map<string, ReviewAnswer>();
  const log: { name: string; ids: string[] }[] = [];
  let failNext: 'network' | 'lostResponse' | 'server' | null = null;
  server.use(
    mockEndpoint('review.submitAnswers', ({ body }) => {
      const mode = failNext;
      failNext = null;
      if (mode === 'network') return HttpResponse.error();
      log.push({ name: 'review.submitAnswers', ids: body.answers.map((a) => a.id) });
      if (mode === 'server') {
        return HttpResponse.json({ error: { code: 'internal', message: 'x' } }, { status: 500 });
      }
      for (const a of body.answers) if (!stored.has(a.id)) stored.set(a.id, a);
      if (mode === 'lostResponse') return HttpResponse.error();
      const result: SubmitAnswersResult = {
        results: body.answers.map((a) => ({
          id: a.id,
          cardId: a.cardId,
          grade: 'correct',
          rating: a.rating,
          card: { ...SNAPSHOT, cardId: a.cardId, state: 'review', reps: SNAPSHOT.reps + 1 },
        })),
        counts: { due: 0, new: 0, learning: 0 },
      };
      return result;
    }),
    mockEndpoint('lemmas.setStatus', ({ params, body }) => {
      log.push({ name: `lemmas.setStatus:${params.id}`, ids: [] });
      if (params.id === '13') {
        return HttpResponse.json({ error: { code: 'internal', message: 'x' } }, { status: 503 });
      }
      if (params.id === '404') {
        return HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 });
      }
      return { lemmaId: Number(params.id), status: body.status };
    }),
  );
  return {
    stored,
    log,
    fail: (mode: typeof failNext) => {
      failNext = mode;
    },
  };
}

let online = true;
let clock = 1_000_000;
let box: Outbox;

beforeEach(() => {
  online = true;
  clock = 1_000_000;
  box = testOutbox({ isOnline: () => online, now: () => clock, backoff: () => 10_000 });
});
afterEach(() => box.db.close());

const submit = (answers: ReviewAnswer[], clientId = newId()) =>
  box.enqueue('review.submitAnswers', { body: { clientId, answers } }, { merge: false });

describe('outbox', () => {
  it('keeps items while offline and sends them in order once online', async () => {
    const srv = fakeServer();
    online = false;
    const a = [answer(), answer(), answer()];
    for (const x of a) await submit([x]);
    await box.enqueue('lemmas.setStatus', { params: { id: 20 }, body: { status: 'known' } });

    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'offline' });
    expect(srv.log).toEqual([]);
    expect(await box.list()).toHaveLength(4);
    expect(box.getState().pending).toBe(4);

    online = true;
    expect(await box.flush()).toMatchObject({ sent: 4 });
    expect(srv.log.map((l) => l.ids[0] ?? l.name)).toEqual([
      a[0]?.id,
      a[1]?.id,
      a[2]?.id,
      'lemmas.setStatus:20',
    ]);
    expect(await box.list()).toEqual([]);
    expect(box.getState()).toMatchObject({ pending: 0, failed: 0, syncing: false });
  });

  it('waits when the network fails mid way and resumes from the same item', async () => {
    const srv = fakeServer();
    const a = [answer(), answer()];
    await submit([a[0] as ReviewAnswer]);
    await submit([a[1] as ReviewAnswer]);
    srv.fail('network');
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'network' });
    const waiting = await box.list();
    expect(waiting.map((r) => r.attempts)).toEqual([0, 0]);
    expect(await box.flush()).toMatchObject({ sent: 2 });
    expect(srv.log.flatMap((l) => l.ids)).toEqual([a[0]?.id, a[1]?.id]);
  });

  it('a repeated send is harmless: a lost answer is sent again and stored once', async () => {
    const srv = fakeServer();
    await replaceReviewQueue(QUEUE, box.db);
    const x = answer();
    await submit([x]);
    srv.fail('lostResponse');
    await box.flush();
    expect(srv.stored.size).toBe(1);
    expect(await box.list()).toHaveLength(1);

    await box.flush();
    expect(srv.log).toHaveLength(2);
    expect(srv.stored.size).toBe(1);
    expect(await box.list()).toEqual([]);

    // Two flushes at once send each item once.
    await submit([answer()]);
    await Promise.all([box.flush(), box.flush(), box.syncNow()]);
    expect(srv.log).toHaveLength(3);
  });

  it('retries a failing item later without blocking the ones after it', async () => {
    const srv = fakeServer();
    await box.enqueue('lemmas.setStatus', { params: { id: 13 }, body: { status: 'known' } });
    await box.enqueue('lemmas.setStatus', { params: { id: 20 }, body: { status: 'known' } });
    await box.enqueue('lemmas.setStatus', { params: { id: 404 }, body: { status: 'known' } });
    await box.enqueue('lemmas.setStatus', { params: { id: 21 }, body: { status: 'ignored' } });

    expect(await box.flush()).toMatchObject({ sent: 2, retrying: 1, failed: 1 });
    expect(srv.log.map((l) => l.name)).toEqual([
      'lemmas.setStatus:13',
      'lemmas.setStatus:20',
      'lemmas.setStatus:404',
      'lemmas.setStatus:21',
    ]);
    const rows = await box.list();
    expect(rows.map((r) => [r.status, r.attempts, r.lastError?.code])).toEqual([
      ['pending', 1, 'internal'],
      ['failed', 1, 'not_found'],
    ]);
    expect(box.getState()).toMatchObject({ pending: 1, failed: 1 });

    // Not due yet: nothing is sent.
    await box.flush();
    expect(srv.log).toHaveLength(4);
    // After the backoff it goes again (and fails again, so it waits longer).
    clock += 10_000;
    await box.flush();
    expect(srv.log).toHaveLength(5);
    expect((await box.list())[0]?.attempts).toBe(2);

    // A manual sync retries refused items too.
    await box.syncNow({ includeFailed: true });
    expect(srv.log.at(-1)?.name).toBe('lemmas.setStatus:404');
  });

  it('applies the server answer over local state', async () => {
    fakeServer();
    await replaceReviewQueue(QUEUE, box.db);
    await submit([answer()]);
    await box.enqueue('lemmas.setStatus', { params: { id: 20 }, body: { status: 'known' } });
    await box.flush();
    const { items } = await getReviewQueue(box.db);
    expect(items.find((i) => i.cardId === ITEM.cardId)).toMatchObject({
      state: 'review',
      dueAt: SNAPSHOT.dueAt,
    });
    expect(await getLemmaStatus(20, box.db)).toBe('known');
  });

  it('merges waiting answers into one batch', async () => {
    const srv = fakeServer();
    online = false;
    const xs = [answer(), answer(), answer(), answer(), answer()];
    for (const x of xs) {
      await box.enqueue('review.submitAnswers', { body: { clientId: 'batch-1', answers: [x] } });
    }
    expect(await box.list()).toHaveLength(1);
    online = true;
    await box.flush();
    expect(srv.log).toEqual([{ name: 'review.submitAnswers', ids: xs.map((x) => x.id) }]);
    await box.flush();
    expect(srv.log).toHaveLength(1);
  });

  it('sends on its triggers: start, each new write, online, foreground', async () => {
    const srv = fakeServer();
    online = false;
    await submit([answer()]);
    const stop = box.start(window);
    // Start: offline, so nothing yet.
    await new Promise((r) => setTimeout(r, 20));
    expect(srv.log).toHaveLength(0);

    online = true;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => srv.log.length === 1);

    await submit([answer()]);
    await waitFor(() => srv.log.length === 2);

    online = false;
    await submit([answer()]);
    online = true;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => srv.log.length === 3);
    stop();
  });

  it('tries again by itself when the network fails although the device is online', async () => {
    const srv = fakeServer();
    box = testOutbox({ isOnline: () => true, networkRetry: () => 20 });
    await submit([answer()]);
    srv.fail('network');
    const stop = box.start(window);
    // The first run fails on the network; no event comes, the retry timer sends it.
    await waitFor(() => srv.log.length === 1);
    await waitFor(() => box.getState().pending === 0);
    expect(await box.list()).toEqual([]);
    stop();
  });

  it('waits while nobody is signed in, and sends once a login is back', async () => {
    const srv = fakeServer();
    let signedIn = false;
    box = testOutbox({
      isOnline: () => online,
      now: () => clock,
      backoff: () => 10_000,
      canSend: async () => signedIn,
    });
    await submit([answer()]);
    expect(await box.flush()).toMatchObject({ sent: 0, stopped: 'signedOut' });
    expect(srv.log).toEqual([]);
    expect((await box.list()).map((r) => [r.status, r.attempts])).toEqual([['pending', 0]]);
    signedIn = true;
    expect(await box.flush()).toMatchObject({ sent: 1 });
  });

  it('retries or discards one refused item, listed with its reason', async () => {
    const srv = fakeServer();
    await box.enqueue('lemmas.setStatus', { params: { id: 404 }, body: { status: 'known' } });
    await box.enqueue('lemmas.setStatus', { params: { id: 20 }, body: { status: 'known' } });
    await box.flush();
    const failed = await box.failedItems();
    expect(failed.map((r) => [r.name, r.lastError?.code])).toEqual([
      ['lemmas.setStatus', 'not_found'],
    ]);
    const seq = failed[0]?.seq as number;

    expect(await box.retry(seq)).toMatchObject({ sent: 0, failed: 1 });
    expect(srv.log.map((l) => l.name)).toEqual([
      'lemmas.setStatus:404',
      'lemmas.setStatus:20',
      'lemmas.setStatus:404',
    ]);
    expect((await box.failedItems())[0]?.attempts).toBe(2);

    await box.discard(seq);
    expect(await box.list()).toEqual([]);
    expect(box.getState()).toMatchObject({ pending: 0, failed: 0 });
  });

  it('sends again an item a closed page left half sent', async () => {
    const srv = fakeServer();
    const x = answer();
    await submit([x]);
    // The page closed while the request was out: the row is still `sending`.
    const [row] = await box.list();
    await box.db.outbox.update(row?.seq as number, { status: 'sending' });
    srv.stored.set(x.id, x);

    const stop = box.start(window);
    await waitFor(() => srv.log.length === 1);
    await waitFor(() => box.getState().pending === 0);
    expect(await box.list()).toEqual([]);
    expect(srv.stored.size).toBe(1);
    stop();
  });
});

async function waitFor(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
