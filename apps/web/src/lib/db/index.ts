import { useSyncExternalStore } from 'react';
import { api } from '../api';
import { Outbox, type OutboxState } from './outbox';

export {
  AppDb,
  clearLocalData,
  db,
  type KvRow,
  kvDelete,
  kvGet,
  kvSet,
  type LemmaStatusRow,
  type OutboxRow,
  type OutboxStatus,
  type QueueRow,
  type TextRow,
} from './db';
export {
  type EnqueueOptions,
  type FlushReport,
  Outbox,
  type OutboxOptions,
  type OutboxState,
  registerApplier,
  registerMerger,
} from './outbox';
export {
  applyCardSnapshots,
  applyTextSummary,
  getLemmaStatus,
  getReviewQueue,
  getStoredText,
  replaceReviewQueue,
  setLemmaStatuses,
  storeText,
} from './store';

/** The app's outbox over the shared client and database. `main.tsx` starts its triggers. */
export const outbox = new Outbox({ api });

/** Outbox counts for an indicator, and a manual sync. */
export function useOutbox(target: Outbox = outbox): OutboxState & {
  syncNow: Outbox['syncNow'];
} {
  const state = useSyncExternalStore(target.subscribe, target.getState, target.getState);
  return { ...state, syncNow: (o) => target.syncNow(o) };
}
