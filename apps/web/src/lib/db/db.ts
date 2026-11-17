// The local database (docs/architecture.md, "State and offline"): five tables in IndexedDB.
import type { EndpointName, LemmaStatus, ReviewItem, TextDetail } from '@app/contracts';
import { Dexie, type EntityTable } from 'dexie';
import type { ApiInput } from '../api/client';

/** Small values the app keeps between visits: the cached profile, cursors, flags. */
export interface KvRow {
  key: string;
  value: unknown;
}

/** A card of the fetched review queue. The server's card state replaces the local one on sync. */
export type QueueRow = ReviewItem;

/** An opened text, kept for offline reading. */
export interface TextRow extends TextDetail {
  /** When the learner last opened it (ISO). */
  openedAt: string;
}

/** The learner's status of one lemma, as last known. */
export interface LemmaStatusRow {
  lemmaId: number;
  status: LemmaStatus;
  updatedAt: string;
}

export type OutboxStatus = 'pending' | 'sending' | 'failed';

/** One write waiting to be sent. `input` carries the ids the client made. */
export interface OutboxRow<N extends EndpointName = EndpointName> {
  /** Order of writes; sending follows it. */
  seq?: number;
  /** Client id of the outbox entry (not of the row it creates). */
  id: string;
  name: N;
  input: ApiInput<N>;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms; the item is not sent before. */
  nextAttemptAt: number;
  lastError?: { status: number; code: string; message: string };
}

export class AppDb extends Dexie {
  kv!: EntityTable<KvRow, 'key'>;
  reviewQueue!: EntityTable<QueueRow, 'cardId'>;
  outbox!: EntityTable<OutboxRow, 'seq'>;
  texts!: EntityTable<TextRow, 'id'>;
  lemmaStatus!: EntityTable<LemmaStatusRow, 'lemmaId'>;

  constructor(name = 'slovak-app') {
    super(name);
    this.version(1).stores({
      kv: 'key',
      reviewQueue: 'cardId, noteId, dueAt',
      outbox: '++seq, id, name, status',
      texts: 'id, openedAt',
      lemmaStatus: 'lemmaId, status',
    });
  }
}

/** The app's database. Tests make their own with `new AppDb(uniqueName)`. */
export const db = new AppDb();

export async function kvGet<T>(key: string, database: AppDb = db): Promise<T | undefined> {
  const row = await database.kv.get(key);
  return row?.value as T | undefined;
}

export async function kvSet(key: string, value: unknown, database: AppDb = db): Promise<void> {
  await database.kv.put({ key, value });
}

export async function kvDelete(key: string, database: AppDb = db): Promise<void> {
  await database.kv.delete(key);
}

/** Removes every learner row, for sign out and account deletion. */
export async function clearLocalData(database: AppDb = db): Promise<void> {
  await database.transaction(
    'rw',
    [database.kv, database.reviewQueue, database.outbox, database.texts, database.lemmaStatus],
    async () => {
      await Promise.all([
        database.kv.clear(),
        database.reviewQueue.clear(),
        database.outbox.clear(),
        database.texts.clear(),
        database.lemmaStatus.clear(),
      ]);
    },
  );
}
