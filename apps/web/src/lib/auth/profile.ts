import type { Profile } from '@app/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { apiQuery } from '../api';
import { isApiError } from '../api/errors';
import { kvGet, kvSet } from '../db/db';

export const PROFILE_KV_KEY = 'profile';

/**
 * First run: the learner has not finished onboarding. Onboarding (M1) marks its end with
 * `PATCH /me { settings: { onboardedAt } }`; a learner with a placement result counts as done.
 */
export function isFirstRun(profile: Pick<Profile, 'settings' | 'placementDoneAt'>): boolean {
  return !profile.settings?.onboardedAt && !profile.placementDoneAt;
}

/**
 * The profile for the guards: `GET /me` through the query cache, kept in the local database so
 * the shell also opens offline. Null when offline on a device that never loaded it.
 */
export async function loadProfile(queryClient: QueryClient): Promise<Profile | null> {
  try {
    const profile = await queryClient.ensureQueryData(apiQuery('profile.get'));
    await kvSet(PROFILE_KV_KEY, profile).catch(() => {});
    return profile;
  } catch (e) {
    if (isApiError(e) && !e.isNetwork && e.status !== 0 && e.status < 500) throw e;
    return (await kvGet<Profile>(PROFILE_KV_KEY).catch(() => undefined)) ?? null;
  }
}
