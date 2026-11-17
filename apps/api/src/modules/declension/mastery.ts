// The mastery formula (docs/contracts.md, "Exercises, attempts and mastery"). Pure: repo.ts
// reads the last attempts of each bucket, this file turns them into BucketMastery.
import type { BucketMastery, Case, Gender, GrammaticalNumber, MasteryLevel } from '@app/contracts';
import { ALL_BUCKETS, type Bucket, bucketKey } from '@app/ling';

/** Only the newest attempts of a bucket count. */
export const MASTERY_WINDOW = 30;
/** Attempt number i (0 = newest) weighs DECAY ^ i. */
export const MASTERY_DECAY = 0.9;
/** With fewer attempts a bucket is `unseen`. */
export const MIN_ATTEMPTS = 5;
export const WEAK_BELOW = 0.6;
export const STRONG_FROM = 0.85;

export interface MasteryAttempt {
  correct: boolean;
  retry: boolean;
}

/** 1 for a correct first try, 0.5 for a correct retry, 0 for a wrong answer. */
export function attemptValue(a: MasteryAttempt): number {
  if (!a.correct) return 0;
  return a.retry ? 0.5 : 1;
}

/**
 * `sum(w * x) / sum(w)` over the newest MASTERY_WINDOW attempts, newest first, with
 * `w = 0.9 ^ i`. No attempts give 0.
 */
export function masteryOf(newestFirst: readonly MasteryAttempt[]): number {
  let num = 0;
  let den = 0;
  const n = Math.min(newestFirst.length, MASTERY_WINDOW);
  for (let i = 0; i < n; i++) {
    const w = MASTERY_DECAY ** i;
    num += w * attemptValue(newestFirst[i] as MasteryAttempt);
    den += w;
  }
  return den === 0 ? 0 : Math.min(1, Math.max(0, num / den));
}

/** `unseen` below 5 attempts, else `weak` below 0.6, `strong` from 0.85, `ok` between. */
export function levelOf(attempts: number, mastery: number): MasteryLevel {
  if (attempts < MIN_ATTEMPTS) return 'unseen';
  if (mastery < WEAK_BELOW) return 'weak';
  if (mastery >= STRONG_FROM) return 'strong';
  return 'ok';
}

/** One attempt row as repo.ts returns it: newest first within its bucket. */
export interface BucketAttemptRow {
  case: Case;
  number: GrammaticalNumber;
  gender: Gender;
  correct: boolean;
  retry: boolean;
  /** Every attempt of the bucket, not only those in the window. */
  total: number;
}

/** The mastery of every bucket that has rows; rows of a bucket must come newest first. */
export function masteryFromRows(rows: readonly BucketAttemptRow[]): BucketMastery[] {
  const groups = new Map<string, { bucket: Bucket; total: number; list: MasteryAttempt[] }>();
  for (const r of rows) {
    const bucket = { case: r.case, number: r.number, gender: r.gender };
    const key = bucketKey(bucket);
    let g = groups.get(key);
    if (!g) {
      g = { bucket, total: r.total, list: [] };
      groups.set(key, g);
    }
    g.list.push({ correct: r.correct, retry: r.retry });
  }
  return [...groups.values()].map((g) => {
    const mastery = masteryOf(g.list);
    return { ...g.bucket, attempts: g.total, mastery, level: levelOf(g.total, mastery) };
  });
}

/** Every one of the 56 buckets, unseen ones filled with zero attempts. */
export function allBuckets(known: readonly BucketMastery[]): BucketMastery[] {
  const byKey = new Map(known.map((m) => [bucketKey(m), m]));
  return ALL_BUCKETS.map(
    (b) => byKey.get(bucketKey(b)) ?? { ...b, attempts: 0, mastery: 0, level: 'unseen' },
  );
}
