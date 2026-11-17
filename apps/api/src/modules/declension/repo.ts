// SQL of the declension module (Drizzle). Owner: B5. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. It reads the `ling` course
// tables, forms and patterns, writes `app.attempt` and `app.lesson_progress`, and reads the
// learner's profile and declension notes (for the daily cap).
import type {
  Case,
  ExerciseKind,
  Gender,
  GrammaticalNumber,
  LessonFocus,
  LessonScore,
  LessonStatus,
  LessonStepContent,
  TriggerKind,
} from '@app/contracts';
import {
  attempt,
  exercise,
  form,
  lemma,
  lesson,
  lessonProgress,
  lessonStep,
  note,
  pattern,
  profile,
  queryRows,
  type Tx,
  trigger,
} from '@app/db';
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { AttemptRecord } from '../../ports';
import type { ExerciseData, LemmaData, PatternData, TriggerData } from './items';
import type { BucketAttemptRow } from './mastery';

// --- Course ----------------------------------------------------------------------------

export interface LessonRow {
  id: string;
  ord: number;
  titleEn: string;
  titleSk: string;
  case: Case | null;
  number: GrammaticalNumber | null;
  focus: LessonFocus;
  summaryMd: string;
  prerequisites: string[];
}

const lessonColumns = {
  id: lesson.id,
  ord: lesson.ord,
  titleEn: lesson.titleEn,
  titleSk: lesson.titleSk,
  case: lesson.gCase,
  number: lesson.gNumber,
  focus: lesson.focus,
  summaryMd: lesson.summaryMd,
  prerequisites: lesson.prerequisites,
};

/** Every lesson of the declension course, in course order. */
export async function listLessons(tx: Tx): Promise<LessonRow[]> {
  const rows = await tx
    .select(lessonColumns)
    .from(lesson)
    .where(eq(lesson.course, 'declension'))
    .orderBy(asc(lesson.ord), asc(lesson.id));
  return rows as LessonRow[];
}

export interface StepRow {
  ord: number;
  content: LessonStepContent;
}

export async function listSteps(tx: Tx, lessonId: string): Promise<StepRow[]> {
  return tx
    .select({ ord: lessonStep.ord, content: lessonStep.content })
    .from(lessonStep)
    .where(eq(lessonStep.lessonId, lessonId))
    .orderBy(asc(lessonStep.ord));
}

export interface TriggerRow extends TriggerData {
  lemmaId: number | null;
  meaningEn: string;
  noteEn: string | null;
  exampleSk: string;
  exampleEn: string;
  contrastGroup: string | null;
}

export async function triggersByIds(tx: Tx, ids: readonly string[]): Promise<TriggerRow[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      id: trigger.id,
      kind: trigger.kind,
      lemma: trigger.lemma,
      lemmaId: trigger.lemmaId,
      case: trigger.gCase,
      meaningEn: trigger.meaningEn,
      noteEn: trigger.noteEn,
      exampleSk: trigger.exampleSk,
      exampleEn: trigger.exampleEn,
      contrastGroup: trigger.contrastGroup,
    })
    .from(trigger)
    .where(inArray(trigger.id, [...ids]));
  return rows.map((r) => ({ ...r, kind: r.kind as TriggerKind, case: r.case as Case }));
}

// --- Exercises and the data of items ----------------------------------------------------

const exerciseColumns = {
  id: exercise.id,
  kind: exercise.kind,
  sentenceSk: exercise.sentenceSk,
  sentenceEn: exercise.sentenceEn,
  target: exercise.target,
  case: exercise.gCase,
  number: exercise.gNumber,
  gender: exercise.gGender,
  pattern: exercise.pattern,
  triggerId: exercise.triggerId,
  options: exercise.options,
  lessonId: exercise.lessonId,
};

function toExercise(r: {
  kind: string;
  case: string;
  number: string;
  gender: string;
}): ExerciseData {
  return {
    ...(r as unknown as ExerciseData),
    kind: r.kind as ExerciseKind,
    case: r.case as Case,
    number: r.number as GrammaticalNumber,
    gender: r.gender as Gender,
  };
}

export async function exercisesByIds(tx: Tx, ids: readonly string[]): Promise<ExerciseData[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select(exerciseColumns)
    .from(exercise)
    .where(inArray(exercise.id, [...ids]));
  return rows.map(toExercise);
}

/** The light rows the session builder chooses from: every exercise of the given lessons. */
export async function candidatesOfLessons(
  tx: Tx,
  lessonIds: readonly string[],
): Promise<{ id: string; case: Case; number: GrammaticalNumber; gender: Gender }[]> {
  if (lessonIds.length === 0) return [];
  const rows = await tx
    .select({
      id: exercise.id,
      case: exercise.gCase,
      number: exercise.gNumber,
      gender: exercise.gGender,
    })
    .from(exercise)
    .where(inArray(exercise.lessonId, [...lessonIds]))
    .orderBy(asc(exercise.id));
  return rows as { id: string; case: Case; number: GrammaticalNumber; gender: Gender }[];
}

export async function formsOfLemmas(
  tx: Tx,
  lemmaIds: readonly number[],
): Promise<{ lemmaId: number; form: string; tags: string }[]> {
  if (lemmaIds.length === 0) return [];
  return tx
    .select({ lemmaId: form.lemmaId, form: form.form, tags: form.tags })
    .from(form)
    .where(inArray(form.lemmaId, [...lemmaIds]))
    .orderBy(asc(form.lemmaId), asc(form.form));
}

export async function lemmasByIds(tx: Tx, ids: readonly number[]): Promise<LemmaData[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: lemma.id, lemma: lemma.lemma, pos: lemma.pos, gender: lemma.gender })
    .from(lemma)
    .where(inArray(lemma.id, [...ids]));
}

export interface PatternRow extends PatternData {
  labelSk: string;
  modelLemmaId: number | null;
  everydayModelLemmaId: number | null;
  notesEn: string | null;
}

const patternColumns = {
  id: pattern.id,
  labelSk: pattern.labelSk,
  pos: pattern.pos,
  gender: pattern.gender,
  modelLemmaId: pattern.modelLemmaId,
  everydayModelLemmaId: pattern.everydayModelLemmaId,
  endings: pattern.endings,
  notesEn: pattern.notesEn,
};

/** Every pattern; the table holds about twenty rows. */
export async function listPatterns(tx: Tx): Promise<PatternRow[]> {
  return tx.select(patternColumns).from(pattern).orderBy(asc(pattern.id));
}

export async function getPattern(tx: Tx, id: string): Promise<PatternRow | null> {
  const [row] = await tx.select(patternColumns).from(pattern).where(eq(pattern.id, id));
  return row ?? null;
}

// --- Progress --------------------------------------------------------------------------

export interface ProgressRow {
  lessonId: string;
  status: LessonStatus;
  stepIndex: number;
  score: LessonScore | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}

const progressColumns = {
  lessonId: lessonProgress.lessonId,
  status: lessonProgress.status,
  stepIndex: lessonProgress.stepIndex,
  score: lessonProgress.score,
  startedAt: lessonProgress.startedAt,
  completedAt: lessonProgress.completedAt,
  updatedAt: lessonProgress.updatedAt,
};

export async function listProgress(tx: Tx, userId: string): Promise<ProgressRow[]> {
  const rows = await tx
    .select(progressColumns)
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId));
  return rows as ProgressRow[];
}

export async function getProgress(
  tx: Tx,
  userId: string,
  lessonId: string,
): Promise<ProgressRow | null> {
  const [row] = await tx
    .select(progressColumns)
    .from(lessonProgress)
    .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, lessonId)));
  return (row as ProgressRow | undefined) ?? null;
}

export async function upsertProgress(
  tx: Tx,
  userId: string,
  row: ProgressRow,
): Promise<ProgressRow> {
  const values = { userId, ...row };
  const [saved] = await tx
    .insert(lessonProgress)
    .values(values)
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: {
        status: row.status,
        stepIndex: row.stepIndex,
        score: row.score,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        updatedAt: row.updatedAt,
      },
    })
    .returning(progressColumns);
  return saved as ProgressRow;
}

/** Inserts a row only when the learner has none for the lesson. */
export async function insertProgressIfMissing(
  tx: Tx,
  userId: string,
  row: ProgressRow,
): Promise<void> {
  await tx
    .insert(lessonProgress)
    .values({ userId, ...row })
    .onConflictDoNothing();
}

// --- Attempts --------------------------------------------------------------------------

/** Inserts attempts; ids already stored are skipped. Returns the ids that were new. */
export async function insertAttempts(
  tx: Tx,
  userId: string,
  list: readonly AttemptRecord[],
): Promise<Set<string>> {
  if (list.length === 0) return new Set();
  const rows = await tx
    .insert(attempt)
    .values(
      list.map((a) => ({
        id: a.id,
        userId,
        source: a.source,
        sourceRef: a.sourceRef ?? null,
        exerciseId: a.exerciseId ?? null,
        lemmaId: a.lemmaId ?? null,
        gCase: a.case,
        gNumber: a.number,
        gGender: a.gender ?? null,
        pattern: a.pattern ?? null,
        triggerId: a.triggerId ?? null,
        correct: a.correct,
        retry: a.retry ?? false,
        diagnosis: a.diagnosis ?? null,
        errorType: a.errorType ?? null,
        given: a.given ?? null,
        expected: a.expected ?? null,
        givenCase: a.givenCase ?? null,
        occurredAt: new Date(a.occurredAt),
        durationMs: a.durationMs ?? null,
      })),
    )
    .onConflictDoNothing({ target: attempt.id })
    .returning({ id: attempt.id });
  return new Set(rows.map((r) => r.id));
}

/**
 * The newest MASTERY_WINDOW attempts of each bucket (newest first) with the bucket's total,
 * optionally only for some bucket keys ('gen.sg.n').
 */
export async function bucketAttempts(
  tx: Tx,
  userId: string,
  window: number,
  bucketKeys?: readonly string[],
): Promise<BucketAttemptRow[]> {
  const filter =
    bucketKeys === undefined
      ? sql``
      : bucketKeys.length === 0
        ? sql` and false`
        : sql` and (g_case || '.' || g_number || '.' || g_gender) in (${sql.join(
            bucketKeys.map((k) => sql`${k}`),
            sql`, `,
          )})`;
  const rows = await queryRows<{
    g_case: string;
    g_number: string;
    g_gender: string;
    correct: boolean;
    retry: boolean;
    total: number | string;
  }>(
    tx,
    sql`select g_case, g_number, g_gender, correct, retry, total from (
          select g_case, g_number, g_gender, correct, retry,
                 row_number() over w as rn,
                 count(*) over (partition by g_case, g_number, g_gender) as total
          from app.attempt
          where user_id = ${userId} and g_gender is not null${filter}
          window w as (partition by g_case, g_number, g_gender order by occurred_at desc, id desc)
        ) s
        where rn <= ${window}
        order by g_case, g_number, g_gender, rn`,
  );
  return rows.map((r) => ({
    case: r.g_case as Case,
    number: r.g_number as GrammaticalNumber,
    gender: r.g_gender as Gender,
    correct: r.correct,
    retry: r.retry,
    total: Number(r.total),
  }));
}

/** When the learner last answered each exercise (ms since epoch). */
export async function lastSeenByExercise(tx: Tx, userId: string): Promise<Map<string, number>> {
  const rows = await tx
    .select({ id: attempt.exerciseId, at: sql<Date | string>`max(${attempt.occurredAt})` })
    .from(attempt)
    .where(and(eq(attempt.userId, userId), isNotNull(attempt.exerciseId)))
    .groupBy(attempt.exerciseId);
  return new Map(rows.map((r) => [r.id as string, new Date(r.at).getTime()]));
}

/** Wrong answers per exercise among the given ones. */
export async function wrongCounts(
  tx: Tx,
  userId: string,
  exerciseIds: readonly string[],
): Promise<Map<string, number>> {
  if (exerciseIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: attempt.exerciseId, n: sql<number | string>`count(*)` })
    .from(attempt)
    .where(
      and(
        eq(attempt.userId, userId),
        eq(attempt.correct, false),
        inArray(attempt.exerciseId, [...exerciseIds]),
      ),
    )
    .groupBy(attempt.exerciseId);
  return new Map(rows.map((r) => [r.id as string, Number(r.n)]));
}

// --- Learner ---------------------------------------------------------------------------

export async function profileDay(
  tx: Tx,
  userId: string,
): Promise<{ timezone: string; dayStartHour: number } | null> {
  const [row] = await tx
    .select({ timezone: profile.timezone, dayStartHour: profile.dayStartHour })
    .from(profile)
    .where(eq(profile.userId, userId));
  return row ?? null;
}

/**
 * Case sentence notes that wrong trainer items became in [start, end): the notes module stores
 * them with source 'declension' and `source_ref.kind = 'trainer'`.
 */
export async function trainerNotesBetween(
  tx: Tx,
  userId: string,
  start: Date,
  end: Date,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number | string>`count(*)` })
    .from(note)
    .where(
      and(
        eq(note.userId, userId),
        eq(note.kind, 'case_sentence'),
        eq(note.source, 'declension'),
        sql`${note.sourceRef}->>'kind' = 'trainer'`,
        gte(note.createdAt, start),
        lt(note.createdAt, end),
      ),
    );
  return Number(row?.n ?? 0);
}
