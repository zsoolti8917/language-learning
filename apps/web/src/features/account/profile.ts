// The learner's profile for onboarding, settings and Today: `GET /me` and `PATCH /me`.
// A saved profile replaces the cached one, so the route guard sees it at once.
import type { Profile, UpdateProfile } from '@app/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiKey, apiQuery } from '../../lib/api';
import { PROFILE_KV_KEY } from '../../lib/auth';
import { kvSet } from '../../lib/db';

export function useProfile() {
  return useQuery(apiQuery('profile.get'));
}

/** Sends `PATCH /me` with exactly the given body and stores the answer. */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProfile) => api.profile.update({ body }),
    onSuccess: async (profile: Profile) => {
      queryClient.setQueryData(apiKey('profile.get'), profile);
      await kvSet(PROFILE_KV_KEY, profile).catch(() => {});
    },
  });
}

/** The free form settings object with one key changed, keeping the others. */
export function withSetting(profile: Pick<Profile, 'settings'>, key: string, value: unknown) {
  return { ...(profile.settings ?? {}), [key]: value };
}
