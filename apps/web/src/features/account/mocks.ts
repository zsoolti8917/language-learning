// Mock handlers of M1 (picked up by src/mocks/handlers.ts, ahead of the defaults).
// A profile that remembers `PATCH /me`: the saved profile lives in localStorage under
// `MOCK_PROFILE_KEY`, so onboarding and settings survive a reload on the mock server.
// Without a stored profile `GET /me` falls through to the contract example.
// A browser test may seed it (a fresh account: `settings: {}`, `placementDoneAt: null`).
//
// This file imports msw and lib only, never src/mocks/handlers (which imports this file).
import { examples, type Profile, type UpdateProfile } from '@app/contracts';
import { type HttpHandler, HttpResponse, http } from 'msw';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';

export const MOCK_PROFILE_KEY = 'm1.mockProfile';

const EXAMPLE_PROFILE = examples['profile.get'].ok[0]?.response.body as Profile;

function pattern(name: keyof typeof ENDPOINT_META): string {
  const b = env.apiBase.replace(/\/$/, '');
  const path = `${b}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(b) ? path : `*${path}`;
}

export function readMockProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(MOCK_PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

function writeMockProfile(p: Profile | null) {
  try {
    if (p) localStorage.setItem(MOCK_PROFILE_KEY, JSON.stringify(p));
    else localStorage.removeItem(MOCK_PROFILE_KEY);
  } catch {
    // No storage: the change lasts for this answer only.
  }
}

export const handlers: HttpHandler[] = [
  // Returning nothing passes the request on to the default handler.
  http.get(pattern('profile.get'), () => {
    const stored = readMockProfile();
    return stored ? HttpResponse.json(stored) : undefined;
  }),
  http.patch(pattern('profile.update'), async ({ request }) => {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as UpdateProfile;
    const next: Profile = {
      ...(readMockProfile() ?? EXAMPLE_PROFILE),
      ...body,
    } as Profile;
    writeMockProfile(next);
    return HttpResponse.json(next);
  }),
  http.delete(pattern('profile.delete'), () => {
    writeMockProfile(null);
    return undefined;
  }),
];
