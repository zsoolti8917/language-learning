// Buckets of the declension trainer (docs/architecture.md, "Trainer sessions").
import {
  CASES,
  type Case,
  GENDERS,
  type Gender,
  type GrammaticalNumber,
  NUMBERS,
} from '@app/contracts';
import { parseTag } from './tags';

/** One combination of case, number and gender; animate and inanimate masculine count apart. */
export type Bucket = { case: Case; number: GrammaticalNumber; gender: Gender };

/** Every bucket, 7 cases x 2 numbers x 4 genders, in the order of the shared enums. */
export const ALL_BUCKETS: readonly Bucket[] = CASES.flatMap((c) =>
  NUMBERS.flatMap((number) => GENDERS.map((gender) => ({ case: c, number, gender }))),
);

/**
 * The bucket of a set of features. Gender is part of a bucket, so features without one get
 * `nounGender`; with neither the result is null.
 */
export function bucketOf(
  features: { case: Case; number: GrammaticalNumber; gender?: Gender | undefined },
  nounGender?: Gender,
): Bucket | null {
  const gender = features.gender ?? nounGender;
  if (gender === undefined) return null;
  return { case: features.case, number: features.number, gender };
}

/** The bucket of a form tag, or null for a tag without case and number. */
export function bucketOfTag(tag: string, nounGender?: Gender): Bucket | null {
  const parsed = parseTag(tag);
  if (parsed.kind === 'noun') return bucketOf(parsed, nounGender);
  if (parsed.kind === 'agree') return bucketOf(parsed);
  return null;
}

/** A stable string key of a bucket: `gen.sg.f`, `acc.pl.m_anim`. */
export function bucketKey(bucket: Bucket): string {
  return `${bucket.case}.${bucket.number}.${bucket.gender}`;
}

/** Reads a key made by `bucketKey`; null when it is not one. */
export function parseBucketKey(key: string): Bucket | null {
  const [c, number, gender, ...rest] = key.split('.');
  if (rest.length > 0) return null;
  if (!(CASES as readonly string[]).includes(c ?? '')) return null;
  if (!(NUMBERS as readonly string[]).includes(number ?? '')) return null;
  if (!(GENDERS as readonly string[]).includes(gender ?? '')) return null;
  return { case: c as Case, number: number as GrammaticalNumber, gender: gender as Gender };
}
