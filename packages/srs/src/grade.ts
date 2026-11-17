// Grading a typed answer (docs/architecture.md, "Grading").
import type { Diagnosis, FormMap, Grade, Rating } from '@app/contracts';
import { diagnoseForm } from '@app/ling';

/** The default rating of each grade: correct good, close hard, wrong and revealed again. */
export const RATING_FOR_GRADE: Readonly<Record<Grade, Rating>> = {
  correct: 3,
  close: 2,
  wrong: 1,
  revealed: 1,
};

/** The default rating of a grade. */
export function ratingForGrade(grade: Grade): Rating {
  return RATING_FOR_GRADE[grade];
}

/**
 * Grades a typed answer with `diagnoseForm`. Correct gives the rating good. Close (only
 * accents differ, and the string is not another form of the word) gives hard, or counts as
 * wrong with `strictDiacritics`. Anything else is wrong and gives again; another form of the
 * word (*mesta* for *mestá*) is wrong, not close.
 * `revealed` is never returned: the client sets it when the learner asks for the answer.
 */
export function gradeAnswer(
  typed: string,
  answers: string[],
  formMap: FormMap,
  opts: { strictDiacritics: boolean },
): { grade: Grade; rating: Rating; diagnosis: Diagnosis } {
  const { diagnosis } = diagnoseForm(typed, { answers, formMap });
  const grade: Grade =
    diagnosis === 'correct'
      ? 'correct'
      : diagnosis === 'diacritics' && !opts.strictDiacritics
        ? 'close'
        : 'wrong';
  return { grade, rating: ratingForGrade(grade), diagnosis };
}
