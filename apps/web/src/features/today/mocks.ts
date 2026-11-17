// Mock handler of Today (M1), ahead of the default example.
// `localStorage['m1.mockToday']` = 'fresh' | 'middle' | 'done' picks a variant. Without it, a
// stored mock profile on its first run (no placement, see features/account/mocks.ts) gets the
// fresh variant; everything else falls through to the contract example.
// Imports msw and lib only, never src/mocks/handlers (which imports this file).
import type { Profile } from '@app/contracts';
import { type HttpHandler, HttpResponse, http } from 'msw';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';
import { TODAY_VARIANTS, type TodayVariant } from './fixtures';

export const MOCK_TODAY_KEY = 'm1.mockToday';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const base = env.apiBase.replace(/\/$/, '');
const path = `${base}${ENDPOINT_META['profile.today'].path}`;

export const handlers: HttpHandler[] = [
  http.get(/^https?:\/\//.test(base) ? path : `*${path}`, () => {
    const variant = read(MOCK_TODAY_KEY);
    if (variant && variant in TODAY_VARIANTS) {
      return HttpResponse.json(TODAY_VARIANTS[variant as TodayVariant]);
    }
    const raw = read('m1.mockProfile');
    const profile = raw ? (JSON.parse(raw) as Profile) : null;
    if (profile && !profile.placementDoneAt) return HttpResponse.json(TODAY_VARIANTS.fresh);
    return undefined;
  }),
];
