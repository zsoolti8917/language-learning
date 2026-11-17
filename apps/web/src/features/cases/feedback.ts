// Grading and feedback of one answer, on the phone (docs/architecture.md, "Diagnosis of a wrong
// answer"). `diagnoseForm` names what the answer is; the sentences below explain it with the
// trigger and the case names. Slovak words come from the payload only: the accepted answer,
// the cue, the typed text, the trigger label and the pattern model words.
import type {
  Diagnosis,
  ErrorType,
  ExerciseItem,
  FormReading,
  Gender,
  GrammaticalNumber,
} from '@app/contracts';
import { foldAscii } from '@app/contracts';
import { type DiagnoseResult, diagnoseForm, errorTypeFor, tagOf } from '@app/ling';
import type { AnswerState } from '../../ui';
import {
  accentSlips,
  capitalize,
  patternModel,
  SOFTNESS,
  triggerWord,
  usefulReadings,
  wordBefore,
} from './grammar';
import { m } from './messages';

/** A value in a feedback sentence: plain English, or Slovak (shown in italics, lang="sk"). */
export type RichVar = string | { sk: string };
export type FeedbackKey = keyof typeof m.messages.fb;
export type Fragment = { key: FeedbackKey; vars?: Record<string, RichVar> };

export interface Graded {
  result: DiagnoseResult;
  diagnosis: Diagnosis;
  errorType: ErrorType | null;
  correct: boolean;
  state: AnswerState;
  /** The full explanation, with the answer. */
  feedback: Fragment[];
  /** The explanation without the answer, shown before the one retry. */
  hint: Fragment[];
  /** The pattern table worth opening, for a pattern mistake. */
  patternId?: string;
}

const sk = (s: string) => ({ sk: s });

function caseText(
  r: { case?: string; number?: GrammaticalNumber; gender?: Gender },
  withNumber: boolean,
  withGender = false,
): string {
  const c = m.t(`caseName.${r.case as 'nom'}`);
  const parts = [c];
  if (withNumber && r.number) parts.push(m.t(`numberName.${r.number}`));
  if (withGender && r.gender) parts.unshift(m.t(`genderName.${r.gender}`));
  return parts.join(' ');
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  const or = m.messages.fb.or;
  return `${items.slice(0, -1).join(m.messages.fb.listSep)}${or}${items[items.length - 1]}`;
}

/** "do mesta" when the trigger word stands right before the gap, else just "mesta". */
export function answerPhrase(item: ExerciseItem, answer = item.answers[0] ?? ''): string {
  if (!item.trigger) return answer;
  const before = wordBefore(item.sentenceSk, item.blank.start);
  const word = triggerWord(item.trigger.label);
  if (before && foldAscii(before) === foldAscii(word)) return `${before.toLowerCase()} ${answer}`;
  return answer;
}

function expectedTag(item: ExerciseItem): string | undefined {
  try {
    return tagOf(item.features);
  } catch {
    return undefined;
  }
}

function caseFragments(
  item: ExerciseItem,
  expected: string,
  phrase: string,
  full: boolean,
): Fragment {
  if (item.trigger) {
    const trigger = sk(triggerWord(item.trigger.label));
    return full
      ? { key: 'afterTriggerAnswer', vars: { trigger, expected, phrase: sk(phrase) } }
      : { key: 'afterTrigger', vars: { trigger, expected } };
  }
  return full
    ? { key: 'needsAnswer', vars: { expected, phrase: sk(phrase) } }
    : { key: 'needs', vars: { expected } };
}

function otherCase(
  item: ExerciseItem,
  readings: FormReading[],
  phrase: string,
  full: boolean,
): Fragment[] {
  const f = item.features;
  const useful = usefulReadings(readings);
  const same = useful.filter((r) => r.case === f.case && (r.number ?? f.number) === f.number);
  if (same.some((r) => r.gender === undefined || r.gender === f.gender)) {
    return [{ key: 'sameReading', vars: { phrase: sk(phrase) } }];
  }
  if (same.length > 0 && same[0]?.gender) {
    // Right case and number, wrong gender: an agreement slip.
    const vars = {
      given: m.t(`genderName.${same[0].gender}`),
      cue: sk(item.cue),
      expected: m.t(`genderName.${f.gender}`),
      phrase: sk(phrase),
    };
    return [{ key: full ? 'agreementAnswer' : 'agreement', vars }];
  }
  // Name the number when the case alone does not tell the forms apart.
  const sharesCase = useful.some((r) => r.case === f.case);
  const givenNames = [...new Set(useful.map((r) => caseText(r, true)))];
  const given: Fragment =
    givenNames.length === 1
      ? { key: 'givenOne', vars: { given: givenNames[0] as string } }
      : { key: 'givenMany', vars: { given: joinOr(givenNames) } };
  return [given, caseFragments(item, caseText(f, sharesCase), phrase, full)];
}

function wrongPattern(
  item: ExerciseItem,
  borrowedId: string,
  ending: string,
  phrase: string,
  full: boolean,
): Fragment[] {
  const own = item.features.pattern;
  const cue = sk(capitalize(item.cue));
  const ownSoft = own ? SOFTNESS[own] : undefined;
  const otherSoft = SOFTNESS[borrowedId];
  const borrowed = sk(patternModel(borrowedId) ?? borrowedId);
  const out: Fragment[] = [];
  const contrast = ownSoft !== undefined && otherSoft !== undefined && ownSoft !== otherSoft;
  if (contrast) {
    const softness = m.t(`fb.${ownSoft}`);
    out.push({
      key: full ? 'softnessAnswer' : 'softness',
      vars: { cue, softness, phrase: sk(phrase) },
    });
  } else {
    const model = sk(patternModel(own) ?? own ?? item.cue);
    out.push({
      key: full ? 'declinesAnswer' : 'declines',
      vars: { cue, model, phrase: sk(phrase) },
    });
  }
  if (ending === '') out.push({ key: 'zeroEnding', vars: { borrowed } });
  else if (contrast)
    out.push({
      key: 'endingOther',
      vars: { ending: sk(ending), otherSoftness: m.t(`fb.${otherSoft}`), borrowed },
    });
  else out.push({ key: 'endingWords', vars: { ending: sk(ending), borrowed } });
  return out;
}

function explain(
  item: ExerciseItem,
  typed: string,
  result: DiagnoseResult,
  full: boolean,
): Fragment[] {
  const answer = item.answers[0] ?? '';
  const phrase = answerPhrase(item, answer);
  switch (result.diagnosis) {
    case 'correct':
      return [{ key: 'correct', vars: { phrase: sk(answerPhrase(item, result.answer)) } }];
    case 'other_case':
      return otherCase(item, result.readings, phrase, full);
    case 'diacritics': {
      const slips = accentSlips(typed, result.answer);
      const out: Fragment[] = full
        ? [{ key: 'accentsAnswer', vars: { phrase: sk(answerPhrase(item, result.answer)) } }]
        : [{ key: 'accents' }];
      if (!full && slips.length > 0)
        out.push({ key: 'accentsWatch', vars: { letters: sk(slips.join(', ')) } });
      return out;
    }
    case 'wrong_pattern':
      return wrongPattern(item, result.pattern, result.ending, phrase, full);
    case 'not_a_form':
      return [
        { key: 'notAForm', vars: { typed: sk(typed.trim()), cue: sk(item.cue) } },
        caseFragments(item, caseText(item.features, false), phrase, full),
      ];
  }
}

const STATE: Record<Diagnosis, AnswerState> = {
  correct: 'correct',
  diacritics: 'close',
  other_case: 'wrong',
  wrong_pattern: 'wrong',
  not_a_form: 'wrong',
};

/**
 * Grades a typed (or chosen) form of a `cloze` or `choice_form` item with `diagnoseForm`,
 * and builds the feedback: a hint for the retry and the full sentence with the answer.
 */
export function gradeForm(item: ExerciseItem, typed: string): Graded {
  const result = diagnoseForm(typed, {
    answers: item.answers,
    formMap: item.formMap,
    siblingEndings: item.siblingEndings,
    pattern: item.features.pattern,
    gender: item.features.gender,
  });
  const errorType = errorTypeFor(result.diagnosis, {
    triggerKind: item.trigger?.kind,
    expectedTag: expectedTag(item),
  });
  return {
    result,
    diagnosis: result.diagnosis,
    errorType,
    correct: result.diagnosis === 'correct',
    state: STATE[result.diagnosis],
    feedback: explain(item, typed, result, true),
    hint: explain(item, typed, result, false),
    ...(result.diagnosis === 'wrong_pattern' && item.features.pattern
      ? { patternId: item.features.pattern }
      : {}),
  };
}

/** Grades a `choice_meaning` pick: the options are English sentences, not forms. */
export function gradeMeaning(item: ExerciseItem, chosen: string): Graded {
  const right = item.options?.find((o) => o.correct)?.text ?? item.sentenceEn;
  const correct = chosen === right;
  const form = item.sentenceSk.slice(item.blank.start, item.blank.end);
  const hint: Fragment[] = [
    { key: 'meaningWrong', vars: { form: sk(form), expected: caseText(item.features, false) } },
  ];
  return {
    result: correct ? { diagnosis: 'correct', answer: right } : { diagnosis: 'not_a_form' },
    diagnosis: correct ? 'correct' : 'not_a_form',
    errorType: correct ? null : 'case_other',
    correct,
    state: correct ? 'correct' : 'wrong',
    feedback: correct
      ? [{ key: 'meaningAnswer', vars: { meaning: right } }]
      : [...hint, { key: 'meaningAnswer', vars: { meaning: right } }],
    hint,
  };
}

export function grade(item: ExerciseItem, typed: string): Graded {
  return item.kind === 'choice_meaning' ? gradeMeaning(item, typed) : gradeForm(item, typed);
}

/** The feedback as plain text, for tests and screen reader labels. */
export function plainText(fragments: readonly Fragment[]): string {
  return fragments
    .map(({ key, vars }) =>
      m.messages.fb[key].replace(/\{(\w+)\}/g, (all, name: string) => {
        const v = vars?.[name];
        if (v === undefined) return all;
        return typeof v === 'string' ? v : v.sk;
      }),
    )
    .join(' ');
}
