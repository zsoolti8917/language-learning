import { useSyncExternalStore } from 'react';
import { api, hasLogin } from '../api';
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
  canOpenLocalDatabase,
  checkLocalDatabase,
  claimLocalData,
  type LocalDatabaseState,
  OWNER_KV_KEY,
  type PersistResult,
  requestPersistentStorage,
  resetLocalDatabaseCheck,
  useLocalDatabase,
} from './storage';
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
export const outbox = new Outbox({ api, canSend: hasLogin });

/** Outbox counts for an indicator, and a manual sync. */
export function useOutbox(target: Outbox = outbox): OutboxState & {
  syncNow: Outbox['syncNow'];
} {
  const state = useSyncExternalStore(target.subscribe, target.getState, target.getState);
  return { ...state, syncNow: (o) => target.syncNow(o) };
}
