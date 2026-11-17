// Reads and writes of the local tables. The rule: a server answer replaces local state.
import type {
  CardSnapshot,
  LemmaStatus,
  ReviewQueue,
  TextDetail,
  TextSummary,
} from '@app/contracts';
import { type AppDb, db, type QueueRow, type TextRow } from './db';

const QUEUE_META_KEY = 'reviewQueue.meta';

/** Stores a fetched queue in place of the old one, with its counts and server time. */
export async function replaceReviewQueue(queue: ReviewQueue, database: AppDb = db): Promise<void> {
  await database.transaction('rw', [database.reviewQueue, database.kv], async () => {
    await database.reviewQueue.clear();
    await database.reviewQueue.bulkPut(queue.items);
    await database.kv.put({
      key: QUEUE_META_KEY,
      value: { counts: queue.counts, serverTime: queue.serverTime },
    });
  });
}

export async function getReviewQueue(database: AppDb = db): Promise<{
  items: QueueRow[];
  meta: Pick<ReviewQueue, 'counts' | 'serverTime'> | undefined;
}> {
  const [items, meta] = await Promise.all([
    database.reviewQueue.toArray(),
    database.kv.get(QUEUE_META_KEY),
  ]);
  return { items, meta: meta?.value as Pick<ReviewQueue, 'counts' | 'serverTime'> | undefined };
}

/** Writes the server's card states over the local ones (after `POST /review/answers`). */
export async function applyCardSnapshots(
  cards: CardSnapshot[],
  database: AppDb = db,
): Promise<void> {
  await database.transaction('rw', database.reviewQueue, async () => {
    for (const c of cards) {
      await database.reviewQueue.update(c.cardId, {
        state: c.state,
        dueAt: c.dueAt,
        scheduler: c.scheduler,
      });
    }
  });
}

/** Keeps an opened text for offline reading; the server copy replaces the stored one. */
export async function storeText(text: TextDetail, database: AppDb = db): Promise<void> {
  await database.texts.put({ ...text, openedAt: new Date().toISOString() });
}

export function getStoredText(id: string, database: AppDb = db): Promise<TextRow | undefined> {
  return database.texts.get(id);
}

/** Merges a `TextSummary` answer (after `PATCH /texts/:id`) into the stored text. */
export async function applyTextSummary(summary: TextSummary, database: AppDb = db): Promise<void> {
  const row = await database.texts.get(summary.id);
  if (row) await database.texts.put({ ...row, ...summary });
}

export async function setLemmaStatuses(
  entries: { lemmaId: number; status: LemmaStatus }[],
  database: AppDb = db,
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await database.lemmaStatus.bulkPut(entries.map((e) => ({ ...e, updatedAt })));
}

export async function getLemmaStatus(
  lemmaId: number,
  database: AppDb = db,
): Promise<LemmaStatus | undefined> {
  return (await database.lemmaStatus.get(lemmaId))?.status;
}
