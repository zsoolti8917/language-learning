// Maps one entry of the SNK morphological database (lemma, form, tag) to the shared vocabulary:
// a part of speech, a gender for nouns, and a form tag (docs/contracts.md, "Form tags").
// The tagset is described in tagset-www.pdf, linked from the SNK annotation page.
import type { Aspect, Case, Gender, Pos } from '@app/contracts';

export const CASE_BY_DIGIT: Record<string, Case> = {
  '1': 'nom',
  '2': 'gen',
  '3': 'dat',
  '4': 'acc',
  '5': 'voc',
  '6': 'loc',
  '7': 'ins',
};

/** SNK gender letters → the Gender of a noun. */
export const NOUN_GENDER: Record<string, Gender> = { m: 'm_anim', i: 'm_inan', f: 'f', n: 'n' };

export const ASPECT_BY_LETTER: Record<string, Aspect> = { d: 'pf', e: 'ipf', j: 'both' };

/**
 * Part of speech by SNK word class. Pronouns and numerals of the adverbial paradigm
 * (PD: kde, kam, ako; ND: prvýkrát, dvojmo) count as adverbs. Participles (G) are
 * adjectives: they decline like them and SNK lemmatizes them as their own adjective.
 */
export const POS_BY_CLASS: Record<string, Pos> = {
  S: 'noun',
  A: 'adj',
  G: 'adj',
  P: 'pron',
  N: 'num',
  V: 'verb',
  D: 'adv',
  E: 'prep',
  O: 'conj',
  T: 'part',
  J: 'intj',
  R: 'other',
  Y: 'other',
  W: 'other',
  Q: 'other',
  '%': 'other',
  Z: 'other',
  '#': 'other',
  '0': 'other',
};

export type DropReason = 'misspelling' | 'degree' | 'unparsed';

export interface MappedEntry {
  ok: true;
  pos: Pos;
  /** Nouns only. */
  gender?: Gender;
  /** The SNK paradigm letter (S, A, F, U, P, N, D, or k/t for participles). */
  paradigm: string;
  /**
   * The form tag. Agreeing words get number, case and SNK gender letter (`s2m`); the
   * pronoun step later turns tags of pronouns without agreement into `x` + case.
   */
  tag: string;
  /** True for a pronoun whose SNK gender is h (general): ja, ty, my, vy, seba. */
  general?: boolean;
  aspect?: Aspect;
  /** The verb form letter (I infinitive, K present, ...). */
  verbForm?: string;
  /** For prepositions: the case this reading governs. */
  governs?: Case;
  /** SNK marked a proper name (`:r`). */
  proper: boolean;
}

export type MapResult = MappedEntry | { ok: false; reason: DropReason };

const NOUN = /^S([SAFU])([mifn])([sp])([1-7])$/u;
const ADJ = /^A([AFU])([mifn])([sp])([1-7])([xyz])$/u;
const PART = /^G([kt])([mifn])([sp])([1-7])([xyz])$/u;
const PRON = /^P([SAPFUD])(?:([mifnh])([sp])([1-7])g?)?$/u;
const NUM = /^N([SANFUD])(?:([mifn])([sp])([1-7]))?$/u;
const VERB = /^V([IKMHLB])([dej])(.*)$/u;
const ADV = /^D([xyz])$/u;
const PREP = /^E([vu])([234567])$/u;
const SIMPLE = /^(?:OY?|TY?|J|R|Y|W|Q|%|Z|#|0)$/u;

/** Maps one SNK entry. Entries marked as errors (`*` before the lemma or form, or `:q`) drop. */
export function mapSnk(lemma: string, form: string, rawTag: string): MapResult {
  let tag = rawTag;
  let proper = false;
  const colon = tag.indexOf(':');
  if (colon >= 0) {
    const mark = tag.slice(colon + 1);
    tag = tag.slice(0, colon);
    if (mark === 'q') return { ok: false, reason: 'misspelling' };
    if (mark === 'r') proper = true;
    else return { ok: false, reason: 'unparsed' };
  }
  if (lemma.startsWith('*') || form.startsWith('*')) return { ok: false, reason: 'misspelling' };
  if (lemma === '' || form === '') return { ok: false, reason: 'unparsed' };

  let m: RegExpExecArray | null;
  switch (tag[0]) {
    case 'S':
      m = NOUN.exec(tag);
      if (!m) break;
      return {
        ok: true,
        pos: 'noun',
        gender: NOUN_GENDER[m[2] as string],
        paradigm: m[1] as string,
        tag: `${m[3]}${m[4]}`,
        proper,
      };
    case 'A':
      m = ADJ.exec(tag);
      if (!m) break;
      if (m[5] !== 'x') return { ok: false, reason: 'degree' };
      return {
        ok: true,
        pos: 'adj',
        paradigm: m[1] as string,
        tag: `${m[3]}${m[4]}${m[2]}`,
        proper,
      };
    case 'G':
      m = PART.exec(tag);
      if (!m) break;
      if (m[5] !== 'x') return { ok: false, reason: 'degree' };
      return {
        ok: true,
        pos: 'adj',
        paradigm: m[1] as string,
        tag: `${m[3]}${m[4]}${m[2]}`,
        proper,
      };
    case 'P':
      m = PRON.exec(tag);
      if (!m) break;
      if (m[1] === 'D') return { ok: true, pos: 'adv', paradigm: 'D', tag: '', proper };
      if (m[2] === undefined) break;
      if (m[2] === 'h')
        return {
          ok: true,
          pos: 'pron',
          paradigm: m[1] as string,
          tag: `x${m[4]}`,
          general: true,
          proper,
        };
      return {
        ok: true,
        pos: 'pron',
        paradigm: m[1] as string,
        tag: `${m[3]}${m[4]}${m[2]}`,
        proper,
      };
    case 'N':
      m = NUM.exec(tag);
      if (!m) break;
      if (m[1] === 'D') return { ok: true, pos: 'adv', paradigm: 'D', tag: '', proper };
      if (m[2] === undefined)
        return { ok: true, pos: 'num', paradigm: m[1] as string, tag: '', proper };
      return {
        ok: true,
        pos: 'num',
        paradigm: m[1] as string,
        tag: `${m[3]}${m[4]}${m[2]}`,
        proper,
      };
    case 'V':
      m = VERB.exec(tag);
      if (!m) break;
      return {
        ok: true,
        pos: 'verb',
        paradigm: 'V',
        tag: `v:${tag.slice(1)}`,
        aspect: ASPECT_BY_LETTER[m[2] as string],
        verbForm: m[1] as string,
        proper,
      };
    case 'D':
      m = ADV.exec(tag);
      if (!m) break;
      if (m[1] !== 'x') return { ok: false, reason: 'degree' };
      return { ok: true, pos: 'adv', paradigm: 'D', tag: '', proper };
    case 'E':
      m = PREP.exec(tag);
      if (!m) break;
      return {
        ok: true,
        pos: 'prep',
        paradigm: m[1] as string,
        tag: '',
        governs: CASE_BY_DIGIT[m[2] as string],
        proper,
      };
    default:
      if (SIMPLE.test(tag))
        return {
          ok: true,
          pos: POS_BY_CLASS[tag[0] as string] as Pos,
          paradigm: tag,
          tag: '',
          proper,
        };
  }
  return { ok: false, reason: 'unparsed' };
}

const GENDER_ORDER = 'mifn';

/** Sort key of a form tag: s before p before x, then case, then gender; verbs after, by text. */
export function compareTags(a: string, b: string): number {
  const rank = (t: string): [number, number, number, string] => {
    if (t.startsWith('v:')) return [3, 0, 0, t];
    const num = t[0] === 's' ? 0 : t[0] === 'p' ? 1 : 2;
    const g = t.length > 2 ? GENDER_ORDER.indexOf(t[2] as string) : -1;
    return [num, Number(t[1]), g, ''];
  };
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return (ra[i] as number) - (rb[i] as number);
  return ra[3] < rb[3] ? -1 : ra[3] > rb[3] ? 1 : 0;
}
