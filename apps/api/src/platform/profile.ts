// Creates the profile row on a learner's first call. Every learner table references
// `app.profile`, so the row must exist before any module writes.
import { type Database, profile } from '@app/db';

export interface ProfileGuard {
  /** Inserts the learner's profile with the defaults unless it exists. */
  ensure(userId: string): Promise<void>;
  /** Forgets that the learner has a profile (after `DELETE /me`). */
  forget(userId: string): void;
}

const MAX_KNOWN = 10_000;

export function createProfileGuard(database: Database): ProfileGuard {
  const known = new Set<string>();
  return {
    async ensure(userId) {
      if (known.has(userId)) return;
      await database.withUser(userId, (tx) =>
        tx.insert(profile).values({ userId }).onConflictDoNothing(),
      );
      if (known.size >= MAX_KNOWN) known.clear();
      known.add(userId);
    },
    forget(userId) {
      known.delete(userId);
    },
  };
}
