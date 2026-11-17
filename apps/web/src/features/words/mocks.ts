// Mock answers of the words track (M5), built from the mini dataset so every band, list and
// word page has real Slovak forms. Statuses live in memory: a triage or a status change shows
// in the next list. `resetWordsMock()` puts the start state back (tests).
import type { LemmaDetail, LemmaStatus, WordBand, WordListItem } from '@app/contracts';
import { examples } from '@app/contracts';
import { readTags } from '@app/ling';
import { MINI_LEMMAS, type MiniLemma } from './mockData';
import { errorResponse, featureMock } from './mockHttp';

export const BAND_SIZE = 500;
const BAND_COUNT = 2;

/** A few words start known or learning, so the overview shows progress; the rest are new. */
const START_STATUS: Record<number, LemmaStatus> = {
  37: 'known', // ja
  42: 'known', // ten
  50: 'known', // v
  51: 'known', // na
  60: 'known', // byť
  68: 'known', // a
  69: 'known', // nie
  20: 'learning', // mesto
  6: 'learning', // dom
  12: 'learning', // kniha
};

const statuses = new Map<number, LemmaStatus>();

export function resetWordsMock(): void {
  statuses.clear();
  for (const [id, s] of Object.entries(START_STATUS)) statuses.set(Number(id), s);
}
resetWordsMock();

const statusOf = (id: number): LemmaStatus => statuses.get(id) ?? 'unknown';

/** The mini lemmas with a rank, in rank order. */
const RANKED = MINI_LEMMAS.filter((l) => l.freqRank !== null).sort(
  (a, b) => (a.freqRank ?? 0) - (b.freqRank ?? 0),
);

const bandOf = (l: MiniLemma) => Math.floor(((l.freqRank ?? 1) - 1) / BAND_SIZE);

function listItem(l: MiniLemma): WordListItem {
  return {
    lemmaId: l.id,
    lemma: l.lemma,
    pos: l.pos,
    rank: l.freqRank ?? 1,
    glossEn: l.senses[0]?.glossEn ?? null,
    status: statusOf(l.id),
    topForms: l.topForms,
  };
}

export function mockBands(): WordBand[] {
  return Array.from({ length: BAND_COUNT }, (_, band) => {
    const words = RANKED.filter((l) => bandOf(l) === band);
    const count = (s: LemmaStatus) => words.filter((l) => statusOf(l.id) === s).length;
    return {
      band,
      fromRank: band * BAND_SIZE + 1,
      toRank: (band + 1) * BAND_SIZE,
      total: words.length,
      known: count('known'),
      learning: count('learning'),
      unknown: count('unknown'),
    };
  });
}

const MESTO_NOTE_ID = (
  examples['lemmas.get'].ok[0] as unknown as { response: { body: { noteId: string } } }
).response.body.noteId;

export function mockLemmaDetail(id: number): LemmaDetail | null {
  const l = MINI_LEMMAS.find((x) => x.id === id);
  if (!l) return null;
  const nounGender = l.pos === 'noun' && l.gender ? l.gender : undefined;
  const status = statusOf(l.id);
  return {
    lemma: {
      id: l.id,
      key: l.key,
      lemma: l.lemma,
      pos: l.pos,
      gender: l.gender,
      pattern: l.pattern,
      aspect: l.aspect,
      freqRank: l.freqRank,
      topForms: l.topForms,
      flags: {},
    },
    senses: l.senses,
    forms: l.forms.map(([form, tags]) => ({ form, readings: readTags(tags, nounGender) })),
    sentences: l.sentences,
    status,
    noteId: l.id === 20 && status === 'learning' ? MESTO_NOTE_ID : null,
  };
}

const notFound = () => errorResponse('not_found', 'No such word.');

export const handlers = [
  featureMock('words.bands', () => ({ bands: mockBands() })),
  featureMock('words.list', ({ query }) => {
    const band = query.get('band');
    const status = query.get('status');
    const limit = Math.min(Number(query.get('limit') ?? 50) || 50, 200);
    const offset = Number(query.get('cursor') ?? 0) || 0;
    const all = RANKED.filter(
      (l) =>
        (band === null || bandOf(l) === Number(band)) &&
        (status === null || statusOf(l.id) === status),
    );
    const items = all.slice(offset, offset + limit).map(listItem);
    const next = offset + limit;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }),
  featureMock('words.triage', ({ body }) => {
    const decisions = body?.decisions ?? [];
    let notesCreated = 0;
    for (const d of decisions) {
      const status: LemmaStatus =
        d.decision === 'learn' ? 'learning' : d.decision === 'known' ? 'known' : 'ignored';
      if (status === 'learning' && statusOf(d.lemmaId) !== 'learning') notesCreated += 1;
      statuses.set(d.lemmaId, status);
    }
    return { updated: decisions.length, notesCreated };
  }),
  featureMock('lemmas.get', ({ params }) => mockLemmaDetail(Number(params.id)) ?? notFound()),
  featureMock('lemmas.setStatus', ({ params, body }) => {
    const lemmaId = Number(params.id);
    if (!MINI_LEMMAS.some((l) => l.id === lemmaId) || !body) return notFound();
    statuses.set(lemmaId, body.status);
    return { lemmaId, status: body.status };
  }),
];
