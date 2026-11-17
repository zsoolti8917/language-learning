// Sentence splitter and tokenizer (docs/contracts.md, "Text analysis").
// Offsets are UTF-16 code unit indices into the text as it was given, end exclusive,
// so `text.slice(s, e)` is the token. Nothing is normalised before splitting.
import type { Span, TokenType } from '@app/contracts';

/** One token: its offsets in the text and its type. */
export type Token = { s: number; e: number; t: TokenType };

// --- Tokenizer -----------------------------------------------------------------

/**
 * A word is a letter with the letters and combining marks after it. A number is a run of
 * digits, with inner groups joined by one full stop or comma (`3,5`, `17.11.2026`).
 * Anything else that is not white space is one punctuation token, with its combining marks.
 */
const TOKEN = /(\p{L}[\p{L}\p{M}]*)|(\p{N}+(?:[.,]\p{N}+)*)|([^\s\p{L}\p{N}]\p{M}*)/gu;

/** Splits a text into words, numbers and punctuation, keeping character offsets. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const s = m.index;
    const e = s + m[0].length;
    const t: TokenType = m[1] !== undefined ? 'word' : m[2] !== undefined ? 'num' : 'punct';
    tokens.push({ s, e, t });
  }
  return tokens;
}

// --- Sentence splitter -----------------------------------------------------------

/**
 * Abbreviations that do not end a sentence even when a capital letter follows: titles before
 * a name (*Ing. Novák*, *p. Kováčová*, *sv. Martin*) and words that always lead on
 * (*napr.*, *tzv.*, *resp.*, *ul.*, *str.*). Lower case, without the full stop.
 * Single letters (*t. j.*, *J. Kráľ*) are handled apart.
 */
export const NON_FINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'bc',
  'csc',
  'čl',
  'doc',
  'dr',
  'gen',
  'hl',
  'ing',
  'judr',
  'kap',
  'kpt',
  'mgr',
  'mudr',
  'mvdr',
  'napr',
  'obr',
  'ods',
  'paeddr',
  'phdr',
  'pí',
  'písm',
  'plk',
  'por',
  'pozn',
  'príp',
  'prof',
  'resp',
  'rndr',
  'sl',
  'str',
  'sv',
  'tab',
  'tel',
  'tzv',
  'ul',
  'vs',
  'zb',
]);

/**
 * Abbreviations that may end a sentence (*atď.*, *a pod.*, *10 min.*). A capital letter after
 * them starts a new sentence; a digit or a small letter does not.
 */
export const FINAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'atď',
  'hod',
  'km',
  'ks',
  'max',
  'min',
  'mil',
  'mld',
  'pod',
  'roč',
  'sek',
  'st',
  'tis',
]);

/** A run of sentence-final marks with the closing quotes and brackets after it, or a line break. */
const BOUNDARY = /([.!?…]+)["'”“»«’‘)\]]*|\n/gu;
const LOWER = /^\p{Ll}/u;
const UPPER = /^\p{Lu}/u;
const DIGIT = /^\p{N}/u;
const WORD_BEFORE = /[\p{L}\p{M}]+$/u;
const NUMBER_BEFORE = /\p{N}+$/u;
const ROMAN = /^[IVXLCDM]{2,}$/u;
const SPACE = /\s/u;
/** A line that ends with one of these continues on the next line. */
const CONTINUES = /[,;:(\-–—„]$/u;

function nextNonSpace(text: string, from: number): number {
  let j = from;
  while (j < text.length && SPACE.test(text[j] as string)) j++;
  return j;
}

/** Whether the full stop of a boundary at `dot` ends a sentence whose next text starts at `next`. */
function periodEnds(text: string, sentenceStart: number, dot: number, next: string): boolean {
  const before = text.slice(Math.max(sentenceStart, dot - 24), dot);
  const word = WORD_BEFORE.exec(before)?.[0];
  if (word !== undefined) {
    const lower = word.toLowerCase();
    // One letter: an initial or a part of t. j., a. s., s. r. o.
    if ([...word].length === 1) return false;
    if (NON_FINAL_ABBREVIATIONS.has(lower)) return false;
    // A Roman ordinal: Karol IV. Luxemburský.
    if (ROMAN.test(word)) return false;
    if (DIGIT.test(next) && FINAL_ABBREVIATIONS.has(lower)) return false;
    return true;
  }
  const number = NUMBER_BEFORE.exec(before)?.[0];
  if (number !== undefined) {
    // A date written with spaces, 17. 11. 2026, or an ordinal before a number.
    if (DIGIT.test(next)) return false;
    // A numbered heading or list item, "1. Úvod": the number is the whole sentence so far.
    if (text.slice(sentenceStart, dot).trim() === number) return false;
  }
  return true;
}

/**
 * Splits a text into sentences. It knows Slovak abbreviations (*napr.*, *Ing.*, *t. j.*) and
 * ordinals (*1. mája*, *21. storočie*, *Karol IV.*, *17. 11. 2026*). A sentence ends at
 * `.`, `!`, `?` or `…` (with closing quotes and brackets) when white space and then no small
 * letter follow; at an empty line; and at a line break followed by a capital letter or an
 * opening quote or dash, unless the line ends with a comma, colon or the like.
 * Spans are trimmed of white space, in order, never overlap, and together hold every
 * character that is not white space.
 */
export function splitSentences(text: string): Span[] {
  const spans: Span[] = [];
  let start = 0;

  const cut = (end: number) => {
    let a = start;
    let b = end;
    while (a < b && SPACE.test(text[a] as string)) a++;
    while (b > a && SPACE.test(text[b - 1] as string)) b--;
    if (b > a) spans.push({ start: a, end: b });
    start = end;
  };

  for (const m of text.matchAll(BOUNDARY)) {
    const at = m.index;
    const end = at + m[0].length;
    if (end <= start) continue;

    if (m[1] === undefined) {
      // A line break.
      const j = nextNonSpace(text, end);
      if (j >= text.length) continue;
      const gap = text.slice(end, j);
      if (gap.includes('\n')) {
        cut(at);
        continue;
      }
      const line = text.slice(start, at).trimEnd();
      if (line === '' || CONTINUES.test(line)) continue;
      const c = String.fromCodePoint(text.codePointAt(j) as number);
      if (UPPER.test(c) || /^["„“«»\-–—•]/u.test(c)) cut(at);
      continue;
    }

    const j = nextNonSpace(text, end);
    if (j >= text.length) {
      cut(end);
      continue;
    }
    if (j === end) continue; // no white space: 3.14, www.sme.sk, napr.Bratislava
    const next = String.fromCodePoint(text.codePointAt(j) as number);
    if (LOWER.test(next)) continue;
    if (m[1] === '.' && !periodEnds(text, start, at, next)) continue;
    cut(end);
  }
  cut(text.length);
  return spans;
}
