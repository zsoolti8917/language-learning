// Form tags (docs/contracts.md, "Form tags"). Only this package parses them.
import type { Case, FormReading, Gender, GrammaticalNumber } from '@app/contracts';

/** Case by the digit Slovak schools use: 1 nom ... 7 ins. */
const CASE_BY_DIGIT: Record<string, Case> = {
  '1': 'nom',
  '2': 'gen',
  '3': 'dat',
  '4': 'acc',
  '5': 'voc',
  '6': 'loc',
  '7': 'ins',
};
const DIGIT_BY_CASE: Record<Case, string> = {
  nom: '1',
  gen: '2',
  dat: '3',
  acc: '4',
  voc: '5',
  loc: '6',
  ins: '7',
};
const NUMBER_BY_LETTER: Record<string, GrammaticalNumber> = { s: 'sg', p: 'pl' };
const LETTER_BY_NUMBER: Record<GrammaticalNumber, string> = { sg: 's', pl: 'p' };
const GENDER_BY_LETTER: Record<string, Gender> = { m: 'm_anim', i: 'm_inan', f: 'f', n: 'n' };
const LETTER_BY_GENDER: Record<Gender, string> = { m_anim: 'm', m_inan: 'i', f: 'f', n: 'n' };

/** A decoded form tag. */
export type ParsedTag =
  /** Noun: number and case, `s2`. */
  | { kind: 'noun'; number: GrammaticalNumber; case: Case }
  /** Adjective, pronoun or numeral that agrees: number, case and gender, `p4f`. */
  | { kind: 'agree'; number: GrammaticalNumber; case: Case; gender: Gender }
  /** Pronoun without number: `x3`. */
  | { kind: 'pron'; case: Case }
  /** Verb: the rest of the source tag, opaque in the first release, `v:Kesc+`. */
  | { kind: 'verb'; detail: string }
  /** Anything else: the empty tag. */
  | { kind: 'none' };

const NOMINAL = /^([sp])([1-7])([mifn])?$/u;
const PRONOUN = /^x([1-7])$/u;
const VERB = /^v:(\S*)$/u;

/** Decodes one form tag, or returns null when it is not a form tag. */
export function tryParseTag(tag: string): ParsedTag | null {
  if (tag === '') return { kind: 'none' };
  const nominal = NOMINAL.exec(tag);
  if (nominal) {
    const number = NUMBER_BY_LETTER[nominal[1] as string] as GrammaticalNumber;
    const c = CASE_BY_DIGIT[nominal[2] as string] as Case;
    const g = nominal[3];
    return g === undefined
      ? { kind: 'noun', number, case: c }
      : { kind: 'agree', number, case: c, gender: GENDER_BY_LETTER[g] as Gender };
  }
  const pron = PRONOUN.exec(tag);
  if (pron) return { kind: 'pron', case: CASE_BY_DIGIT[pron[1] as string] as Case };
  const verb = VERB.exec(tag);
  if (verb) return { kind: 'verb', detail: verb[1] as string };
  return null;
}

/** Decodes one form tag. Throws a RangeError when it is not a form tag. */
export function parseTag(tag: string): ParsedTag {
  const parsed = tryParseTag(tag);
  if (!parsed) throw new RangeError(`not a form tag: ${JSON.stringify(tag)}`);
  return parsed;
}

/** Encodes a decoded tag. `formatTag(parseTag(t)) === t` for every valid tag. */
export function formatTag(tag: ParsedTag): string {
  switch (tag.kind) {
    case 'noun':
      return `${LETTER_BY_NUMBER[tag.number]}${DIGIT_BY_CASE[tag.case]}`;
    case 'agree':
      return `${LETTER_BY_NUMBER[tag.number]}${DIGIT_BY_CASE[tag.case]}${LETTER_BY_GENDER[tag.gender]}`;
    case 'pron':
      return `x${DIGIT_BY_CASE[tag.case]}`;
    case 'verb':
      return `v:${tag.detail}`;
    case 'none':
      return '';
  }
}

/** Splits a list of tags as stored in `ling.form.tags` ('p1 p4 p5'). Empty gives no tags. */
export function splitTags(tags: string): string[] {
  return tags.split(' ').filter((t) => t !== '');
}

/** Decodes a list of tags separated by spaces. Throws on an invalid tag. */
export function parseTags(tags: string): ParsedTag[] {
  return splitTags(tags).map(parseTag);
}

/** Encodes decoded tags as one string separated by spaces. */
export function formatTags(tags: readonly ParsedTag[]): string {
  return tags
    .map(formatTag)
    .filter((t) => t !== '')
    .join(' ');
}

/** Builds the tag of a case, number and gender: a noun tag without gender, an agreeing tag with. */
export function tagOf(features: {
  case: Case;
  number: GrammaticalNumber;
  gender?: Gender | undefined;
}): string {
  return features.gender === undefined
    ? formatTag({ kind: 'noun', number: features.number, case: features.case })
    : formatTag({
        kind: 'agree',
        number: features.number,
        case: features.case,
        gender: features.gender,
      });
}

/**
 * Turns one tag into case, number and gender, as JSON payloads carry them.
 * A noun tag has no gender of its own; pass the noun's gender to fill it in.
 */
export function readTag(tag: string, nounGender?: Gender): FormReading {
  const parsed = parseTag(tag);
  switch (parsed.kind) {
    case 'noun':
      return nounGender === undefined
        ? { tag, case: parsed.case, number: parsed.number }
        : { tag, case: parsed.case, number: parsed.number, gender: nounGender };
    case 'agree':
      return { tag, case: parsed.case, number: parsed.number, gender: parsed.gender };
    case 'pron':
      return { tag, case: parsed.case };
    case 'verb':
    case 'none':
      return { tag };
  }
}

/** Every reading of a list of tags (a string separated by spaces, or an array). */
export function readTags(tags: string | readonly string[], nounGender?: Gender): FormReading[] {
  const list = typeof tags === 'string' ? splitTags(tags) : tags;
  return list.map((t) => readTag(t, nounGender));
}

/** The case a tag expresses, or undefined for verbs and the empty tag. */
export function caseOfTag(tag: string): Case | undefined {
  const parsed = parseTag(tag);
  return parsed.kind === 'noun' || parsed.kind === 'agree' || parsed.kind === 'pron'
    ? parsed.case
    : undefined;
}
