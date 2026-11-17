// Pattern assignment by rule (docs/architecture.md, "Patterns"). A noun gets its pattern from
// its gender and animacy, the SNK paradigm, and the endings of its nominative and genitive
// (the nominative plural tells dub from stroj). The pattern is then tested on the noun's
// other forms; a noun whose forms do not follow it gets the irregular flag.
import { foldAscii, type Gender } from '@app/contracts';

export const NOUN_PATTERNS = [
  'chlap',
  'hrdina',
  'kuli',
  'dub',
  'stroj',
  'zena',
  'ulica',
  'dlan',
  'kost',
  'gazdina',
  'mesto',
  'srdce',
  'vysvedcenie',
  'dievca',
] as const;
export type NounPattern = (typeof NOUN_PATTERNS)[number];

/**
 * Adjective patterns. `pavi` is not assigned: in SNK the páví type has exactly the forms of
 * cudzí (páví, pávieho, pávia, pávie...), so the forms cannot tell them apart.
 */
export const ADJ_PATTERNS = ['pekny', 'cudzi', 'pavi', 'otcov'] as const;
export type AdjPattern = (typeof ADJ_PATTERNS)[number];

/**
 * Endings each pattern allows in the slots that are tested, folded (no accents, so the
 * rhythmic law and ä/á do not matter). The first ending of s2 (p1 for plural only nouns)
 * cuts the stem. Slots left out vary too much to test: s4, s5, s6, p2, p4, p5, p6.
 */
const ENDINGS: Record<NounPattern, Partial<Record<string, string[]>>> = {
  chlap: {
    s2: ['a'],
    s3: ['ovi', 'u'],
    s7: ['om'],
    p1: ['i', 'ovia', 'ia'],
    p3: ['om'],
    p7: ['mi', 'ami'],
  },
  hrdina: {
    s2: ['u'],
    s3: ['ovi'],
    s7: ['om'],
    p1: ['ovia', 'i', 'ia'],
    p3: ['om'],
    p7: ['ami', 'mi'],
  },
  kuli: { s2: ['ho'], s3: ['mu'], s7: ['m'], p1: ['ovia'], p3: ['om'], p7: ['ami'] },
  dub: { s2: ['a', 'u'], s3: ['u'], s7: ['om'], p1: ['y'], p3: ['om'], p7: ['mi', 'ami'] },
  stroj: { s2: ['a', 'u'], s3: ['u'], s7: ['om'], p1: ['e'], p3: ['om'], p7: ['mi', 'ami'] },
  zena: { s2: ['y'], s3: ['e'], s7: ['ou'], p1: ['y'], p3: ['am'], p7: ['ami'] },
  ulica: { s2: ['e'], s3: ['i'], s7: ['ou'], p1: ['e'], p3: ['iam', 'am'], p7: ['ami'] },
  dlan: { s2: ['e'], s3: ['i'], s7: ['ou'], p1: ['e'], p3: ['iam', 'am'], p7: ['ami'] },
  kost: { s2: ['i'], s3: ['i'], s7: ['ou'], p1: ['i'], p3: ['iam', 'am'], p7: ['ami'] },
  gazdina: { s2: ['ej'], s3: ['ej'], s7: ['ou'], p1: ['e'], p3: ['am'], p7: ['ami'] },
  mesto: { s2: ['a'], s3: ['u'], s7: ['om'], p1: ['a'], p3: ['am'], p7: ['ami'] },
  srdce: { s2: ['a'], s3: ['u'], s7: ['om'], p1: ['ia', 'a'], p3: ['iam', 'am'], p7: ['ami'] },
  vysvedcenie: { s2: ['ia'], s3: ['iu'], s7: ['im'], p1: ['ia'], p3: ['iam'], p7: ['iami'] },
  dievca: {
    s2: ['ata'],
    s3: ['atu'],
    s7: ['atom'],
    p1: ['ata', 'ence'],
    p3: ['atam', 'encom'],
    p7: ['atami', 'encami'],
  },
};

/** chlap's nominative plural softens the stem (vojak → vojaci), so it is not tested. */
const SKIP: Partial<Record<NounPattern, string[]>> = { chlap: ['p1'] };

const TESTED = ['s3', 's7', 'p1', 'p3', 'p7'];
const SOFT = /(?:c|č|ď|dz|dž|j|ľ|ň|š|ť|ž)$/u;

export interface NounInput {
  lemma: string;
  gender: Gender;
  /** The SNK paradigm letter that most forms carry: S, A, F or U. */
  paradigm: string;
  /** Forms by noun tag (s1 … p7). */
  slots: ReadonlyMap<string, readonly string[]>;
}

export type NounPatternResult =
  | { pattern: NounPattern; irregular: boolean; failed?: string[] }
  | {
      pattern?: undefined;
      irregular: boolean;
      reason: 'adjectival' | 'indeclinable' | 'no rule' | 'no forms';
    };

const ends = (forms: readonly string[] | undefined, suffix: string) =>
  (forms ?? []).some((f) => foldAscii(f).endsWith(suffix));

/** Picks the pattern by rule, without testing it. */
export function choosePattern(n: NounInput): NounPattern | undefined {
  const nom = n.slots.get('s1') ?? [];
  const gen = n.slots.get('s2') ?? [];
  const nomPl = n.slots.get('p1') ?? [];
  const singular = nom.length > 0 || gen.length > 0;
  const lemma = foldAscii(n.lemma);
  const nomEnds = (s: string) => (nom.length > 0 ? ends(nom, s) : lemma.endsWith(s));
  if (!singular) {
    // Plural only: the nominative plural decides.
    if (n.gender === 'f')
      return ends(nomPl, 'y')
        ? 'zena'
        : ends(nomPl, 'e')
          ? 'ulica'
          : ends(nomPl, 'i')
            ? 'kost'
            : undefined;
    if (n.gender === 'n')
      return ends(nomPl, 'ia') ? 'srdce' : ends(nomPl, 'a') ? 'mesto' : undefined;
    if (n.gender === 'm_inan')
      return ends(nomPl, 'y') ? 'dub' : ends(nomPl, 'e') ? 'stroj' : undefined;
    return ends(nomPl, 'i') || ends(nomPl, 'ia') ? 'chlap' : undefined;
  }
  switch (n.gender) {
    case 'm_anim':
      if (n.paradigm === 'F') return 'kuli';
      if (nomEnds('a')) return 'hrdina';
      return 'chlap';
    case 'm_inan':
      if (n.paradigm === 'F') return undefined;
      if (ends(nomPl, 'y')) return 'dub';
      if (ends(nomPl, 'e')) return 'stroj';
      return SOFT.test(n.lemma) ? 'stroj' : 'dub';
    case 'f':
      if (n.paradigm === 'F' || ends(gen, 'ej')) return 'gazdina';
      if (nomEnds('a')) return ends(gen, 'y') ? 'zena' : ends(gen, 'e') ? 'ulica' : undefined;
      if (/[^aeiouy]$/u.test(lemma))
        return ends(gen, 'e') ? 'dlan' : ends(gen, 'i') ? 'kost' : undefined;
      return undefined;
    case 'n':
      if (nomEnds('ie') && ends(gen, 'ia')) return 'vysvedcenie';
      if (nomEnds('a') && ends(gen, 'ata')) return 'dievca';
      if ((nomEnds('o') || nomEnds('um') || nomEnds('on')) && ends(gen, 'a')) return 'mesto';
      if (nomEnds('e') && ends(gen, 'a')) return 'srdce';
      return undefined;
  }
}

/** The slots whose forms do not follow the pattern from the stem of the genitive. */
export function testPattern(
  pattern: NounPattern,
  slots: ReadonlyMap<string, readonly string[]>,
): string[] {
  const e = ENDINGS[pattern];
  const singular = (slots.get('s2') ?? []).length > 0;
  const stemSlot = singular ? 's2' : 'p1';
  const stems = new Set<string>();
  for (const f of slots.get(stemSlot) ?? [])
    for (const end of e[stemSlot] ?? []) {
      const ff = foldAscii(f);
      if (ff.endsWith(end)) stems.add(ff.slice(0, ff.length - end.length));
    }
  if (stems.size === 0) return [stemSlot];
  const failed: string[] = [];
  for (const slot of TESTED) {
    if (slot === stemSlot || SKIP[pattern]?.includes(slot)) continue;
    const forms = slots.get(slot);
    if (!forms || forms.length === 0) continue;
    const ok = forms.some((f) => {
      const ff = foldAscii(f);
      return [...stems].some((st) => (e[slot] ?? []).some((end) => ff === st + end));
    });
    if (!ok) failed.push(slot);
  }
  return failed;
}

export function assignNounPattern(n: NounInput): NounPatternResult {
  if (n.slots.size === 0) return { irregular: false, reason: 'no forms' };
  if (n.paradigm === 'A') return { irregular: false, reason: 'adjectival' };
  if (n.paradigm === 'U') return { irregular: false, reason: 'indeclinable' };
  const pattern = choosePattern(n);
  if (!pattern) return { irregular: true, reason: 'no rule' };
  const failed = testPattern(pattern, n.slots);
  return failed.length > 0 ? { pattern, irregular: true, failed } : { pattern, irregular: false };
}

export interface AdjInput {
  lemma: string;
  /** A, F or U for adjectives; k or t for participles. */
  paradigm: string;
  /** Forms by agreeing tag (s1m … p7n). */
  slots: ReadonlyMap<string, readonly string[]>;
}

export type AdjPatternResult = { pattern?: AdjPattern; irregular: boolean };

export function assignAdjPattern(a: AdjInput): AdjPatternResult {
  if (a.paradigm === 'U') return { irregular: false };
  const gen = a.slots.get('s2m') ?? a.slots.get('s2i') ?? a.slots.get('s2n') ?? [];
  if (a.paradigm === 'F') return { pattern: 'otcov', irregular: !ends(gen, 'ho') };
  const lemma = foldAscii(a.lemma);
  const pattern: AdjPattern | undefined = lemma.endsWith('y')
    ? 'pekny'
    : lemma.endsWith('i')
      ? 'cudzi'
      : undefined;
  if (!pattern) return { irregular: true };
  return { pattern, irregular: gen.length > 0 && !ends(gen, 'eho') };
}
