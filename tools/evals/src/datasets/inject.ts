// The error injection: pick a noun phrase of a treebank sentence, put its words into another
// case of the same lemmas through the morphology data, and keep the agreement inside the
// phrase (same number, the modifiers' gender). The label holds the position, the expected
// form and both cases.
import { CASES, type Case, foldAscii, type Gender, type GrammaticalNumber } from '@app/contracts';
import { readTags } from '@app/ling';
import type { Lexicon, LexLemma } from '../lexicon';
import { childrenOf, tokenById, type UdSentence, type UdToken } from '../ud/conllu';
import { caseOf, genderOf, numberOf, posesOf } from '../ud/features';
import type { Rng } from './rng';
import type { ChangedWord, InjectedLabel, TriggerClass } from './types';

const MODIFIER_RELS = new Set(['amod', 'det']);
const VERB_RELS = new Set(['obj', 'iobj', 'obl', 'obl:arg']);

/** A word of the phrase resolved to its lemma and reading in the morphology data. */
interface Resolved {
  token: UdToken;
  lemma: LexLemma;
  case: Case;
  number: GrammaticalNumber;
  /** Set for agreeing words (adjectives, pronouns, numerals); nouns have none in their tag. */
  gender?: Gender | undefined;
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

/** The lemma and reading of one treebank word, or undefined when the data lacks it. */
export function resolveWord(lexicon: Lexicon, t: UdToken): Resolved | undefined {
  const c = caseOf(t);
  const n = numberOf(t);
  if (!c || !n) return undefined;
  const poses = posesOf(t);
  const rows = lexicon
    .rowsOf(t.form)
    .filter(
      (r) =>
        lower(r.form) === lower(t.form) &&
        foldAscii(r.lemma) === foldAscii(t.lemma) &&
        poses.includes(r.pos as never),
    )
    .sort(
      (a, b) =>
        (a.freqRank ?? Number.MAX_SAFE_INTEGER) - (b.freqRank ?? Number.MAX_SAFE_INTEGER) ||
        a.lemmaId - b.lemmaId,
    );
  const g = genderOf(t);
  for (const r of rows) {
    const readings = readTags(r.tags).filter((x) => x.case === c && x.number === n);
    // An agreeing word's tag carries its gender: take the one the treebank gives.
    const reading =
      readings.find((x) => g === undefined || x.gender === undefined || x.gender === g) ??
      readings[0];
    const lemma = lexicon.lemma(r.lemmaId);
    if (reading && lemma) return { token: t, lemma, case: c, number: n, gender: reading.gender };
  }
  return undefined;
}

/**
 * The forms of a lemma that have this case, number and gender (gender for agreeing words). A
 * number left out means any number.
 */
export function formsFor(
  lexicon: Lexicon,
  lemmaId: number,
  want: { case: Case; number?: GrammaticalNumber | undefined; gender?: Gender | undefined },
): string[] {
  const out: string[] = [];
  for (const f of lexicon.formsOf(lemmaId)) {
    const ok = readTags(f.tags).some(
      (r) =>
        r.case === want.case &&
        (want.number === undefined || r.number === want.number) &&
        (want.gender === undefined || r.gender === undefined || r.gender === want.gender),
    );
    if (ok && !out.includes(f.form)) out.push(f.form);
  }
  return out;
}

/** True when `form` is a form of the lemma with this case (and number, gender when given). */
function isFormOf(
  lexicon: Lexicon,
  lemmaId: number,
  form: string,
  want: { case: Case; number?: GrammaticalNumber | undefined; gender?: Gender | undefined },
): boolean {
  return formsFor(lexicon, lemmaId, want).some((f) => lower(f) === lower(form));
}

/**
 * True when `form` is a form of any lemma written as `lemma` with this case: verification
 * checks the lemma by name, so two lemmas of one spelling (a declinable and an indeclinable
 * *foyer*) count as one.
 */
function validForCase(lexicon: Lexicon, lemma: string, form: string, c: Case): boolean {
  return lexicon
    .rowsOf(form)
    .some(
      (r) =>
        lower(r.form) === lower(form) &&
        foldAscii(r.lemma) === foldAscii(lemma) &&
        readTags(r.tags).some((x) => x.case === c),
    );
}

/** What governs the phrase whose head is `head`. */
export function triggerOf(
  sentence: UdSentence,
  head: UdToken,
): { triggerClass: TriggerClass; trigger?: string } {
  const kids = childrenOf(sentence, head.id);
  const prep = kids.find((k) => k.deprel === 'case' && k.upos === 'ADP');
  if (prep) return { triggerClass: 'preposition', trigger: lower(prep.form) };
  const num = kids.find((k) => k.deprel.startsWith('nummod') || k.deprel === 'det:numgov');
  if (num) return { triggerClass: 'numeral', trigger: lower(num.form) };
  const parent = tokenById(sentence, head.head);
  if (VERB_RELS.has(head.deprel) && parent && (parent.upos === 'VERB' || parent.upos === 'AUX'))
    return { triggerClass: 'verb', trigger: parent.lemma };
  if (head.deprel.startsWith('nsubj')) return { triggerClass: 'subject' };
  if (head.deprel === 'nmod') return { triggerClass: 'noun' };
  return { triggerClass: 'other' };
}

/** The phrase of a head noun: its agreeing one-word modifiers and itself, when contiguous. */
export function phraseOf(sentence: UdSentence, head: UdToken): UdToken[] | undefined {
  const c = caseOf(head);
  const mods = childrenOf(sentence, head.id).filter(
    (k) =>
      MODIFIER_RELS.has(k.deprel) &&
      (k.upos === 'ADJ' || k.upos === 'DET') &&
      caseOf(k) === c &&
      childrenOf(sentence, k.id).length === 0,
  );
  const words = [...mods, head].sort((a, b) => a.id - b.id);
  for (let i = 1; i < words.length; i++)
    if ((words[i] as UdToken).id !== (words[i - 1] as UdToken).id + 1) return undefined;
  return words;
}

function capitalLike(form: string, like: string): string {
  const first = like[0];
  if (first && first !== first.toLowerCase() && form[0])
    return form[0].toUpperCase() + form.slice(1);
  return form;
}

export interface Injection {
  text: string;
  label: InjectedLabel;
}

/** The order to try target cases in: the nominative first in two of five tries, as learners do. */
function caseOrder(original: Case, rng: Rng): Case[] {
  const others = CASES.filter((c) => c !== original && c !== 'voc');
  const order = rng.shuffle([...others]);
  if (original !== 'nom' && rng.next() < 0.4) {
    return ['nom', ...order.filter((c) => c !== 'nom')];
  }
  return order;
}

/** Tries to swap one noun phrase of the sentence into another case. */
export function injectError(
  sentence: UdSentence,
  lexicon: Lexicon,
  rng: Rng,
): Injection | undefined {
  const heads = rng.shuffle(
    sentence.tokens.filter(
      (t) => t.upos === 'NOUN' && caseOf(t) !== undefined && caseOf(t) !== 'voc' && numberOf(t),
    ),
  );
  for (const head of heads) {
    const phrase = phraseOf(sentence, head);
    if (!phrase) continue;
    const resolved = phrase.map((t) => resolveWord(lexicon, t));
    if (resolved.some((r) => r === undefined)) continue;
    const words = resolved as Resolved[];
    const headWord = words.find((w) => w.token === head) as Resolved;
    if (headWord.lemma.pos !== 'noun') continue;
    const original = headWord.case;

    for (const target of caseOrder(original, rng)) {
      const changed: { w: Resolved; form: string }[] = [];
      let ok = true;
      for (const w of words) {
        const forms = formsFor(lexicon, w.lemma.id, {
          case: target,
          number: w.number,
          gender: w.gender,
        });
        // A form that is also valid in the original slot, in either number, is no error (the
        // phrase could be read as plural): take another variant.
        const wrong = forms.filter(
          (f) => !isFormOf(lexicon, w.lemma.id, f, { case: original, gender: w.gender }),
        );
        const pick = wrong[0] ?? forms[0];
        if (!pick) {
          ok = false;
          break;
        }
        changed.push({ w, form: capitalLike(pick, w.token.form) });
      }
      if (!ok) continue;
      const headChange = changed.find((c) => c.w === headWord);
      if (!headChange || lower(headChange.form) === lower(head.form)) continue;
      // The tutor's verification drops a report whose given form is valid for the expected case
      // in any number, so such a swap would be no error at all.
      if (validForCase(lexicon, headWord.lemma.lemma, headChange.form, original)) continue;
      return build(sentence, changed, original, target, headWord);
    }
  }
  return undefined;
}

function build(
  sentence: UdSentence,
  changed: { w: Resolved; form: string }[],
  original: Case,
  target: Case,
  head: Resolved,
): Injection {
  let text = '';
  let at = 0;
  const words: ChangedWord[] = [];
  let shift = 0;
  for (const { w, form } of changed) {
    const t = w.token;
    text += sentence.text.slice(at, t.s);
    const start = t.s + shift;
    text += form;
    at = t.e;
    shift += form.length - t.form.length;
    if (form !== t.form)
      words.push({ start, end: start + form.length, given: form, expected: t.form });
  }
  text += sentence.text.slice(at);
  const first = words[0] as ChangedWord;
  const last = words.at(-1) as ChangedWord;
  const moved = changed.filter((c) => c.form !== c.w.token.form).map((c) => c.w.token);
  const startOrig = (moved[0] as UdToken).s;
  const lastOrig = moved.at(-1) as UdToken;
  const { triggerClass, trigger } = triggerOf(sentence, head.token);
  return {
    text,
    label: {
      start: first.start,
      end: last.end,
      given: text.slice(first.start, last.end),
      expected: sentence.text.slice(startOrig, lastOrig.e),
      caseExpected: original,
      caseGiven: target,
      number: head.number,
      lemma: head.lemma.lemma,
      triggerClass,
      ...(trigger ? { trigger } : {}),
      words,
    },
  };
}
