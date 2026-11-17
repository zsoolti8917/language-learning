// Pure logic of the placement check: sampling, wrong options, the case round and the result.
// No input or output, so the rules are tested without a database (items.test.ts).
//
// Rules (docs/contracts.md, "Placement"):
// - Vocabulary: 3 rounds of 12 words over six strata of 500 ranks. Round 1 takes two words
//   from each stratum. Rounds 2 and 3 take their words around the first stratum with a miss.
// - A stratum counts as known when at least 85% of its sampled words were right.
// - Case: one round of 16 typed gaps, two for each teaching lesson. A lesson is tested out
//   when both are right.

import type { PlacementItem, PlacementResult, Pos } from '@app/contracts';
import type { AttemptRecord } from '../../ports';

export const STRATUM_SIZE = 500;
export const STRATA = 6;
export const MAX_RANK = STRATUM_SIZE * STRATA;
export const VOCAB_ROUNDS = 3;
export const VOCAB_ROUND_SIZE = 12;
export const CASE_ROUND = VOCAB_ROUNDS + 1;
export const CASE_PER_LESSON = 2;
export const KNOWN_SHARE = 0.85;
/** Wrong meanings offered with the right one. */
export const WRONG_OPTIONS = 3;
/** The pool the wrong meanings are drawn from: the nearest lemmas by rank. */
export const WRONG_OPTION_POOL = 8;
/** The case round takes exercises of medium difficulty: closest to this value. */
export const MEDIUM_DIFFICULTY = 0.5;
/** The last option of every vocabulary item. */
export const DONT_KNOW = "I don't know";
/** The gap of a case item, which `blank` points at. */
export const GAP = '___';

export type VocabItem = Extract<PlacementItem, { kind: 'vocab' }>;
export type CaseItem = Extract<PlacementItem, { kind: 'case' }>;

/** What the learner gave for an item; both empty when the item was left out. */
export interface Given {
  choice?: number;
  typed?: string;
}

/** A vocabulary item as stored in `app.placement.items`, with its key. */
export interface StoredVocab {
  round: number;
  item: VocabItem;
  stratum: number;
  rank: number;
  correctIndex: number;
  answered: boolean;
  given?: Given;
  correct?: boolean;
}

/** A case item as stored, with its key and, once graded, the attempt to log. */
export interface StoredCase {
  round: number;
  item: CaseItem;
  lessonId: string;
  exerciseId: string;
  answers: string[];
  answered: boolean;
  given?: Given;
  correct?: boolean;
  attempt?: AttemptRecord;
}

export type StoredItem = StoredVocab | StoredCase;

export function isVocab(s: StoredItem): s is StoredVocab {
  return s.item.kind === 'vocab';
}
export function isCase(s: StoredItem): s is StoredCase {
  return s.item.kind === 'case';
}

// --- Seeded randomness ------------------------------------------------------------

/** FNV-1a of a string, as the seed of `rng`. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, so a run's rounds depend only on its id and answers. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// --- Vocabulary -------------------------------------------------------------------

export interface Candidate {
  lemmaId: number;
  lemma: string;
  pos: Pos;
  rank: number;
  gloss: string;
}

export function stratumOf(rank: number): number {
  return Math.min(STRATA - 1, Math.floor((rank - 1) / STRATUM_SIZE));
}

/** The first stratum where an answered vocabulary item was wrong, or null. */
export function firstMissStratum(items: readonly StoredVocab[]): number | null {
  let first: number | null = null;
  for (const s of items) {
    if (s.answered && s.correct === false && (first === null || s.stratum < first))
      first = s.stratum;
  }
  return first;
}

/**
 * How many words each stratum gives to a round. Round 1: two from each. Later rounds: the
 * strata around the first one with a miss (or the top one when nothing was missed), split as
 * evenly as possible with the remainder going to the missed stratum first.
 */
export function roundQuota(round: number, prior: readonly StoredVocab[]): Map<number, number> {
  const quota = new Map<number, number>();
  if (round === 1) {
    for (let s = 0; s < STRATA; s++) quota.set(s, VOCAB_ROUND_SIZE / STRATA);
    return quota;
  }
  const center = firstMissStratum(prior) ?? STRATA - 1;
  const window = [center, center - 1, center + 1].filter((s) => s >= 0 && s < STRATA);
  const base = Math.floor(VOCAB_ROUND_SIZE / window.length);
  let rest = VOCAB_ROUND_SIZE - base * window.length;
  for (const s of window) {
    quota.set(s, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest -= 1;
  }
  return quota;
}

/**
 * Picks the words of a vocabulary round. A stratum that runs out of unseen words passes its
 * share on to the stratum nearest to it that still has some.
 */
export function pickVocabWords(
  round: number,
  candidates: readonly Candidate[],
  prior: readonly StoredVocab[],
  rand: () => number,
): { candidate: Candidate; stratum: number }[] {
  const shown = new Set(prior.map((p) => p.item.lemmaId));
  const pools = new Map<number, Candidate[]>();
  for (const c of candidates) {
    if (shown.has(c.lemmaId) || c.rank > MAX_RANK) continue;
    const s = stratumOf(c.rank);
    const pool = pools.get(s) ?? [];
    pool.push(c);
    pools.set(s, pool);
  }
  for (const [s, pool] of pools) pools.set(s, shuffle(pool, rand));

  const picked: { candidate: Candidate; stratum: number }[] = [];
  const quota = roundQuota(round, prior);
  for (const [s, n] of [...quota].sort((a, b) => a[0] - b[0])) {
    for (let k = 0; k < n; k++) {
      // The stratum itself, then the nearest ones (lower first on a tie).
      let taken: Candidate | undefined;
      for (let d = 0; d < STRATA && !taken; d++) {
        for (const t of d === 0 ? [s] : [s - d, s + d]) {
          const pool = pools.get(t);
          if (pool && pool.length > 0) {
            taken = pool.pop();
            if (taken) picked.push({ candidate: taken, stratum: t });
            break;
          }
        }
      }
    }
  }
  return picked.sort(
    (a, b) => a.candidate.rank - b.candidate.rank || a.candidate.lemmaId - b.candidate.lemmaId,
  );
}

/**
 * The wrong meanings of an item: glosses of other lemmas with the same part of speech and a
 * similar rank (the nearest by rank, a few drawn at random), then of any part of speech
 * when too few share it. Glosses equal to the right one, or to each other, are skipped.
 */
export function wrongOptions(
  target: Candidate,
  candidates: readonly Candidate[],
  rand: () => number,
): string[] {
  const norm = (g: string) => g.trim().toLowerCase();
  const taken = new Set([norm(target.gloss)]);
  const out: string[] = [];
  const byDistance = (list: Candidate[]) =>
    list.sort(
      (a, b) =>
        Math.abs(a.rank - target.rank) - Math.abs(b.rank - target.rank) || a.lemmaId - b.lemmaId,
    );
  const others = candidates.filter((c) => c.lemmaId !== target.lemmaId);
  const groups = [
    byDistance(others.filter((c) => c.pos === target.pos)),
    byDistance(others.filter((c) => c.pos !== target.pos)),
  ];
  for (const group of groups) {
    const pool: string[] = [];
    for (const c of group) {
      if (pool.length >= WRONG_OPTION_POOL) break;
      const g = norm(c.gloss);
      if (taken.has(g) || pool.some((p) => norm(p) === g)) continue;
      pool.push(c.gloss);
    }
    for (const g of shuffle(pool, rand)) {
      if (out.length >= WRONG_OPTIONS) break;
      out.push(g);
      taken.add(norm(g));
    }
    if (out.length >= WRONG_OPTIONS) break;
  }
  return out;
}

/** Builds a vocabulary round, items ordered by rank. */
export function buildVocabRound(
  runId: string,
  round: number,
  candidates: readonly Candidate[],
  prior: readonly StoredVocab[],
): StoredVocab[] {
  const rand = rng(`${runId}:vocab:${round}`);
  return pickVocabWords(round, candidates, prior, rand).map(({ candidate, stratum }) => {
    const meanings = shuffle([candidate.gloss, ...wrongOptions(candidate, candidates, rand)], rand);
    return {
      round,
      item: {
        itemId: `v${round}-${candidate.lemmaId}`,
        kind: 'vocab',
        lemmaId: candidate.lemmaId,
        lemma: candidate.lemma,
        options: [...meanings, DONT_KNOW],
      },
      stratum,
      rank: candidate.rank,
      correctIndex: meanings.indexOf(candidate.gloss),
      answered: false,
    };
  });
}

/** Leading strata that count as known, times 500. */
export function knownUpToRank(items: readonly StoredVocab[]): number {
  let known = 0;
  for (let s = 0; s < STRATA; s++) {
    const sampled = items.filter((i) => i.answered && i.stratum === s);
    const right = sampled.filter((i) => i.correct).length;
    if (sampled.length === 0 || right / sampled.length < KNOWN_SHARE) break;
    known += 1;
  }
  return known * STRATUM_SIZE;
}

// --- Case round -------------------------------------------------------------------

export interface CaseExercise {
  id: string;
  lessonId: string;
  sentenceSk: string;
  sentenceEn: string;
  start: number;
  end: number;
  lemmaIds: number[];
  cue: string;
  answers: string[];
  difficulty: number;
  verified: boolean;
}

/**
 * Two exercises of medium difficulty for each teaching lesson: closest to
 * MEDIUM_DIFFICULTY, then single word gaps, then verified ones, then by id.
 */
export function pickCaseExercises<E extends CaseExercise>(
  lessonIds: readonly string[],
  exercises: readonly E[],
): E[] {
  const out: E[] = [];
  for (const lessonId of lessonIds) {
    const own = exercises
      .filter((e) => e.lessonId === lessonId && e.answers.length > 0)
      .sort(
        (a, b) =>
          Math.abs(a.difficulty - MEDIUM_DIFFICULTY) - Math.abs(b.difficulty - MEDIUM_DIFFICULTY) ||
          Number(a.lemmaIds.length !== 1) - Number(b.lemmaIds.length !== 1) ||
          Number(b.verified) - Number(a.verified) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    out.push(...own.slice(0, CASE_PER_LESSON));
  }
  return out;
}

/** A case item: the sentence with its gap written as `___`, so it carries no answer. */
export function buildCaseItems(exercises: readonly CaseExercise[]): StoredCase[] {
  const n = new Map<string, number>();
  return exercises.map((e) => {
    const k = (n.get(e.lessonId) ?? 0) + 1;
    n.set(e.lessonId, k);
    const sentenceSk = e.sentenceSk.slice(0, e.start) + GAP + e.sentenceSk.slice(e.end);
    return {
      round: CASE_ROUND,
      item: {
        itemId: `c-${e.lessonId}-${k}`,
        kind: 'case',
        sentenceSk,
        sentenceEn: e.sentenceEn,
        blank: { start: e.start, end: e.start + GAP.length },
        cue: e.cue,
      },
      lessonId: e.lessonId,
      exerciseId: e.id,
      answers: e.answers,
      answered: false,
    };
  });
}

// --- Result -----------------------------------------------------------------------

export function buildResult(
  items: readonly StoredItem[],
  teaching: readonly string[],
  course: readonly string[],
): PlacementResult {
  const cases = items.filter(isCase);
  const buckets = teaching.map((lessonId) => {
    const own = cases.filter((c) => c.lessonId === lessonId);
    return {
      lessonId,
      correct: own.filter((c) => c.correct).length,
      total: own.length,
    };
  });
  const lessonsTestedOut = buckets
    .filter((b) => b.total > 0 && b.correct === b.total)
    .map((b) => b.lessonId);
  const out = new Set(lessonsTestedOut);
  const startLessonId = course.find((l) => !out.has(l)) ?? course.at(-1) ?? teaching[0] ?? '';
  return {
    knownUpToRank: knownUpToRank(items.filter(isVocab)),
    lessonsTestedOut,
    startLessonId,
    buckets,
  };
}

/** True when two answers to the same item are the same answer. */
export function sameGiven(a: Given | undefined, b: Given | undefined): boolean {
  return (a?.choice ?? null) === (b?.choice ?? null) && (a?.typed ?? null) === (b?.typed ?? null);
}
