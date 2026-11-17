// How often each bucket (case, number, gender) occurs in real text, from the corpus list.
//
// 1. With the Araneum word form list with tags in content/raw/ (the full build): the ARF of
//    every common noun row, summed by the gender, number and case of its SNK tag.
// 2. Without it (tests, the mini dataset): each ranked noun's most used forms by their share,
//    the noun weighing 1 / its rank.
// The vocative is not taught and is left out.
import { join } from 'node:path';
import { bucketKey, bucketOfTag, tryParseTag } from '@app/ling';
import { existsSync } from '../../lib/files';
import { readLines } from '../../lib/lines';
import type { Paths } from '../../lib/paths';
import { ARANEUM_SOURCE, WORD_TAG_FILE } from '../freq';
import type { Morphology } from '../triggers/morphology';

export interface CorpusWeights {
  /** Bucket key (`gen.sg.f`) → share of the counted noun tokens; the shares sum to 1. */
  shares: Map<string, number>;
  source: 'araneum' | 'rank';
}

export const wordTagPath = (paths: Paths) => join(paths.raw, ARANEUM_SOURCE, WORD_TAG_FILE);

const NOUN_TAG = /^S[SAFU]([mifn])([sp])([1-7])$/u;
const GENDER: Record<string, string> = { m: 'm_anim', i: 'm_inan', f: 'f', n: 'n' };
const CASE: Record<string, string> = {
  '1': 'nom',
  '2': 'gen',
  '3': 'dat',
  '4': 'acc',
  '6': 'loc',
  '7': 'ins',
};

/** Sums the ARF of the common noun rows of the Araneum word form list by bucket. */
export async function araneumBucketSums(
  lines: AsyncIterable<string>,
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  for await (const line of lines) {
    const cols = line.split('\t');
    const tag = cols[1];
    if (tag?.[0] !== 'S') continue;
    const m = NOUN_TAG.exec(tag);
    if (!m) continue;
    const c = CASE[m[3] as string];
    if (!c) continue;
    const arf = Number(cols[3]);
    if (!Number.isFinite(arf) || arf <= 0) continue;
    const key = `${c}.${m[2] === 's' ? 'sg' : 'pl'}.${GENDER[m[1] as string]}`;
    sums.set(key, (sums.get(key) ?? 0) + arf);
  }
  return sums;
}

function rankBucketSums(m: Morphology): Map<string, number> {
  const sums = new Map<string, number>();
  for (const l of m.lemmas.values()) {
    if (l.pos !== 'noun' || !l.gender || !l.freqRank || !l.topForms) continue;
    for (const f of l.topForms) {
      const parsed = tryParseTag(f.tag);
      if (parsed?.kind !== 'noun' || parsed.case === 'voc') continue;
      const b = bucketOfTag(f.tag, l.gender);
      if (!b) continue;
      const k = bucketKey(b);
      sums.set(k, (sums.get(k) ?? 0) + f.share / l.freqRank);
    }
  }
  return sums;
}

export async function corpusWeights(
  m: Morphology,
  paths: Paths,
  opts: { araneum: boolean },
): Promise<CorpusWeights> {
  const path = wordTagPath(paths);
  const useAraneum = opts.araneum && existsSync(path);
  const sums = useAraneum ? await araneumBucketSums(readLines(path)) : rankBucketSums(m);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  const shares = new Map<string, number>();
  for (const [k, v] of [...sums].sort(([a], [b]) => (a < b ? -1 : 1)))
    shares.set(k, total > 0 ? v / total : 0);
  return { shares, source: useAraneum ? 'araneum' : 'rank' };
}

/**
 * The weights of a lesson's buckets: their corpus shares, scaled to sum to 1 and rounded to
 * three decimals (the rounding error goes to the largest). No bucket gets less than 0.001.
 */
export function lessonWeights(keys: readonly string[], shares: ReadonlyMap<string, number>) {
  const raw = keys.map((k) => Math.max(shares.get(k) ?? 0, 1e-9));
  const total = raw.reduce((a, b) => a + b, 0);
  const w = raw.map((x) => Math.max(0.001, Math.round((x / total) * 1000) / 1000));
  const diff = Math.round((1 - w.reduce((a, b) => a + b, 0)) * 1000) / 1000;
  if (diff !== 0 && w.length > 0) {
    const i = w.indexOf(Math.max(...w));
    w[i] = Math.round(((w[i] as number) + diff) * 1000) / 1000;
  }
  return keys.map((k, i) => ({ key: k, weight: w[i] as number }));
}
