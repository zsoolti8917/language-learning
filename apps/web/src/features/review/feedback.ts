// What the feedback after an answer says (docs/architecture.md, "Grading"): correct, close with
// the accents shown, or wrong with the case that was typed named.
import {
  type Case,
  foldAscii,
  type Grade,
  type GrammaticalNumber,
  normalizeAnswer,
  type ReviewItem,
} from '@app/contracts';
import { diagnoseForm } from '@app/ling';

export interface CaseForm {
  case: Case;
  number?: GrammaticalNumber | undefined;
}

/** One letter of the solution; `differs` marks an accent the learner missed or added. */
export interface Letter {
  ch: string;
  differs: boolean;
}

export type FeedbackModel =
  | { kind: 'correct'; answer: string }
  | { kind: 'close'; answer: string; letters: Letter[] }
  | {
      kind: 'wrong' | 'revealed';
      answer: string;
      /** Set when the accents alone were wrong and strict accents made it count as wrong. */
      letters?: Letter[];
      /** The cases the typed string is, when it is another form of the same word. */
      typedForms: CaseForm[];
      /** What the sentence needs, from the card's explanation. */
      expected?: CaseForm | undefined;
      trigger?: string | undefined;
    };

/** Marks the letters of `answer` that differ from `typed` once both are normalised. */
export function accentLetters(typed: string, answer: string): Letter[] {
  const a = [...answer.normalize('NFC')];
  const t = [...normalizeAnswer(typed).normalize('NFC')];
  const same = a.length === t.length;
  return a.map((ch, i) => ({
    ch,
    differs: same ? ch.toLowerCase() !== t[i] : foldAscii(ch) !== ch.toLowerCase(),
  }));
}

function uniqueForms(readings: readonly { case?: Case; number?: GrammaticalNumber }[]): CaseForm[] {
  const out: CaseForm[] = [];
  for (const r of readings) {
    if (!r.case) continue;
    if (out.some((f) => f.case === r.case && f.number === r.number)) continue;
    out.push({ case: r.case, number: r.number });
  }
  return out;
}

/** Builds the feedback of a graded answer from the card it answered. */
export function feedbackFor(item: ReviewItem, typed: string, grade: Grade): FeedbackModel {
  const solution = item.answers[0] ?? '';
  if (grade === 'correct') return { kind: 'correct', answer: solution };
  const result =
    grade === 'revealed' && typed.trim() === ''
      ? null
      : diagnoseForm(typed, { answers: item.answers, formMap: item.formMap });
  if (grade === 'close' && result?.diagnosis === 'diacritics') {
    return { kind: 'close', answer: result.answer, letters: accentLetters(typed, result.answer) };
  }
  const expected = item.explain?.case
    ? { case: item.explain.case, number: item.explain.number }
    : undefined;
  return {
    kind: grade === 'revealed' ? 'revealed' : 'wrong',
    answer: result?.diagnosis === 'diacritics' ? result.answer : solution,
    ...(result?.diagnosis === 'diacritics' ? { letters: accentLetters(typed, result.answer) } : {}),
    typedForms: result?.diagnosis === 'other_case' ? uniqueForms(result.readings) : [],
    expected,
    trigger: item.explain?.triggerLabel,
  };
}
