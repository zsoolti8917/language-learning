// Known forms and the vocabulary profile of a Slovak text (docs/work-packages.md, C5). The
// library stage, the scenarios check and validate share it: a text is split with the
// tokenizer of packages/ling, each word is looked up among the forms of the morphology, and
// the share of words whose lemma ranks within the most common N is measured.
import { tokenize } from '@app/ling';

/** An A2 text has at least A2_MIN_SHARE of its words within the A2_WITHIN_RANK most common lemmas. */
export const A2_WITHIN_RANK = 2000;
export const A2_MIN_SHARE = 0.9;

/** What the profile needs to know of a lemma. */
export interface LemmaInfo {
  lemma: string;
  /** freqRank; undefined beyond the ranked list. */
  rank?: number;
  /** A proper name (flags.proper): Bratislava, Peter. */
  proper: boolean;
}

/** The word tokens of a text, as written. Numbers and punctuation are left out. */
export function wordsOf(text: string): string[] {
  return tokenize(text)
    .filter((t) => t.t === 'word')
    .map((t) => text.slice(t.s, t.e));
}

/**
 * The spellings a word may be listed under: as written and, when it holds a capital, in lower
 * case. A sentence starts with a capital, and forms keep the capitals of names (Bratislave).
 */
export function spellingsOf(word: string): string[] {
  const lower = word.toLocaleLowerCase('sk');
  return lower === word ? [word] : [word, lower];
}

/** Every spelling the words of these texts may need. */
export function wantedSpellings(texts: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const text of texts)
    for (const w of wordsOf(text)) for (const s of spellingsOf(w)) out.add(s);
  return out;
}

/** The lemmas of each wanted spelling, built from a stream of form rows. */
export class FormIndex {
  private readonly byForm = new Map<string, number[]>();

  constructor(readonly wanted: ReadonlySet<string>) {}

  add(form: string, lemmaId: number): void {
    if (!this.wanted.has(form)) return;
    const list = this.byForm.get(form);
    if (!list) this.byForm.set(form, [lemmaId]);
    else if (!list.includes(lemmaId)) list.push(lemmaId);
  }

  /** The lemma ids a word as written can belong to. */
  candidates(word: string): number[] {
    const out: number[] = [];
    for (const s of spellingsOf(word))
      for (const id of this.byForm.get(s) ?? []) if (!out.includes(id)) out.push(id);
    return out;
  }
}

/** Reads form rows (`{ lemmaId, form }`) once and keeps only the spellings the texts need. */
export async function buildFormIndex(
  texts: Iterable<string>,
  rows: AsyncIterable<{ lemmaId: number; form: string }>,
): Promise<FormIndex> {
  const index = new FormIndex(wantedSpellings(texts));
  for await (const r of rows) index.add(r.form, r.lemmaId);
  return index;
}

export interface OutsideWord {
  word: string;
  lemma: string;
  rank: number | null;
}

export interface TextProfile {
  /** Word tokens. */
  words: number;
  /** Distinct words that are no known form, in order of appearance. */
  unknown: string[];
  /** Word tokens whose every reading is a proper name. They are left out of the share. */
  names: number;
  /** Word tokens the share counts: known, and not only a name. */
  counted: number;
  /** Counted tokens with a reading ranked within `withinRank`. */
  within: number;
  /** within / counted (1 for a text with nothing to count). */
  share: number;
  withinRank: number;
  /** Distinct lemmas, taking the best ranked reading of each token. */
  lemmas: number;
  /** Distinct words outside the limit, in order of appearance. */
  outside: OutsideWord[];
}

/**
 * The vocabulary profile of a text. A word counts as within the limit when one of its readings
 * (a lemma that is not a proper name) ranks within `withinRank`: a form shared by a common and a
 * rare lemma is almost always the common one.
 */
export function profileText(
  text: string,
  index: FormIndex,
  lemmas: ReadonlyMap<number, LemmaInfo>,
  withinRank: number = A2_WITHIN_RANK,
): TextProfile {
  const unknown: string[] = [];
  const outside = new Map<string, OutsideWord>();
  const seenLemmas = new Set<number>();
  let words = 0;
  let unknownTokens = 0;
  let names = 0;
  let within = 0;
  for (const word of wordsOf(text)) {
    words++;
    const readings = index.candidates(word).filter((id) => lemmas.has(id));
    if (readings.length === 0) {
      unknownTokens++;
      if (!unknown.includes(word)) unknown.push(word);
      continue;
    }
    const common = readings.filter((id) => !(lemmas.get(id) as LemmaInfo).proper);
    if (common.length === 0) {
      names++;
      seenLemmas.add(readings[0] as number);
      continue;
    }
    const rankOf = (id: number) => (lemmas.get(id) as LemmaInfo).rank ?? Number.POSITIVE_INFINITY;
    const best = common.reduce((a, b) =>
      rankOf(b) < rankOf(a) || (rankOf(b) === rankOf(a) && b < a) ? b : a,
    );
    seenLemmas.add(best);
    if (rankOf(best) <= withinRank) within++;
    else if (!outside.has(word)) {
      const info = lemmas.get(best) as LemmaInfo;
      outside.set(word, { word, lemma: info.lemma, rank: info.rank ?? null });
    }
  }
  const counted = words - unknownTokens - names;
  return {
    words,
    unknown,
    names,
    counted,
    within,
    share: counted === 0 ? 1 : within / counted,
    withinRank,
    lemmas: seenLemmas.size,
    outside: [...outside.values()],
  };
}
