// The device's storage: whether the local database opens at all, persistent storage, and which
// learner the local rows belong to.
//
// - Private windows and blocked site data can leave IndexedDB missing or failing. The app then
//   still runs online, but nothing is kept for offline use and unsent writes cannot wait; the
//   shell says so (`StorageNotice` in lib/pwa/notices.tsx).
// - Browsers may evict IndexedDB under storage pressure unless the site asked for persistent
//   storage. The app asks once a learner is signed in (browsers grant it more readily then).
// - A sign out removes every row. A login that expires is not a sign out: the rows, and above
//   all the unsent writes, stay for the same learner, and go when someone else signs in.
import { useSyncExternalStore } from 'react';
import { type AppDb, clearLocalData, db, kvGet, kvSet } from './db';

// --- Is the local database usable? -------------------------------------------------------

export type LocalDatabaseState = 'checking' | 'ok' | 'unavailable';

/** Opens the database once; false when IndexedDB is missing, blocked or broken. */
export async function canOpenLocalDatabase(database: AppDb = db): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false;
    await database.open();
    return true;
  } catch {
    return false;
  }
}

let dbState: LocalDatabaseState = 'checking';
let dbCheck: Promise<void> | null = null;
const dbListeners = new Set<() => void>();

function setDbState(next: LocalDatabaseState) {
  if (next === dbState) return;
  dbState = next;
  for (const l of dbListeners) l();
}

/** Runs the check once per page (again after `resetLocalDatabaseCheck`, for tests). */
export function checkLocalDatabase(database: AppDb = db): Promise<void> {
  dbCheck ??= canOpenLocalDatabase(database).then((ok) => setDbState(ok ? 'ok' : 'unavailable'));
  return dbCheck;
}

export function resetLocalDatabaseCheck(): void {
  dbCheck = null;
  setDbState('checking');
}

/** `ok`, `unavailable`, or `checking` until the first open finished. */
export function useLocalDatabase(database: AppDb = db): LocalDatabaseState {
  return useSyncExternalStore(
    (l) => {
      dbListeners.add(l);
      void checkLocalDatabase(database);
      return () => dbListeners.delete(l);
    },
    () => dbState,
    () => dbState,
  );
}

// --- Persistent storage --------------------------------------------------------------------

export type PersistResult = 'persisted' | 'granted' | 'denied' | 'unsupported';

type StorageManagerLike = Pick<StorageManager, 'persist' | 'persisted'>;

/**
 * Asks the browser to keep the local database under storage pressure. `persisted` when it
 * already was, `granted` or `denied` for a new answer, `unsupported` without the API.
 */
export async function requestPersistentStorage(
  storage: StorageManagerLike | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator.storage,
): Promise<PersistResult> {
  if (!storage?.persist || !storage.persisted) return 'unsupported';
  try {
    if (await storage.persisted()) return 'persisted';
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

// --- Whose rows these are -------------------------------------------------------------------

/** The kv key that names the learner the local rows belong to. */
export const OWNER_KV_KEY = 'auth.owner';

/**
 * Makes the local rows the given learner's: rows of another learner (left by a login that
 * expired) are removed first. Returns true when rows were removed.
 */
export async function claimLocalData(userId: string, database: AppDb = db): Promise<boolean> {
  const owner = await kvGet<string>(OWNER_KV_KEY, database);
  let cleared = false;
  if (owner !== undefined && owner !== userId) {
    await clearLocalData(database);
    cleared = true;
  }
  if (owner !== userId) await kvSet(OWNER_KV_KEY, userId, database);
  return cleared;
}
