// The rules a sentence must pass (docs/architecture.md, "Rules the pipeline follows"):
// 4 to 12 words, every other word within the most common lemmas, and the target word in
// one of its most used forms. Also the difficulty score and the choice per lemma.
import type { SentenceRow } from '@app/contracts';
import { type Analysis, lemmasOf, type TokenAnalysis, tagsOf } from './analyze';
import type { Lexicon } from './lexicon';

export const MIN_WORDS = 4;
export const MAX_WORDS = 12;
/** Sentences per lemma: at least MIN_PER_LEMMA, at most MAX_PER_LEMMA. */
export const MIN_PER_LEMMA = 2;
export const MAX_PER_LEMMA = 3;

export type Rejection =
  /** Fewer than 4 or more than 12 words. */
  | 'length'
  /** A number written in digits. */
  | 'number'
  /** Quotes, brackets or other marks, or no capital at the start and no final mark. */
  | 'punctuation'
  /** A word the morphology does not know (or a typo the treebank marks). */
  | 'unknown'
  /** A word outside the most common lemmas. */
  | 'rare'
  /** The target form is not in the sentence. */
  | 'target-missing'
  /** The target word is there, but not in one of its most used forms. */
  | 'not-top-form'
  /** The target word could be another lemma or another form tag. */
  | 'ambiguous';

export const REJECTIONS: readonly Rejection[] = [
  'length',
  'number',
  'punctuation',
  'unknown',
  'rare',
  'target-missing',
  'not-top-form',
  'ambiguous',
];

const ALLOWED_PUNCT = new Set([',', '.', '?', '!', '…', ':', ';', '-', '–']);
const FINAL = /[.?!…]$/u;
const CAPITAL = /^\p{Lu}/u;

/** Why the sentence as a whole fails, or null. The target is checked apart. */
export function sentenceProblem(a: Analysis, lex: Lexicon): Rejection | null {
  if (a.words < MIN_WORDS || a.words > MAX_WORDS) return 'length';
  if (a.tokens.some((t) => t.t === 'num')) return 'number';
  if (
    !CAPITAL.test(a.text) ||
    !FINAL.test(a.text) ||
    a.tokens.some((t) => t.t === 'punct' && !ALLOWED_PUNCT.has(t.text))
  )
    return 'punctuation';
  for (const t of a.tokens) if (t.t === 'word' && t.readings.length === 0) return 'unknown';
  for (const t of a.tokens)
    if (t.t === 'word' && !lemmasOf(t).some((id) => lex.common(id))) return 'rare';
  return null;
}

/** A word of a sentence that shows a lemma. */
export interface Target {
  tokenIndex: number;
  lemmaId: number;
  form: string;
  tag: string;
}

/**
 * Every word of a sentence that can show its lemma: one lemma, ranked within the top, one
 * form tag left, and that form among the lemma's most used forms. With `rejected`, the
 * reason each other common word fails is counted there.
 */
export function targetsOf(a: Analysis, lex: Lexicon, rejected?: Map<Rejection, number>): Target[] {
  const out: Target[] = [];
  const no = (r: Rejection) => rejected?.set(r, (rejected.get(r) ?? 0) + 1);
  for (const [i, t] of a.tokens.entries()) {
    if (t.t !== 'word') continue;
    const lemmas = lemmasOf(t);
    if (!lemmas.some((id) => lex.common(id))) continue;
    if (lemmas.length !== 1) {
      no('ambiguous');
      continue;
    }
    const lemmaId = lemmas[0] as number;
    const tags = tagsOf(t, lemmaId);
    if (tags.length !== 1) {
      no('ambiguous');
      continue;
    }
    const tag = tags[0] as string;
    if (!lex.isTopForm(lemmaId, t.text, tag)) {
      no('not-top-form');
      continue;
    }
    out.push({ tokenIndex: i, lemmaId, form: t.text, tag });
  }
  return out;
}

/**
 * The target of a generated sentence: the word written as the requested form with the
 * requested lemma and tag among its readings. The request settles which reading is meant;
 * the review pass checks it.
 */
export function requestedTarget(
  a: Analysis,
  lex: Lexicon,
  want: { lemmaId: number; form: string; tag: string },
): Target | Rejection {
  const f = want.form.toLowerCase();
  const tok = a.tokens.findIndex(
    (t) =>
      t.t === 'word' &&
      t.text.toLowerCase() === f &&
      t.readings.some((r) => r.lemmaId === want.lemmaId && r.tag === want.tag),
  );
  if (tok < 0) return 'target-missing';
  const t = a.tokens[tok] as TokenAnalysis;
  if (!lex.isTopForm(want.lemmaId, t.text, want.tag)) return 'not-top-form';
  return { tokenIndex: tok, lemmaId: want.lemmaId, form: t.text, tag: want.tag };
}

/** Rejects a generated sentence by the rules, or gives its target. */
export function checkGenerated(
  a: Analysis,
  lex: Lexicon,
  want: { lemmaId: number; form: string; tag: string },
): Target | Rejection {
  return sentenceProblem(a, lex) ?? requestedTarget(a, lex, want);
}

/**
 * 0 easy to 1 hard: the length (4 words 0, 12 words 1) and the rank of the words (rank 1
 * is 0, the last common rank is 1, on a log scale), mean and rarest. A word that may be
 * several lemmas counts with its best rank.
 */
export function difficulty(a: Analysis, lex: Lexicon): number {
  const scale = Math.log(Math.max(2, lex.top));
  const ranks: number[] = [];
  for (const t of a.tokens) {
    if (t.t !== 'word') continue;
    const r = Math.min(...lemmasOf(t).map((id) => lex.rankOf(id) ?? lex.top));
    ranks.push(Math.min(1, Math.log(Math.max(1, r)) / scale));
  }
  if (ranks.length === 0) return 1;
  const len = Math.min(1, Math.max(0, (a.words - MIN_WORDS) / (MAX_WORDS - MIN_WORDS)));
  const mean = ranks.reduce((x, y) => x + y, 0) / ranks.length;
  const max = Math.max(...ranks);
  const d = 0.35 * len + 0.45 * mean + 0.2 * max;
  return Math.round(Math.min(1, Math.max(0, d)) * 1000) / 1000;
}

/** The tokens of a row: a lemma when one is left, a tag when one is left for it. */
export function rowTokens(a: Analysis, targets: readonly Target[]): SentenceRow['tokens'] {
  return a.tokens.map((t, i) => {
    const target = targets.find((x) => x.tokenIndex === i);
    if (target) return { s: t.s, e: t.e, lemmaId: target.lemmaId, tag: target.tag };
    const lemmas = lemmasOf(t);
    if (lemmas.length !== 1) return { s: t.s, e: t.e };
    const lemmaId = lemmas[0] as number;
    const tags = tagsOf(t, lemmaId);
    return tags.length === 1
      ? { s: t.s, e: t.e, lemmaId, tag: tags[0] as string }
      : { s: t.s, e: t.e, lemmaId };
  });
}

/** One sentence that can show one lemma. */
export interface Candidate {
  sentenceId: string;
  source: SentenceRow['source'];
  target: Target;
  difficulty: number;
}

/** Real sentences come first; a treebank one needs a model translation, a generated one is last. */
const PENALTY: Record<SentenceRow['source'], number> = { tatoeba: 0, ud: 0.05, generated: 0.1 };
const score = (c: Candidate) => c.difficulty + PENALTY[c.source];

/**
 * Up to `max` sentences for each lemma, easiest first, preferring different forms: first
 * the easiest sentence of each form (in order of ease), then the easiest of the rest.
 */
export function choose(
  candidates: Iterable<Candidate>,
  max: number = MAX_PER_LEMMA,
): Map<number, Candidate[]> {
  const byLemma = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const list = byLemma.get(c.target.lemmaId);
    if (list) list.push(c);
    else byLemma.set(c.target.lemmaId, [c]);
  }
  const out = new Map<number, Candidate[]>();
  for (const [lemmaId, list] of byLemma) {
    list.sort(
      (a, b) =>
        score(a) - score(b) ||
        (a.sentenceId < b.sentenceId ? -1 : a.sentenceId > b.sentenceId ? 1 : 0),
    );
    const picked: Candidate[] = [];
    const sentences = new Set<string>();
    const forms = new Set<string>();
    const formKey = (c: Candidate) => `${c.target.form.toLowerCase()}|${c.target.tag}`;
    for (const c of list) {
      if (picked.length >= max) break;
      if (sentences.has(c.sentenceId) || forms.has(formKey(c))) continue;
      picked.push(c);
      sentences.add(c.sentenceId);
      forms.add(formKey(c));
    }
    for (const c of list) {
      if (picked.length >= max) break;
      if (sentences.has(c.sentenceId)) continue;
      picked.push(c);
      sentences.add(c.sentenceId);
    }
    out.set(
      lemmaId,
      picked.sort((a, b) => score(a) - score(b)),
    );
  }
  return out;
}
