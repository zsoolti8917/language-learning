// Step 3 of a tutor turn: every case error the model reported is checked against the
// morphology data. The expected form must exist with the claimed case; an error whose given
// form is already valid for that case is dropped. The evals (I3) call `verifyErrors` directly.
import {
  type Case,
  type FormCandidate,
  foldAscii,
  type Gender,
  type GrammaticalNumber,
  isCaseErrorType,
  type Pos,
  type TriggerKind,
} from '@app/contracts';
import type { MorphologyPort } from '../../ports';
import type { AnalysisError } from './analysis';

/** A trigger of `ling.trigger`, as verification needs it. */
export interface TriggerInfo {
  id: string;
  kind: TriggerKind;
  /** The word: a preposition, verb, numeral or question word. */
  lemma: string;
  case: Case;
  meaningEn: string;
}

/** The word a case error is about, as the morphology data has it. */
export interface ErrorTarget {
  lemmaId: number;
  /** Base form, e.g. `kamarát`. */
  lemma: string;
  pos: Pos;
  case: Case;
  number: GrammaticalNumber;
  gender?: Gender | undefined;
  /** The declension pattern of the main word, when it has one. */
  pattern?: string | undefined;
  /** The cue of a card: the base forms of the corrected words, e.g. `nový dom`. */
  cue: string;
  /** The corrected words only (no unchanged preposition), e.g. `kamarátom`. */
  answer: string;
  /** Where `answer` starts inside `expected`. */
  answerOffset: number;
}

export type VerifyOutcome =
  /** A checked case error: it may be prompted and become a card. */
  | 'verified'
  /** A case error that could not be checked: summary only, never shown, never a card. */
  | 'unverified'
  /** An error of the other family: summary only. */
  | 'other'
  /** Dropped: the given form is valid for the claimed case, or nothing changes. */
  | 'dropped';

export interface VerifiedError extends AnalysisError {
  outcome: VerifyOutcome;
  severity: 'case' | 'other';
  /** Why it is unverified or dropped. */
  reason?: string;
  target?: ErrorTarget;
  lemmaId?: number;
  triggerId?: string;
}

const WORD_RE = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu;
const NON_INFLECTING: ReadonlySet<Pos> = new Set(['prep', 'conj', 'part', 'adv', 'intj']);
/** Vocalised prepositions: `so` is the same trigger as `s`. */
const VOCALISED: Record<string, string> = { so: 's', zo: 'z', vo: 'v', ku: 'k', ko: 'k' };

export function wordsOf(text: string): { word: string; start: number }[] {
  return [...text.normalize('NFC').matchAll(WORD_RE)].map((m) => ({ word: m[0], start: m.index }));
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

/** Finds the trigger the model named, for the expected case. */
export function findTrigger(
  triggers: readonly TriggerInfo[],
  word: string | undefined,
  c: Case | undefined,
): TriggerInfo | undefined {
  if (!word) return undefined;
  const w = lower(word.trim());
  const base = VOCALISED[w] ?? w;
  const same = triggers.filter(
    (t) => lower(t.lemma) === base || foldAscii(t.lemma) === foldAscii(base),
  );
  return same.find((t) => t.case === c) ?? (same.length === 1 ? same[0] : undefined);
}

export interface VerifyDeps {
  morphology: MorphologyPort;
  triggers: readonly TriggerInfo[];
}

/** Checks one error. */
export async function verifyError(e: AnalysisError, deps: VerifyDeps): Promise<VerifiedError> {
  const { morphology } = deps;
  const trigger = findTrigger(deps.triggers, e.trigger, e.caseExpected);
  const base: VerifiedError = {
    ...e,
    severity: isCaseErrorType(e.errorType) ? 'case' : 'other',
    outcome: 'other',
    ...(trigger ? { triggerId: trigger.id } : {}),
  };
  const given = wordsOf(e.given);
  const expected = wordsOf(e.expected);
  const changed = given
    .map((g, i) => ({ g, x: expected[i] }))
    .filter((p) => p.x !== undefined && lower(p.g.word) !== lower(p.x.word));

  if (given.length === expected.length && changed.length === 0)
    return { ...base, outcome: 'dropped', reason: 'given_equals_expected' };

  if (base.severity === 'other') {
    // An other slip is never checked: summary only, unverified.
    return { ...base, outcome: 'other' };
  }
  if (!e.caseExpected) return { ...base, outcome: 'unverified', reason: 'no_case' };
  if (given.length !== expected.length)
    return { ...base, outcome: 'unverified', reason: 'word_count' };

  const want = e.caseExpected;
  const keys = changed.map((p) => p.g.word);
  const lookup = await morphology.lookupForms(keys);
  const givenOf = (word: string) =>
    (lookup.get(foldAscii(word)) ?? []).filter((c) => lower(c.form) === lower(word));

  // First: when every changed inflected word the learner wrote is already a form of the claimed
  // case (of the word the model names, when it names one), the report is false and is dropped.
  const inflected = changed.filter((p) =>
    givenOf(p.g.word).some((c) => !NON_INFLECTING.has(c.pos)),
  );
  const sameWord = (c: FormCandidate) => !e.lemma || foldAscii(c.lemma) === foldAscii(e.lemma);
  if (
    inflected.length > 0 &&
    inflected.every((p) =>
      givenOf(p.g.word).some((c) => sameWord(c) && c.readings.some((r) => r.case === want)),
    )
  )
    return { ...base, outcome: 'dropped', reason: 'given_valid_for_case' };

  let checked = 0;
  let givenValid = 0;
  const words: {
    cand: FormCandidate;
    number: GrammaticalNumber;
    gender?: Gender | undefined;
    start: number;
    end: number;
  }[] = [];
  for (const { g, x } of changed) {
    if (!x) continue;
    const ofExpected = await morphology.verifyForm(x.word, { case: want });
    const givenCands = givenOf(g.word);
    if (ofExpected.length === 0) {
      // so/s, zo/z: a preposition that only changes its vowel needs no case check.
      const all = await morphology.verifyForm(x.word, {});
      const bothFixed =
        all.length > 0 &&
        all.every((c) => NON_INFLECTING.has(c.pos)) &&
        givenCands.length > 0 &&
        givenCands.every((c) => NON_INFLECTING.has(c.pos));
      if (bothFixed) continue;
      return { ...base, outcome: 'unverified', reason: `not_a_${want}_form:${x.word}` };
    }
    const givenLemmas = new Set(givenCands.map((c) => c.lemmaId));
    const byGiven = ofExpected.filter((c) => givenLemmas.has(c.lemmaId));
    const byName = e.lemma
      ? ofExpected.filter((c) => foldAscii(c.lemma) === foldAscii(e.lemma ?? ''))
      : [];
    const pool = byGiven.length > 0 ? byGiven : byName.length > 0 ? byName : ofExpected;
    const cand = pool[0];
    if (!cand) return { ...base, outcome: 'unverified', reason: 'no_candidate' };
    checked += 1;

    const stillValid = await morphology.verifyForm(g.word, { lemmaId: cand.lemmaId, case: want });
    if (stillValid.length > 0) givenValid += 1;

    // Number: the one the learner meant when the given form tells it, else the first reading.
    const numbers = cand.readings.filter((r) => r.case === want).map((r) => r.number);
    const givenNumbers = new Set(
      givenCands
        .filter((c) => c.lemmaId === cand.lemmaId)
        .flatMap((c) => c.readings.map((r) => r.number)),
    );
    // Pronouns without number (ja, ty, kto, čo: tag x) count as singular.
    const number = numbers.find((n) => n && givenNumbers.has(n)) ?? numbers.find((n) => n) ?? 'sg';
    const reading =
      cand.readings.find((r) => r.case === want && r.number === number) ??
      cand.readings.find((r) => r.case === want);
    words.push({
      cand,
      number,
      gender: reading?.gender,
      start: x.start,
      end: x.start + x.word.length,
    });
  }
  if (checked === 0) return { ...base, outcome: 'unverified', reason: 'nothing_checked' };
  if (givenValid === checked)
    return { ...base, outcome: 'dropped', reason: 'given_valid_for_case' };

  const first = words[0];
  const last = words.at(-1);
  if (!first || !last) return { ...base, outcome: 'unverified', reason: 'nothing_checked' };
  // The main word: the noun or pronoun if there is one, else the first checked word.
  const main =
    words.find((w) => w.cand.pos === 'noun') ?? words.find((w) => w.cand.pos === 'pron') ?? first;
  const lemma = await morphology.getLemma(main.cand.lemmaId);
  const target: ErrorTarget = {
    lemmaId: main.cand.lemmaId,
    lemma: main.cand.lemma,
    pos: main.cand.pos,
    case: want,
    number: main.number,
    gender: main.gender ?? lemma?.gender ?? undefined,
    pattern: lemma?.pattern ?? undefined,
    cue: words.map((w) => w.cand.lemma).join(' '),
    answer: e.expected.normalize('NFC').slice(first.start, last.end),
    answerOffset: first.start,
  };
  return { ...base, outcome: 'verified', target, lemmaId: target.lemmaId };
}

/**
 * Verifies every error of an analysis. Dropped errors are returned apart, so the evals can
 * measure how many false corrections the check removes. Make no call while a transaction is open
 * if the morphology port uses the database.
 */
export async function verifyErrors(
  errors: readonly AnalysisError[],
  deps: VerifyDeps,
): Promise<{ kept: VerifiedError[]; dropped: VerifiedError[] }> {
  const kept: VerifiedError[] = [];
  const dropped: VerifiedError[] = [];
  for (const e of errors) {
    const v = await verifyError(e, deps);
    (v.outcome === 'dropped' ? dropped : kept).push(v);
  }
  return { kept, dropped };
}
