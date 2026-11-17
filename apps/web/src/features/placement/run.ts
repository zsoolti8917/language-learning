// The placement run on this device: which run, which round, the answers given so far. It is
// kept in the local database after every answer, so a reload in the middle resumes the run.
import type { PlacementItem, PlacementResult, PlacementRound, Profile } from '@app/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { apiKey, apiQuery } from '../../lib/api';
import { PROFILE_KV_KEY } from '../../lib/auth/profile';
import { type AppDb, db, kvDelete, kvGet, kvSet } from '../../lib/db';

/** Three vocabulary rounds and one case round (docs/contracts.md, "Placement"). */
export const ROUND_COUNT = 4;

export const RUN_KV_KEY = 'placement.run';

export interface ItemAnswer {
  choice?: number;
  typed?: string;
}

export interface SavedRun {
  runId: string;
  round?: PlacementRound;
  /** Index of the item on screen in `round.items`. */
  index: number;
  answers: Record<string, ItemAnswer>;
  result?: PlacementResult;
}

export function loadRun(database: AppDb = db): Promise<SavedRun | undefined> {
  return kvGet<SavedRun>(RUN_KV_KEY, database).catch(() => undefined);
}

export function saveRun(run: SavedRun, database: AppDb = db): Promise<void> {
  return kvSet(RUN_KV_KEY, run, database).catch(() => {});
}

export function clearRun(database: AppDb = db): Promise<void> {
  return kvDelete(RUN_KV_KEY, database).catch(() => {});
}

/** Share of the whole check done, from 0 to 1, for the progress bar across the rounds. */
export function progressOf(round: number, index: number, items: number): number {
  const inRound = items > 0 ? Math.min(index, items) / items : 0;
  return Math.min(1, Math.max(0, (round - 1 + inRound) / ROUND_COUNT));
}

/** The answers of a round in item order. An item without an answer is sent as unanswered. */
export function roundAnswers(items: PlacementItem[], answers: Record<string, ItemAnswer>) {
  return items.map((item) => {
    const a = answers[item.itemId] ?? {};
    return item.kind === 'vocab'
      ? {
          itemId: item.itemId,
          choice: a.choice ?? item.options.length - 1,
        }
      : { itemId: item.itemId, typed: a.typed ?? '' };
  });
}

/**
 * The server applies the result in the same request: it sets `placement_done_at` and the
 * start lesson on the profile. The client writes the same into its cached profile (query
 * cache and local database), so the first run guard lets the learner through at once, and
 * marks it stale so the next read comes from the server.
 */
export async function markPlacementDone(
  queryClient: QueryClient,
  result: PlacementResult,
  now: () => Date = () => new Date(),
): Promise<Profile | undefined> {
  const key = apiKey('profile.get');
  let profile = queryClient.getQueryData<Profile>(key);
  if (!profile) {
    profile = await queryClient.fetchQuery(apiQuery('profile.get')).catch(() => undefined);
  }
  let next: Profile | undefined;
  if (profile) {
    next = {
      ...profile,
      placementDoneAt: profile.placementDoneAt ?? now().toISOString(),
      currentLessonId: result.startLessonId,
    };
    queryClient.setQueryData(key, next);
    await kvSet(PROFILE_KV_KEY, next).catch(() => {});
  }
  await Promise.all(
    ['profile.get', 'profile.today', 'words.bands', 'words.list', 'declension.course'].map((n) =>
      queryClient.invalidateQueries({ queryKey: ['api', n], refetchType: 'none' }),
    ),
  );
  return next;
}
