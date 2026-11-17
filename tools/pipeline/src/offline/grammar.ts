// Hints from the morphology that a written sentence may break government or agreement. They
// read every word with all its readings (not the narrowed ones of analyze.ts, which always
// keeps at least one reading) and report where no reading fits:
// - a preposition followed by a noun phrase that has no reading in a case the preposition
//   takes ("do meste");
// - an adjective or agreeing pronoun before a noun with which it shares no case, number and
//   gender ("pekná dom").
// A hint is not a verdict: an adjective can govern the noun after it (plný vody). The writer
// and the reviewer of an offline answer read the hints and decide. A quantity word with one
// neuter form (niekoľko, koľko, toľko) takes the genitive after it and gives no hint.
import { type ParsedTag, tokenize, tryParseTag } from '@app/ling';
import type { Lexicon, Reading } from '../stages/sentences/lexicon';

interface Word {
  text: string;
  readings: Reading[];
}

const parsed = (r: Reading): ParsedTag | null => tryParseTag(r.tag);
const caseOf = (r: Reading): string | undefined => {
  const p = parsed(r);
  return p && 'case' in p ? p.case : undefined;
};
const isNominal = (r: Reading): boolean => {
  const k = parsed(r)?.kind;
  return k === 'noun' || k === 'agree' || k === 'pron';
};
const allAgree = (w: Word): boolean =>
  w.readings.length > 0 && w.readings.every((r) => parsed(r)?.kind === 'agree');
/** An adjective or an agreeing pronoun in every reading; a numeral governs its noun instead. */
const isAttribute = (lex: Lexicon, w: Word): boolean =>
  allAgree(w) &&
  w.readings.every((r) => {
    const pos = lex.lemmas.get(r.lemmaId)?.pos;
    return pos === 'adj' || pos === 'pron';
  });

/** A quantity word: every reading is a neuter singular nominative, accusative or vocative. */
const isQuantity = (w: Word): boolean =>
  w.readings.every((r) => {
    const p = parsed(r);
    return (
      p?.kind === 'agree' &&
      p.number === 'sg' &&
      p.gender === 'n' &&
      (p.case === 'nom' || p.case === 'acc' || p.case === 'voc')
    );
  });

/** The words of a sentence with their readings; a lemma on the frequency list beats one off it. */
function wordsOf(text: string, lex: Lexicon): (Word | null)[] {
  let first = true;
  return tokenize(text).map((tok) => {
    if (tok.t !== 'word') return null;
    const word = text.slice(tok.s, tok.e);
    let readings = lex.readings(word, first);
    first = false;
    const ranked = readings.filter((r) => lex.rankOf(r.lemmaId) !== undefined);
    if (ranked.length > 0) readings = ranked;
    return { text: word, readings };
  });
}

function agrees(lex: Lexicon, mod: Reading, head: Reading): boolean {
  const a = parsed(mod);
  const b = parsed(head);
  if (a?.kind !== 'agree' || !b) return false;
  if (b.kind === 'agree')
    return a.number === b.number && a.case === b.case && a.gender === b.gender;
  if (b.kind !== 'noun') return false;
  const g = lex.lemmas.get(head.lemmaId)?.gender;
  return a.number === b.number && a.case === b.case && (g === undefined || a.gender === g);
}

const casesIn = (w: Word) => [...new Set(w.readings.map(caseOf).filter(Boolean))].join('/');

/** The hints for one sentence; empty when the morphology sees no conflict. */
export function grammarHints(text: string, lex: Lexicon): string[] {
  const hints: string[] = [];
  const words = wordsOf(text, lex);
  for (const [i, w] of words.entries()) {
    if (!w || w.readings.length === 0) continue;
    // A preposition and the phrase after it, up to and including its noun.
    const preps = w.readings.map((r) => lex.lemmas.get(r.lemmaId));
    if (preps.every((l) => l?.pos === 'prep' && l.cases && l.cases.length > 0)) {
      const cases = new Set(preps.flatMap((l) => l?.cases ?? []));
      for (let j = i + 1; j < words.length; j++) {
        const n = words[j];
        if (!n?.readings.some(isNominal)) break;
        if (!n.readings.some((r) => cases.has(caseOf(r) as never)))
          hints.push(
            `after "${w.text}" (takes ${[...cases].join('/')}) "${n.text}" has no such reading; it can be ${casesIn(n) || 'no case form'}`,
          );
        if (!allAgree(n)) break;
      }
    }
    // An adjective or agreeing pronoun and the noun right after it.
    const head = words[i + 1];
    if (
      head &&
      isAttribute(lex, w) &&
      head.readings.some((r) => parsed(r)?.kind === 'noun') &&
      !(isQuantity(w) && head.readings.some((r) => caseOf(r) === 'gen')) &&
      !head.readings.some((h) => w.readings.some((m) => agrees(lex, m, h)))
    )
      hints.push(`"${w.text} ${head.text}" do not agree in case, number and gender in any reading`);
  }
  return hints;
}
