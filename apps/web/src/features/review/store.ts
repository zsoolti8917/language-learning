// The review queue on the device (docs/architecture.md, "Sync"): fetched into the local
// database, answered offline, each answer kept in the outbox until the server takes it.
import type { QueueCounts, ReviewItem } from '@app/contracts';
import { type ApiClient, api as defaultApi, isApiError } from '../../lib/api';
import {
  type AppDb,
  db as defaultDb,
  outbox as defaultOutbox,
  getReviewQueue,
  kvGet,
  kvSet,
  type Outbox,
  replaceReviewQueue,
} from '../../lib/db';
import { newId } from '../../lib/ids';
import { type AnsweredCard, type Consumed, consumedBy } from './session';

/** How many cards one fetch asks for. */
export const QUEUE_LIMIT = 200;

const CONSUMED_KEY = 'review.consumed';
const CLIENT_ID_KEY = 'review.clientId';

export interface ReviewDeps {
  db: AppDb;
  outbox: Outbox;
  api: Pick<ApiClient, 'review'>;
  isOnline: () => boolean;
}

export const defaultDeps: ReviewDeps = {
  db: defaultDb,
  outbox: defaultOutbox,
  api: defaultApi,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
};

export interface LoadedQueue {
  items: ReviewItem[];
  counts: QueueCounts | undefined;
  consumed: Consumed;
  /** Where the cards came from: a fresh fetch, or the copy on the device. */
  source: 'server' | 'local';
}

export type LoadError = 'offline' | 'failed';

export class QueueLoadError extends Error {
  constructor(readonly reason: LoadError) {
    super(reason);
  }
}

async function readLocal(deps: ReviewDeps): Promise<LoadedQueue> {
  const [{ items, meta }, consumed] = await Promise.all([
    getReviewQueue(deps.db),
    kvGet<Consumed>(CONSUMED_KEY, deps.db),
  ]);
  return {
    items,
    counts: meta?.counts,
    consumed: consumed ?? { new: 0, due: 0 },
    source: 'local',
  };
}

async function answersWaiting(deps: ReviewDeps): Promise<boolean> {
  const rows = await deps.db.outbox.where('name').equals('review.submitAnswers').toArray();
  return rows.some((r) => r.status !== 'failed');
}

/**
 * Loads the queue for a session. Online, the outbox goes first, so the server knows every
 * answer, then a fresh queue replaces the stored one. Offline, or while answers still wait,
 * the stored queue is used: fetching then would bring back cards already answered here.
 */
export async function loadQueue(deps: ReviewDeps = defaultDeps): Promise<LoadedQueue> {
  if (deps.isOnline()) {
    try {
      await deps.outbox.syncNow();
      if (!(await answersWaiting(deps))) {
        const queue = await deps.api.review.queue({ query: { limit: QUEUE_LIMIT } });
        await replaceReviewQueue(queue, deps.db);
        await kvSet(CONSUMED_KEY, { new: 0, due: 0 }, deps.db);
        return {
          items: queue.items,
          counts: queue.counts,
          consumed: { new: 0, due: 0 },
          source: 'server',
        };
      }
    } catch (e) {
      const local = await readLocal(deps);
      if (local.items.length > 0) return local;
      throw new QueueLoadError(isApiError(e) && e.isNetwork ? 'offline' : 'failed');
    }
  }
  const local = await readLocal(deps);
  if (local.items.length === 0 && local.counts === undefined) {
    throw new QueueLoadError(deps.isOnline() ? 'failed' : 'offline');
  }
  return local;
}

/** A stable id of this device's answer batches. */
export async function clientId(deps: ReviewDeps = defaultDeps): Promise<string> {
  const known = await kvGet<string>(CLIENT_ID_KEY, deps.db);
  if (known) return known;
  const id = `web-${newId()}`;
  await kvSet(CLIENT_ID_KEY, id, deps.db);
  return id;
}

/**
 * Stores one answer: the card's new state in the local queue, the cap counts, and the answer
 * in the outbox, where it merges with waiting answers into one batch.
 */
export async function recordAnswer(
  answered: AnsweredCard,
  deps: ReviewDeps = defaultDeps,
): Promise<void> {
  const { item, answer, before } = answered;
  const add = consumedBy(before);
  await deps.db.transaction('rw', [deps.db.reviewQueue, deps.db.kv], async () => {
    await deps.db.reviewQueue.update(item.cardId, {
      state: item.state,
      dueAt: item.dueAt,
      scheduler: item.scheduler,
    });
    if (add.new || add.due) {
      const prev = (await kvGet<Consumed>(CONSUMED_KEY, deps.db)) ?? { new: 0, due: 0 };
      await kvSet(
        CONSUMED_KEY,
        { new: prev.new + (add.new ?? 0), due: prev.due + (add.due ?? 0) },
        deps.db,
      );
    }
  });
  await deps.outbox.enqueue('review.submitAnswers', {
    body: { clientId: await clientId(deps), answers: [answer] },
  });
}
