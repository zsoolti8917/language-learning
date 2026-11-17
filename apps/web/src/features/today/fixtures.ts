// Three `GET /today` answers for tests and the mock server: a fresh account, the middle of the
// course (the contract example) and a learner who did everything for the day.
import { examples, type Profile, type Today } from '@app/contracts';

export const EXAMPLE_PROFILE = examples['profile.get'].ok[0]?.response.body as Profile;

/** Just signed up and onboarded: no placement, nothing learned. */
export const FRESH_PROFILE: Profile = {
  ...EXAMPLE_PROFILE,
  displayName: null,
  settings: {},
  placementDoneAt: null,
  currentLessonId: null,
};

export const TODAY_MIDDLE = examples['profile.today'].ok[0]?.response.body as Today;

export const TODAY_FRESH: Today = {
  date: TODAY_MIDDLE.date,
  review: { due: 0, new: 0, learning: 0 },
  continueText: null,
  nextLesson: {
    id: 'acc-sg',
    titleEn: 'Accusative singular',
    titleSk: 'Akuzatív jednotného čísla',
    status: 'available',
  },
  weakBuckets: [],
  tutorSuggestion: null,
  words: { band: 0, fromRank: 1, toRank: 500, total: 500, known: 0, learning: 0, target: 1000 },
};

export const TODAY_DONE: Today = {
  ...TODAY_MIDDLE,
  review: { due: 0, new: 0, learning: 0 },
  continueText: null,
};

export const TODAY_VARIANTS = {
  fresh: TODAY_FRESH,
  middle: TODAY_MIDDLE,
  done: TODAY_DONE,
} as const;
export type TodayVariant = keyof typeof TODAY_VARIANTS;
