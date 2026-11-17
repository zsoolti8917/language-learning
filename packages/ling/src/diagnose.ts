// Diagnosis of a typed form (docs/contracts.md, "Exercises, attempts and mastery").
import {
  type Diagnosis,
  type ErrorType,
  type FormMap,
  type FormReading,
  foldAscii,
  type Gender,
  normalizeAnswer,
  type TriggerKind,
} from '@app/contracts';
import { formKey } from './forms';
import { parseTag, readTags } from './tags';

/** What `diagnoseForm` needs; an `ExerciseItem` or a `ReviewItem` fits it. */
export type DiagnoseInput = {
  /** Accepted answers. */
  answers: readonly string[];
  /** Every form of the target word mapped to its form tags. */
  formMap: FormMap;
  /** Pattern id to the ending that pattern has for the expected tag. */
  siblingEndings?: Readonly<Record<string, string>> | undefined;
  /** The target word's own pattern id. With its ending in `siblingEndings` it fixes the stem. */
  pattern?: string | undefined;
  /** The stem of the target word for its pattern, when the caller knows it (see `stemOf`). */
  stem?: string | undefined;
  /** The target noun's gender, added to the readings of an `other_case` result. */
  gender?: Gender | undefined;
};

export type DiagnoseResult =
  /** Matches an accepted answer; `answer` is the one it matched. */
  | { diagnosis: 'correct'; answer: string }
  /** A real form of the word, but another case: the form and its tags. */
  | { diagnosis: 'other_case'; form: string; tags: string[]; readings: FormReading[] }
  /** Right letters, accents missing or wrong; `answer` is the accepted answer meant. */
  | { diagnosis: 'diacritics'; answer: string }
  /** The stem with an ending borrowed from another pattern. */
  | { diagnosis: 'wrong_pattern'; pattern: string; ending: string }
  /** Not a form of this word. */
  | { diagnosis: 'not_a_form' };

/** How many letters an ending of the target's own pattern may have when the stem is guessed. */
const MAX_OWN_ENDING = 4;
/** The shortest stem a guess may produce. */
const MIN_STEM = 2;

function stemsFor(input: DiagnoseInput): string[] {
  if (input.stem !== undefined && input.stem !== '') return [formKey(input.stem)];
  const answers = input.answers.map(formKey).filter((a) => a !== '');
  const own = input.pattern === undefined ? undefined : input.siblingEndings?.[input.pattern];
  if (own !== undefined) {
    const ending = formKey(own);
    const stems = answers
      .filter((a) => a.endsWith(ending) && a.length > ending.length)
      .map((a) => a.slice(0, a.length - ending.length));
    if (stems.length > 0) return stems;
  }
  // The own ending is unknown: every answer cut by up to MAX_OWN_ENDING letters is a candidate.
  const stems = new Set<string>();
  for (const a of answers) {
    for (let cut = 0; cut <= MAX_OWN_ENDING && a.length - cut >= MIN_STEM; cut++) {
      stems.add(a.slice(0, a.length - cut));
    }
  }
  return [...stems];
}

/**
 * Names what a typed answer is, in this order, the first match winning:
 * an accepted answer (`correct`); another form of the word (`other_case`, with its tags);
 * an accepted answer once accents and capitals are folded away (`diacritics`); the stem plus
 * an ending of another pattern from `siblingEndings` (`wrong_pattern`); anything else
 * (`not_a_form`). Answers are compared after `normalizeAnswer`.
 */
export function diagnoseForm(typed: string, input: DiagnoseInput): DiagnoseResult {
  const t = normalizeAnswer(typed);
  if (t === '') return { diagnosis: 'not_a_form' };

  for (const answer of input.answers) {
    if (normalizeAnswer(answer) === t) return { diagnosis: 'correct', answer };
  }

  for (const [form, tags] of Object.entries(input.formMap)) {
    if (formKey(form) === t) {
      return {
        diagnosis: 'other_case',
        form,
        tags: [...tags],
        readings: readTags(tags, input.gender),
      };
    }
  }

  const folded = foldAscii(t);
  for (const answer of input.answers) {
    if (foldAscii(normalizeAnswer(answer)) === folded) return { diagnosis: 'diacritics', answer };
  }

  const siblings = Object.entries(input.siblingEndings ?? {}).filter(
    ([pattern]) => pattern !== input.pattern,
  );
  if (siblings.length > 0) {
    const stems = stemsFor(input);
    for (const [pattern, ending] of siblings) {
      for (const stem of stems) {
        if (foldAscii(stem + formKey(ending)) === folded) {
          return { diagnosis: 'wrong_pattern', pattern, ending };
        }
      }
    }
  }

  return { diagnosis: 'not_a_form' };
}

/** What `errorTypeFor` needs to know about the item. */
export type ErrorContext = {
  /** The kind of the trigger that demands the case, if the item has one. */
  triggerKind?: TriggerKind | undefined;
  /** The tag of the expected form, e.g. `p2`. */
  expectedTag?: string | undefined;
};

function isGenitivePlural(tag: string | undefined): boolean {
  if (tag === undefined) return false;
  const parsed = parseTag(tag);
  return (
    (parsed.kind === 'noun' || parsed.kind === 'agree') &&
    parsed.case === 'gen' &&
    parsed.number === 'pl'
  );
}

/**
 * Maps a diagnosis to a value of the shared error list. `other_case` becomes
 * `case_after_preposition`, `case_after_verb` or `case_after_numeral` by the kind of trigger,
 * and `case_other` for any other trigger or none. `wrong_pattern` becomes `genitive_plural`
 * when a genitive plural was expected, else `pattern_ending`. `diacritics` becomes `spelling`,
 * `not_a_form` becomes `other`, and `correct` is no error (null).
 */
export function errorTypeFor(diagnosis: Diagnosis, ctx: ErrorContext = {}): ErrorType | null {
  switch (diagnosis) {
    case 'correct':
      return null;
    case 'other_case':
      switch (ctx.triggerKind) {
        case 'preposition':
          return 'case_after_preposition';
        case 'verb':
          return 'case_after_verb';
        case 'numeral':
          return 'case_after_numeral';
        default:
          return 'case_other';
      }
    case 'wrong_pattern':
      return isGenitivePlural(ctx.expectedTag) ? 'genitive_plural' : 'pattern_ending';
    case 'diacritics':
      return 'spelling';
    case 'not_a_form':
      return 'other';
  }
}
