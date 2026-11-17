// Mastery for the course grid and the trainer summary (docs/contracts.md, BucketMastery).
import type {
  BucketMastery,
  Case,
  ExerciseItem,
  Gender,
  GrammaticalNumber,
  MasteryLevel,
} from '@app/contracts';
import { bucketKey, bucketOf } from '@app/ling';
import type { ItemResult } from './attempts';
import { GENDERS } from './grammar';

/** The contract's thresholds: fewer than 5 attempts unseen, below 0.6 weak, from 0.85 strong. */
export function levelOf(attempts: number, mastery: number): MasteryLevel {
  if (attempts < 5) return 'unseen';
  if (mastery < 0.6) return 'weak';
  if (mastery >= 0.85) return 'strong';
  return 'ok';
}

export interface CellMastery {
  case: Case;
  number: GrammaticalNumber;
  attempts: number;
  mastery: number;
  level: MasteryLevel;
  /** One row per gender, unseen when the server sent none. */
  genders: { gender: Gender; attempts: number; mastery: number; level: MasteryLevel }[];
}

/**
 * One grid cell per case and number. A cell's mastery is the attempt weighted mean of its
 * genders, and its level follows the same thresholds as a bucket's.
 */
export function cellMastery(
  list: readonly BucketMastery[],
  c: Case,
  number: GrammaticalNumber,
): CellMastery {
  const genders = GENDERS.map((gender) => {
    const b = list.find((x) => x.case === c && x.number === number && x.gender === gender);
    return b
      ? { gender, attempts: b.attempts, mastery: b.mastery, level: b.level }
      : { gender, attempts: 0, mastery: 0, level: 'unseen' as const };
  });
  const attempts = genders.reduce((s, g) => s + g.attempts, 0);
  const mastery =
    attempts === 0 ? 0 : genders.reduce((s, g) => s + g.mastery * g.attempts, 0) / attempts;
  return { case: c, number, attempts, mastery, level: levelOf(attempts, mastery), genders };
}

// --- Trainer summary ------------------------------------------------------------------------

export interface BucketSummary {
  key: string;
  case: Case;
  number: GrammaticalNumber;
  gender: Gender;
  /** Mean of 1 (first try right), 0.5 (right on the retry) and 0 over this session's items. */
  sessionScore: number;
  items: number;
  before?: BucketMastery | undefined;
  after?: BucketMastery | undefined;
}

export function itemScore(result: ItemResult): number {
  const first = result.attempts[0];
  if (first?.correct) return 1;
  return result.attempts.some((a) => a.retry && a.correct) ? 0.5 : 0;
}

/**
 * Buckets of the session with their score, the mastery before the session and, once a batch
 * reached the server, after it.
 */
export function summarize(
  items: readonly ExerciseItem[],
  results: readonly ItemResult[],
  before: readonly BucketMastery[],
  after: readonly BucketMastery[] | null,
): { improved: BucketSummary[]; weak: BucketSummary[]; all: BucketSummary[] } {
  const byKey = new Map<string, BucketSummary & { total: number }>();
  for (const r of results) {
    const item = items.find((i) => i.exerciseId === r.exerciseId);
    const bucket = item ? bucketOf(item.features) : null;
    if (!bucket) continue;
    const key = bucketKey(bucket);
    const find = (list: readonly BucketMastery[] | null) => list?.find((b) => bucketKey(b) === key);
    const entry = byKey.get(key) ?? {
      key,
      ...bucket,
      sessionScore: 0,
      items: 0,
      total: 0,
      before: find(before),
      after: find(after),
    };
    entry.items += 1;
    entry.total += itemScore(r);
    entry.sessionScore = entry.total / entry.items;
    byKey.set(key, entry);
  }
  const all = [...byKey.values()].map(({ total: _total, ...rest }) => rest);
  // With too few attempts the server says `unseen`; this session's score decides then.
  const known = (b: BucketMastery | undefined) => (b && b.level !== 'unseen' ? b : undefined);
  const improved = all.filter((b) => {
    const after = known(b.after);
    const before = known(b.before);
    if (after && before) return after.mastery > before.mastery;
    if (after) return after.level !== 'weak';
    return b.sessionScore >= 0.85;
  });
  const weak = all.filter((b) => {
    const after = known(b.after);
    return after ? after.level === 'weak' : b.sessionScore < 0.6;
  });
  return { improved, weak, all };
}
