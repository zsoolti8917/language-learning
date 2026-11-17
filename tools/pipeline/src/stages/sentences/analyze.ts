// Tokens with lemma and tag for one sentence. The text is split by the tokenizer of
// @app/ling; each word gets every reading the lexicon has for it. Treebank sentences then
// keep the reading the treebank's checked lemma and tag point at; every other word is
// narrowed by four rules: a lemma on the frequency list wins over lemmas off it, a vocative
// needs a comma or an exclamation beside it, a preposition limits the case of the noun
// phrase after it, and an adjective agrees with its noun.
import type { TokenType } from '@app/contracts';
import { type ParsedTag, tokenize, tryParseTag } from '@app/ling';
import { mapSnk } from '../morph/snk';
import type { Lexicon, Reading } from './lexicon';

/** A word of a treebank sentence: its offsets in the text, its lemma and its SNK tag. */
export interface UdWord {
  s: number;
  e: number;
  form: string;
  lemma: string;
  xpos: string;
}

export interface TokenAnalysis {
  s: number;
  e: number;
  t: TokenType;
  text: string;
  /** Readings still possible. Empty for a word the lexicon does not know. */
  readings: Reading[];
  /** `treebank` when the treebank's analysis chose the readings. */
  by: 'treebank' | 'rules';
}

export interface Analysis {
  text: string;
  tokens: TokenAnalysis[];
  /** Number of word tokens. */
  words: number;
}

/** Whether a lexicon reading fits the treebank's lemma and tag. */
function fitsTreebank(lex: Lexicon, r: Reading, w: UdWord): boolean | null {
  const m = mapSnk(w.lemma, w.form, w.xpos);
  if (!m.ok) return null;
  const l = lex.lemmas.get(r.lemmaId);
  if (!l || l.pos !== m.pos) return false;
  if (r.tag === m.tag) return true;
  // Pronouns without agreement carry `x` + case in the morphology.
  return r.tag.startsWith('x') && /^[sp]\d/u.test(m.tag) && r.tag[1] === m.tag[1];
}

function treebankReadings(lex: Lexicon, readings: Reading[], w: UdWord): Reading[] | null {
  if (!mapSnk(w.lemma, w.form, w.xpos).ok) return null;
  const fit = readings.filter((r) => fitsTreebank(lex, r, w));
  const same = fit.filter(
    (r) => lex.lemmas.get(r.lemmaId)?.lemma.toLowerCase() === w.lemma.toLowerCase(),
  );
  return same.length > 0 ? same : fit;
}

const parsed = (r: Reading): ParsedTag | null => tryParseTag(r.tag);
const isVocative = (r: Reading): boolean => {
  const p = parsed(r);
  return p !== null && 'case' in p && p.case === 'voc';
};
const isNominal = (r: Reading): boolean => {
  const p = parsed(r);
  return p !== null && (p.kind === 'noun' || p.kind === 'agree' || p.kind === 'pron');
};
const isModifier = (t: TokenAnalysis): boolean =>
  t.readings.length > 0 && t.readings.every((r) => parsed(r)?.kind === 'agree');

/** Keeps the readings that pass, unless none would. */
function narrow(t: TokenAnalysis, keep: (r: Reading) => boolean): void {
  if (t.by === 'treebank') return;
  const kept = t.readings.filter(keep);
  if (kept.length > 0) t.readings = kept;
}

function agrees(lex: Lexicon, mod: Reading, other: Reading): boolean {
  const a = parsed(mod);
  const b = parsed(other);
  if (a?.kind !== 'agree' || !b) return false;
  if (b.kind === 'agree')
    return a.number === b.number && a.case === b.case && a.gender === b.gender;
  if (b.kind !== 'noun') return false;
  const g = lex.lemmas.get(other.lemmaId)?.gender;
  return a.number === b.number && a.case === b.case && (g === undefined || a.gender === g);
}

function applyRules(lex: Lexicon, tokens: TokenAnalysis[]): void {
  const words = tokens;
  // A lemma outside the frequency list gives way to one in it: *a* is the conjunction, not
  // the letter (a noun in the morphology) or the interjection.
  for (const t of words) {
    if (!t.readings.some((r) => lex.rankOf(r.lemmaId) !== undefined)) continue;
    narrow(t, (r) => lex.rankOf(r.lemmaId) !== undefined);
  }
  // Vocative only beside a comma or before an exclamation mark.
  for (const [i, t] of words.entries()) {
    const prev = words[i - 1]?.text;
    const next = words[i + 1]?.text;
    if (prev === ',' || next === ',' || next === '!') continue;
    narrow(t, (r) => !isVocative(r));
  }
  // A preposition limits the case of the phrase after it, up to and including its noun.
  for (const [i, t] of words.entries()) {
    if (t.readings.length === 0) continue;
    const preps = t.readings.map((r) => lex.lemmas.get(r.lemmaId));
    if (!preps.every((l) => l?.pos === 'prep' && l.cases && l.cases.length > 0)) continue;
    const cases = new Set(preps.flatMap((l) => l?.cases ?? []));
    for (let j = i + 1; j < words.length; j++) {
      const n = words[j] as TokenAnalysis;
      if (n.t !== 'word' || !n.readings.some(isNominal)) break;
      narrow(n, (r) => {
        const p = parsed(r);
        return p !== null && 'case' in p && cases.has(p.case);
      });
      if (!isModifier(n)) break;
    }
  }
  // Agreement, from the noun leftwards through its adjectives.
  for (let j = words.length - 2; j >= 0; j--) {
    const mod = words[j] as TokenAnalysis;
    const head = words[j + 1] as TokenAnalysis;
    if (!isModifier(mod) || head.t !== 'word' || head.readings.length === 0) continue;
    if (!head.readings.some((h) => mod.readings.some((m) => agrees(lex, m, h)))) continue;
    narrow(head, (h) => mod.readings.some((m) => agrees(lex, m, h)));
    narrow(mod, (m) => head.readings.some((h) => agrees(lex, m, h)));
  }
}

/**
 * Tokens and readings of a sentence. `ud` holds the treebank's words; a token whose offsets
 * equal a treebank word's takes the reading the treebank chose (none if the treebank marks
 * the word as a typo or a comparative).
 */
export function analyse(text: string, lex: Lexicon, ud?: readonly UdWord[]): Analysis {
  const byOffsets = new Map<string, UdWord>();
  for (const w of ud ?? []) byOffsets.set(`${w.s}:${w.e}`, w);
  let first = true;
  const tokens: TokenAnalysis[] = tokenize(text).map((tok) => {
    const word = text.slice(tok.s, tok.e);
    const out: TokenAnalysis = { ...tok, text: word, readings: [], by: 'rules' };
    if (tok.t !== 'word') return out;
    out.readings = lex.readings(word, first);
    first = false;
    const w = byOffsets.get(`${tok.s}:${tok.e}`);
    if (w) {
      const tb = treebankReadings(lex, out.readings, w);
      if (tb === null) out.readings = [];
      else if (tb.length > 0) {
        out.readings = tb;
        out.by = 'treebank';
      }
    }
    return out;
  });
  applyRules(lex, tokens);
  return { text, tokens, words: tokens.filter((t) => t.t === 'word').length };
}

/** The lemma ids a token can still be. */
export function lemmasOf(t: TokenAnalysis): number[] {
  return [...new Set(t.readings.map((r) => r.lemmaId))];
}

/** The tags a token can still have for one lemma. */
export function tagsOf(t: TokenAnalysis, lemmaId: number): string[] {
  return [...new Set(t.readings.filter((r) => r.lemmaId === lemmaId).map((r) => r.tag))];
}
