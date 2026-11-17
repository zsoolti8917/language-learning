import { describe, expect, it } from 'vitest';
import { freshDb } from '../../test/utils';
import { kvGet, kvSet } from './db';
import {
  canOpenLocalDatabase,
  claimLocalData,
  OWNER_KV_KEY,
  requestPersistentStorage,
} from './storage';

describe('local database check', () => {
  it('opens a working database', async () => {
    expect(await canOpenLocalDatabase(freshDb())).toBe(true);
  });

  it('reports a database the browser refuses', async () => {
    const database = freshDb();
    database.open = () => Promise.reject(new Error('blocked')) as never;
    expect(await canOpenLocalDatabase(database)).toBe(false);
  });
});

describe('persistent storage', () => {
  it('asks once, and only when not persisted yet', async () => {
    let asked = 0;
    const storage = (persisted: boolean, grant: boolean) => ({
      persisted: async () => persisted,
      persist: async () => {
        asked++;
        return grant;
      },
    });
    expect(await requestPersistentStorage(storage(true, true))).toBe('persisted');
    expect(asked).toBe(0);
    expect(await requestPersistentStorage(storage(false, true))).toBe('granted');
    expect(await requestPersistentStorage(storage(false, false))).toBe('denied');
    expect(asked).toBe(2);
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(
      await requestPersistentStorage({
        persisted: async () => {
          throw new Error('x');
        },
        persist: async () => true,
      }),
    ).toBe('unsupported');
  });
});

describe('local rows belong to one learner', () => {
  it('keeps the rows of the same learner and removes another learner’s', async () => {
    const database = freshDb();
    expect(await claimLocalData('a', database)).toBe(false);
    expect(await kvGet(OWNER_KV_KEY, database)).toBe('a');
    await kvSet('review.clientId', 'device', database);
    await database.outbox.add({
      id: 'x',
      name: 'reports.create',
      input: {} as never,
      createdAt: '2026-11-17T08:00:00.000Z',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
    });

    // The same learner after an expired login: everything stays.
    expect(await claimLocalData('a', database)).toBe(false);
    expect(await database.outbox.count()).toBe(1);

    // Someone else signs in on this device: the rows go, the new owner is recorded.
    expect(await claimLocalData('b', database)).toBe(true);
    expect(await database.outbox.count()).toBe(0);
    expect(await kvGet('review.clientId', database)).toBeUndefined();
    expect(await kvGet(OWNER_KV_KEY, database)).toBe('b');
  });
});
