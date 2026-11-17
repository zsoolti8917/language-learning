// The session builder of the trainer (docs/architecture.md, "Trainer sessions"). Pure and
// seeded: the same candidates, mastery and seed always give the same session.
import type { BucketMastery, SessionMode } from '@app/contracts';
import { bucketKey } from '@app/ling';

/** At least this share of a session comes from strong buckets, when the learner has some. */
export const STRONG_SHARE = 0.3;
/** The share of a bucket that no unlocked lesson names. */
export const DEFAULT_SHARE = 0.05;
/**
 * The mastery used for weights while a bucket is `unseen` (fewer than 5 attempts): too few
 * answers to call it weak or strong, so it sits in the middle.
 */
export const UNSEEN_MASTERY = 0.5;
/** In `weak` mode the weak part draws from at most this many of the weakest buckets. */
export const WEAK_BUCKETS = 3;
/** No bucket weighs less, so a fully mastered bucket can still be drawn when it must. */
const MIN_WEIGHT = 0.001;

/** A seeded random source (mulberry32): numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: T[], rnd: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j] as T, list[i] as T];
  }
  return list;
}

export interface Candidate {
  exerciseId: string;
  /** `bucketKey` of the exercise's case, number and gender. */
  bucket: string;
  /** When the learner last answered it (ms), or null when never. */
  lastSeenAt: number | null;
}

export interface SessionInput {
  mode: SessionMode;
  size: number;
  seed: number;
  candidates: readonly Candidate[];
  /** bucketKey → share in real text (lesson focus weights). */
  shares: ReadonlyMap<string, number>;
  /** The learner's mastery; buckets missing here are unseen. */
  mastery: readonly BucketMastery[];
}

/** The mastery a bucket's weight uses: the formula's value, or UNSEEN_MASTERY while unseen. */
export function weightMastery(m: BucketMastery | undefined): number {
  if (!m || m.level === 'unseen') return UNSEEN_MASTERY;
  return m.mastery;
}

interface Pool {
  key: string;
  weight: number;
  /** Exercises in the order they are taken: never seen first, then the longest unseen. */
  queue: string[];
}

function draw(pools: Pool[], count: number, rnd: () => number, out: string[]): void {
  for (let n = 0; n < count; n++) {
    const open = pools.filter((p) => p.queue.length > 0);
    if (open.length === 0) return;
    const total = open.reduce((s, p) => s + p.weight, 0);
    let r = rnd() * total;
    let pick = open[open.length - 1] as Pool;
    for (const p of open) {
      r -= p.weight;
      if (r < 0) {
        pick = p;
        break;
      }
    }
    out.push(pick.queue.shift() as string);
  }
}

/**
 * Picks the exercise ids of a session.
 * - A bucket weighs its share in real text times one minus its mastery.
 * - At least 30% of the items come from strong buckets, when there are any; they are drawn by
 *   share alone.
 * - In `weak` mode the rest comes from the WEAK_BUCKETS weakest buckets that are not strong;
 *   in `lesson` and `mixed` mode from every bucket that is not strong.
 * - Within a bucket, exercises never answered come first, then those answered longest ago.
 * - When a part runs out of exercises, the other buckets fill the session.
 */
export function selectSession(input: SessionInput): string[] {
  const rnd = seededRandom(input.seed);
  const mastery = new Map(input.mastery.map((m) => [bucketKey(m), m]));
  const share = (key: string) => input.shares.get(key) ?? DEFAULT_SHARE;

  // Candidates in a fixed order first, so the result does not depend on the input order.
  const sorted = [...input.candidates].sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : 1));
  shuffle(sorted, rnd);
  const byBucket = new Map<string, Candidate[]>();
  for (const c of sorted) {
    const list = byBucket.get(c.bucket) ?? [];
    list.push(c);
    byBucket.set(c.bucket, list);
  }
  const all: Pool[] = [...byBucket.keys()].sort().map((key) => {
    const list = byBucket.get(key) as Candidate[];
    // Stable sort keeps the seeded order among equals.
    list.sort((a, b) => (a.lastSeenAt ?? -1) - (b.lastSeenAt ?? -1));
    return {
      key,
      weight: Math.max(MIN_WEIGHT, share(key) * (1 - weightMastery(mastery.get(key)))),
      queue: list.map((c) => c.exerciseId),
    };
  });

  const strong = all
    .filter((p) => mastery.get(p.key)?.level === 'strong')
    .map((p) => ({ ...p, weight: Math.max(MIN_WEIGHT, share(p.key)) }));
  let rest = all.filter((p) => mastery.get(p.key)?.level !== 'strong');
  if (input.mode === 'weak') {
    rest = [...rest]
      .sort(
        (a, b) =>
          weightMastery(mastery.get(a.key)) - weightMastery(mastery.get(b.key)) ||
          (a.key < b.key ? -1 : 1),
      )
      .slice(0, WEAK_BUCKETS);
  }

  const size = Math.min(input.size, input.candidates.length);
  const out: string[] = [];
  const strongCount = strong.length > 0 ? Math.ceil(STRONG_SHARE * size) : 0;
  draw(strong, strongCount, rnd, out);
  draw(rest, size - out.length, rnd, out);
  // Not enough in the chosen buckets: fill from every bucket, by weight.
  if (out.length < size) {
    const taken = new Set(out);
    const left = all.map((p) => ({ ...p, queue: p.queue.filter((id) => !taken.has(id)) }));
    draw(left, size - out.length, rnd, out);
  }
  return shuffle(out, rnd);
}
