// Mock answers of the placement check (M5): three vocabulary rounds of six words and one case
// round of eight typed gaps, graded like the server would. Words, glosses and sentences come
// from the mini dataset. Each run's state sits in sessionStorage (memory without it), so the
// browser keeps a run across a reload, as the real API does.
import type { PlacementItem, PlacementResult, PlacementRound, PlacementRun } from '@app/contracts';
import { normalizeAnswer } from '@app/contracts';
import { MINI_LEMMAS } from '../words/mockData';
import { errorResponse, featureMock } from '../words/mockHttp';
import { MINI_CASE_ITEMS } from './mockData';

export const VOCAB_ROUNDS = 3;
export const VOCAB_PER_ROUND = 6;
export const DONT_KNOW = "I don't know";

interface MockRun {
  round: number;
  vocabRight: number;
  vocabTotal: number;
  casesRight: string[];
  result?: PlacementResult;
}

const memory = new Map<string, string>();
const storage = {
  get(key: string): string | null {
    try {
      if (typeof sessionStorage !== 'undefined') return sessionStorage.getItem(key);
    } catch {
      // Storage blocked: fall back to memory.
    }
    return memory.get(key) ?? null;
  },
  set(key: string, value: string) {
    try {
      if (typeof sessionStorage !== 'undefined') return sessionStorage.setItem(key, value);
    } catch {
      // Storage blocked: fall back to memory.
    }
    memory.set(key, value);
  },
};

const keyOf = (id: string) => `mock.placement.${id}`;
const readRun = (id: string): MockRun | null => {
  const raw = storage.get(keyOf(id));
  return raw ? (JSON.parse(raw) as MockRun) : null;
};
const writeRun = (id: string, run: MockRun) => storage.set(keyOf(id), JSON.stringify(run));

const WITH_GLOSS = MINI_LEMMAS.filter((l) => l.senses.length > 0).sort(
  (a, b) => (a.freqRank ?? 0) - (b.freqRank ?? 0),
);

interface VocabKey {
  item: Extract<PlacementItem, { kind: 'vocab' }>;
  correct: number;
}

/** The vocabulary items of a round with the index of the right option. */
export function vocabRound(round: number): VocabKey[] {
  const n = WITH_GLOSS.length;
  return Array.from({ length: VOCAB_PER_ROUND }, (_, k) => {
    const at = (round - 1 + 12 * k) % n;
    const l = WITH_GLOSS[at] as (typeof WITH_GLOSS)[number];
    const gloss = l.senses[0]?.glossEn ?? '';
    const wrong: string[] = [];
    for (let step = 5; wrong.length < 2 && step < n + 5; step += 6) {
      const g = WITH_GLOSS[(at + step) % n]?.senses[0]?.glossEn;
      if (g && g !== gloss && !wrong.includes(g)) wrong.push(g);
    }
    const correct = k % 3;
    const options = [...wrong];
    options.splice(correct, 0, gloss);
    return {
      item: {
        itemId: `v${round}-${l.id}`,
        kind: 'vocab',
        lemmaId: l.id,
        lemma: l.lemma,
        options: [...options, DONT_KNOW],
      },
      correct,
    };
  });
}

export function roundOf(round: number): PlacementRound {
  if (round <= VOCAB_ROUNDS) return { round, items: vocabRound(round).map((v) => v.item) };
  return {
    round,
    items: MINI_CASE_ITEMS.map(({ itemId, sentenceSk, sentenceEn, blank, cue }) => ({
      itemId,
      kind: 'case' as const,
      sentenceSk,
      sentenceEn,
      blank,
      cue,
    })),
  };
}

function resultOf(run: MockRun): PlacementResult {
  const share = run.vocabTotal > 0 ? run.vocabRight / run.vocabTotal : 0;
  const knownUpToRank = Math.min(3000, Math.floor(share * 6) * 500);
  const lessons = MINI_CASE_ITEMS.map((c) => c.lessonId);
  return {
    knownUpToRank,
    lessonsTestedOut: lessons.filter((l) => run.casesRight.includes(l)),
    startLessonId: lessons.find((l) => !run.casesRight.includes(l)) ?? 'mixed',
    buckets: lessons.map((l) => ({
      lessonId: l,
      correct: run.casesRight.includes(l) ? 1 : 0,
      total: 1,
    })),
  };
}

function view(id: string, run: MockRun): PlacementRun {
  return run.result
    ? { id, status: 'completed', result: run.result }
    : { id, status: 'active', round: roundOf(run.round) };
}

const notFound = () => errorResponse('not_found', 'No such run.');

export const handlers = [
  featureMock('placement.start', ({ body }) => {
    const id = body?.id ?? '';
    const run = readRun(id) ?? { round: 1, vocabRight: 0, vocabTotal: 0, casesRight: [] };
    writeRun(id, run);
    return view(id, run);
  }),
  featureMock('placement.get', ({ params }) => {
    const id = params.id ?? '';
    const run = readRun(id);
    return run ? view(id, run) : notFound();
  }),
  featureMock('placement.answer', ({ params, body }) => {
    const id = params.id ?? '';
    const run = readRun(id);
    if (!run || !body) return notFound();
    // A repeated round (a retry after a lost answer) gets the current state back.
    if (run.result || body.round !== run.round) {
      const v = view(id, run);
      return {
        status: v.status,
        ...(v.round ? { round: v.round } : {}),
        ...(v.result ? { result: v.result } : {}),
      };
    }
    if (run.round <= VOCAB_ROUNDS) {
      for (const { item, correct } of vocabRound(run.round)) {
        const a = body.answers.find((x) => x.itemId === item.itemId);
        run.vocabTotal += 1;
        if (a?.choice === correct) run.vocabRight += 1;
      }
    } else {
      for (const c of MINI_CASE_ITEMS) {
        const typed = body.answers.find((x) => x.itemId === c.itemId)?.typed ?? '';
        if (typed && c.answers.some((ans) => normalizeAnswer(ans) === normalizeAnswer(typed))) {
          run.casesRight.push(c.lessonId);
        }
      }
    }
    run.round += 1;
    if (run.round > VOCAB_ROUNDS + 1) run.result = resultOf(run);
    writeRun(id, run);
    return run.result
      ? { status: 'completed' as const, result: run.result }
      : { status: 'active' as const, round: roundOf(run.round) };
  }),
];
