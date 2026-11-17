// What a resolved error turns into: a case sentence note with the corrected words blanked, and
// an attempt for the mastery of its bucket. Pure functions; the service stores the results
// through NotesPort and AttemptsPort.
import type { Case, CaseSentenceContent, ErrorType } from '@app/contracts';
import { splitSentences } from '@app/ling';
import type { AttemptRecord } from '../../ports';
import type { ErrorTarget } from './verify';

export interface ErrorForCard {
  start: number;
  end: number;
  given: string;
  expected: string;
}

/**
 * The learner's sentence with this error (and the other `fixes` of the same sentence) corrected,
 * and the corrected words blanked. Null when the span does not fit the message.
 */
export function caseSentenceContent(input: {
  message: string;
  error: ErrorForCard;
  target: ErrorTarget;
  sentenceEn?: string | undefined;
  triggerId?: string | null | undefined;
  /** Other verified corrections of the same message. */
  fixes?: readonly ErrorForCard[];
}): CaseSentenceContent | null {
  const { message, error, target } = input;
  if (message.slice(error.start, error.end) !== error.given) return null;
  const spans = splitSentences(message);
  const sentence = spans.find((s) => s.start <= error.start && error.end <= s.end) ?? {
    start: 0,
    end: message.length,
  };
  const fixes = [error, ...(input.fixes ?? [])]
    .filter((f) => f === error || (f.start >= sentence.start && f.end <= sentence.end))
    .filter((f, i, all) => all.findIndex((g) => g.start < f.end && f.start < g.end) === i)
    .filter((f) => message.slice(f.start, f.end) === f.given)
    .sort((a, b) => a.start - b.start);
  let out = '';
  let cursor = sentence.start;
  let blankStart = -1;
  for (const f of fixes) {
    out += message.slice(cursor, f.start);
    if (f === error) blankStart = out.length + target.answerOffset;
    out += f.expected.normalize('NFC');
    cursor = f.end;
  }
  out += message.slice(cursor, sentence.end);
  if (blankStart < 0) return null;
  const blank = { start: blankStart, end: blankStart + target.answer.length };
  if (out.slice(blank.start, blank.end) !== target.answer) return null;
  return {
    kind: 'case_sentence',
    sentenceSk: out,
    sentenceEn: input.sentenceEn ?? '',
    blank,
    cue: target.cue,
    answers: [target.answer],
    features: {
      case: target.case,
      number: target.number,
      ...(target.gender ? { gender: target.gender } : {}),
    },
    lemmaId: target.lemmaId,
    ...(input.triggerId ? { triggerId: input.triggerId } : {}),
  };
}

/** One graded case form from the tutor. */
export function tutorAttempt(input: {
  id: string;
  errorId: string;
  target: ErrorTarget;
  correct: boolean;
  retry: boolean;
  given: string;
  caseGiven?: Case | null | undefined;
  errorType: ErrorType;
  triggerId?: string | null | undefined;
  occurredAt: string;
}): AttemptRecord {
  const { target } = input;
  return {
    id: input.id,
    source: 'tutor',
    sourceRef: input.errorId,
    lemmaId: target.lemmaId,
    case: target.case,
    number: target.number,
    ...(target.gender ? { gender: target.gender } : {}),
    ...(target.pattern ? { pattern: target.pattern } : {}),
    ...(input.triggerId ? { triggerId: input.triggerId } : {}),
    correct: input.correct,
    retry: input.retry,
    diagnosis: input.correct ? 'correct' : input.caseGiven ? 'other_case' : 'not_a_form',
    errorType: input.errorType,
    given: input.given,
    expected: target.answer,
    ...(input.caseGiven ? { givenCase: input.caseGiven } : {}),
    occurredAt: input.occurredAt,
  };
}
