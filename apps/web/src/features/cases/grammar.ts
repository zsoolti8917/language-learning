// Small facts about Slovak declension the feedback and the screens need.
// Every Slovak word here is a model word of the 16 patterns of the mini dataset
// (packages/testkit/mini/patterns.jsonl), never an invented form.
import type { Case, FormReading, Gender, GrammaticalNumber } from '@app/contracts';
import { foldAscii } from '@app/contracts';

/** Cases in school order, as the course shows them (the vocative is left out of the grid). */
export const GRID_CASES = ['nom', 'gen', 'dat', 'acc', 'loc', 'ins'] as const satisfies Case[];
export const ALL_CASES = [
  'nom',
  'gen',
  'dat',
  'acc',
  'voc',
  'loc',
  'ins',
] as const satisfies Case[];
export const NUMBERS = ['sg', 'pl'] as const satisfies GrammaticalNumber[];
export const GENDERS = ['m_anim', 'm_inan', 'f', 'n'] as const satisfies Gender[];

/** Pattern id (the model word without accents) to its model word. */
export const PATTERN_MODEL: Record<string, string> = {
  chlap: 'chlap',
  hrdina: 'hrdina',
  dub: 'dub',
  stroj: 'stroj',
  kuli: 'kuli',
  zena: 'žena',
  ulica: 'ulica',
  dlan: 'dlaň',
  kost: 'kosť',
  gazdina: 'gazdiná',
  mesto: 'mesto',
  srdce: 'srdce',
  vysvedcenie: 'vysvedčenie',
  dievca: 'dievča',
  pekny: 'pekný',
  cudzi: 'cudzí',
};

/** The noun patterns in the order of the school tables. */
export const NOUN_PATTERNS = [
  'chlap',
  'hrdina',
  'dub',
  'stroj',
  'kuli',
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
export const ADJECTIVE_PATTERNS = ['pekny', 'cudzi'] as const;

/**
 * Hard and soft pairs: the stem ends in a hard or a soft consonant. Only the patterns that
 * form a clear pair are listed; the others get a plain "declines like" sentence.
 */
export const SOFTNESS: Record<string, 'hard' | 'soft'> = {
  dub: 'hard',
  stroj: 'soft',
  zena: 'hard',
  ulica: 'soft',
  dlan: 'soft',
  mesto: 'hard',
  srdce: 'soft',
  pekny: 'hard',
  cudzi: 'soft',
};

export function patternModel(id: string | undefined): string | undefined {
  return id === undefined ? undefined : PATTERN_MODEL[id];
}

/** Capitalises the first letter, as at the start of a sentence: ulica → Ulica. */
export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]?.toLocaleUpperCase('sk') + s.slice(1);
}

/** The trigger word of a label such as "do + genitive" → "do". */
export function triggerWord(label: string): string {
  const i = label.indexOf(' + ');
  return (i < 0 ? label : label.slice(0, i)).trim();
}

/** The word right before the gap, or null at the start of the sentence. */
export function wordBefore(sentence: string, start: number): string | null {
  const head = sentence.slice(0, start).trimEnd();
  const match = /[\p{L}\p{M}]+$/u.exec(head);
  return match ? match[0] : null;
}

/** Readings without the vocative (rare and confusing in feedback) unless that is all there is. */
export function usefulReadings(readings: readonly FormReading[]): FormReading[] {
  const withCase = readings.filter((r) => r.case !== undefined);
  const noVoc = withCase.filter((r) => r.case !== 'voc');
  const list = noVoc.length > 0 ? noVoc : withCase;
  const seen = new Set<string>();
  return list.filter((r) => {
    const key = `${r.case}.${r.number ?? ''}.${r.gender ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The accented letters of the expected answer that the typed one misses or gets wrong, when
 * both have the same letters once accents are folded: zenam / ženám → ['ž', 'á'].
 */
export function accentSlips(typed: string, answer: string): string[] {
  const a = [...typed.normalize('NFC').trim().toLowerCase()];
  const b = [...answer.normalize('NFC').toLowerCase()];
  if (a.length !== b.length) return [];
  const out: string[] = [];
  for (let i = 0; i < b.length; i++) {
    const want = b[i] as string;
    if (a[i] !== want && foldAscii(a[i] ?? '') === foldAscii(want)) {
      // Name the letters that should carry an accent.
      if (want !== foldAscii(want) && !out.includes(want)) out.push(want);
    }
  }
  return out;
}
