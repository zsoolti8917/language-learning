// Logic of the declension module. Owner: B5. It takes ports and a transaction and knows
// nothing about HTTP. Every function runs inside the caller's `withUser` transaction and
// makes no network call.
import type {
  AttemptInput,
  BucketMastery,
  CaseSentenceContent,
  CourseLesson,
  ExerciseItem,
  LessonProgress,
  LessonStatus,
  LessonStepContent,
  PatternDetail,
  ResponseOf,
  SaveLessonProgress,
  CreateSession as SessionRequest,
  SubmitAttempts,
} from '@app/contracts';
import { bucketKey, type FormRow } from '@app/ling';
import { conflict, notFound, validationFailed } from '../../platform/errors';
import { learnerDay } from '../../platform/time';
import type { AttemptRecord, Ports, Tx } from '../../ports';
import {
  buildExerciseItem,
  diagnoseAnswer,
  type ExerciseData,
  headLemmaId,
  type ItemData,
} from './items';
import { allBuckets, MASTERY_WINDOW, masteryFromRows } from './mastery';
import * as repo from './repo';
import { selectSession } from './select';

/** What every service call needs besides the transaction. */
export interface ServiceContext {
  userId: string;
  now: Date;
  ports: Ports;
}

/** A checkpoint at this share or above completes a lesson, unless the step names its own. */
export const PASS_SHARE = 0.75;
/** Case sentence notes a completed lesson adds to the deck. */
export const LESSON_CARDS = 10;
/** Wrong trainer items that become cards per learner day. */
export const DAILY_TRAINER_CARDS = 5;

const DONE: readonly LessonStatus[] = ['completed', 'tested_out'];
const DEFAULT_TZ = 'Europe/Bratislava';
const DEFAULT_DAY_START = 4;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toProgress(row: repo.ProgressRow): LessonProgress {
  return {
    lessonId: row.lessonId,
    status: row.status,
    stepIndex: row.stepIndex,
    score: row.score,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- Mastery ---------------------------------------------------------------------------

/** The learner's mastery of every bucket with attempts, or of the given bucket keys. */
export async function getMastery(
  tx: Tx,
  userId: string,
  bucketKeys?: readonly string[],
): Promise<BucketMastery[]> {
  return masteryFromRows(await repo.bucketAttempts(tx, userId, MASTERY_WINDOW, bucketKeys));
}

// --- Course ----------------------------------------------------------------------------

/**
 * The status of each lesson. A stored row wins. Otherwise the first lesson is available, and
 * each later one is available once the lesson before it is completed or tested out.
 */
export function lessonStatuses(
  lessons: readonly { id: string }[],
  progress: ReadonlyMap<string, { status: LessonStatus }>,
): Map<string, LessonStatus> {
  const out = new Map<string, LessonStatus>();
  let previousDone = true;
  for (const l of lessons) {
    const stored = progress.get(l.id)?.status;
    let status: LessonStatus = stored ?? (previousDone ? 'available' : 'locked');
    if (status === 'locked' && previousDone) status = 'available';
    out.set(l.id, status);
    previousDone = DONE.includes(status);
  }
  return out;
}

async function statusesOf(tx: Tx, userId: string) {
  const lessons = await repo.listLessons(tx);
  const progress = new Map((await repo.listProgress(tx, userId)).map((p) => [p.lessonId, p]));
  return { lessons, progress, statuses: lessonStatuses(lessons, progress) };
}

export async function getCourse(tx: Tx, userId: string): Promise<ResponseOf<'declension.course'>> {
  const { lessons, progress, statuses } = await statusesOf(tx, userId);
  const items: CourseLesson[] = lessons.map((l) => ({
    id: l.id,
    ord: l.ord,
    titleEn: l.titleEn,
    titleSk: l.titleSk,
    case: l.case,
    number: l.number,
    status: statuses.get(l.id) ?? 'locked',
    score: progress.get(l.id)?.score ?? null,
  }));
  return { lessons: items, mastery: allBuckets(await getMastery(tx, userId)) };
}

// --- Items -----------------------------------------------------------------------------

/** Reads forms, lemmas, patterns and triggers for the exercises and builds their items. */
async function loadItems(tx: Tx, exercises: readonly ExerciseData[]): Promise<ItemData> {
  const lemmaIds = [...new Set(exercises.flatMap((e) => e.target.lemmaIds))];
  const triggerIds = [...new Set(exercises.flatMap((e) => (e.triggerId ? [e.triggerId] : [])))];
  // One query at a time: a transaction holds one connection.
  const formRows = await repo.formsOfLemmas(tx, lemmaIds);
  const lemmas = await repo.lemmasByIds(tx, lemmaIds);
  const patterns = await repo.listPatterns(tx);
  const triggers = await repo.triggersByIds(tx, triggerIds);
  const forms = new Map<number, FormRow[]>();
  for (const r of formRows) {
    const list = forms.get(r.lemmaId) ?? [];
    list.push({ form: r.form, tags: r.tags });
    forms.set(r.lemmaId, list);
  }
  return {
    forms,
    lemmas: new Map(lemmas.map((l) => [l.id, l])),
    patterns,
    triggers: new Map(triggers.map((t) => [t.id, t])),
  };
}

/** Exercises by id, with their items, in the order of `ids`; unknown ids are left out. */
async function itemsByIds(
  tx: Tx,
  ids: readonly string[],
): Promise<{
  exercises: Map<string, ExerciseData>;
  items: Map<string, ExerciseItem>;
  data: ItemData;
}> {
  const rows = await repo.exercisesByIds(tx, [...new Set(ids)]);
  const data = await loadItems(tx, rows);
  const exercises = new Map(rows.map((r) => [r.id, r]));
  const items = new Map(rows.map((r) => [r.id, buildExerciseItem(r, data)]));
  return { exercises, items, data };
}

function exerciseIdsOf(content: LessonStepContent): string[] {
  return content.kind === 'explain' || content.kind === 'triggers' ? [] : content.exerciseIds;
}

// --- Lesson ----------------------------------------------------------------------------

export async function getLesson(
  tx: Tx,
  userId: string,
  lessonId: string,
): Promise<ResponseOf<'declension.lesson'>> {
  const lessons = await repo.listLessons(tx);
  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) throw notFound('No such lesson.');
  const steps = await repo.listSteps(tx, lessonId);
  const { items } = await itemsByIds(
    tx,
    steps.flatMap((s) => exerciseIdsOf(s.content)),
  );
  const triggerIds = [
    ...new Set([
      ...lesson.focus.triggerIds,
      ...steps.flatMap((s) => (s.content.kind === 'triggers' ? s.content.triggerIds : [])),
    ]),
  ];
  const triggers = await repo.triggersByIds(tx, triggerIds);
  const byId = new Map(triggers.map((t) => [t.id, t]));
  const progress = await repo.getProgress(tx, userId, lessonId);
  return {
    lesson,
    steps: steps.map((s) => ({
      ord: s.ord,
      content: s.content,
      exercises: exerciseIdsOf(s.content).flatMap((id) => {
        const item = items.get(id);
        return item ? [item] : [];
      }),
    })),
    triggers: triggerIds.flatMap((id) => {
      const t = byId.get(id);
      return t
        ? [
            {
              id: t.id,
              kind: t.kind,
              lemma: t.lemma,
              lemmaId: t.lemmaId,
              case: t.case,
              meaningEn: t.meaningEn,
              noteEn: t.noteEn,
              exampleSk: t.exampleSk,
              exampleEn: t.exampleEn,
              contrastGroup: t.contrastGroup,
            },
          ]
        : [];
    }),
    progress: progress ? toProgress(progress) : null,
  };
}

/** The content of the case sentence note an exercise becomes. */
export function caseSentenceContent(
  ex: ExerciseData,
  item: ExerciseItem,
  data: ItemData,
): CaseSentenceContent {
  const lemmaId = headLemmaId(ex, data.lemmas);
  return {
    kind: 'case_sentence',
    exerciseId: ex.id,
    sentenceSk: item.sentenceSk,
    sentenceEn: item.sentenceEn,
    blank: item.blank,
    cue: item.cue,
    answers: item.answers,
    features: { case: ex.case, number: ex.number, gender: ex.gender },
    ...(lemmaId !== undefined ? { lemmaId } : {}),
    ...(ex.triggerId ? { triggerId: ex.triggerId } : {}),
  };
}

/**
 * Adds about ten of the lesson's sentences to the deck through NotesPort: exercises the learner
 * got wrong first (most wrong answers first), then the rest in step order. Meaning choices are
 * left out, as they test no form. NotesPort keeps one note per exercise, so a repeat creates
 * nothing. Returns how many notes were new.
 */
async function createLessonCards(
  tx: Tx,
  ctx: ServiceContext,
  lessonId: string,
  steps: readonly repo.StepRow[],
): Promise<number> {
  const ids = [...new Set(steps.flatMap((s) => exerciseIdsOf(s.content)))];
  const { exercises, items, data } = await itemsByIds(tx, ids);
  const usable = ids.filter(
    (id) => exercises.get(id) && exercises.get(id)?.kind !== 'choice_meaning',
  );
  const wrong = await repo.wrongCounts(tx, ctx.userId, usable);
  const order = usable
    .map((id, i) => ({ id, i, wrong: wrong.get(id) ?? 0 }))
    .sort((a, b) => b.wrong - a.wrong || a.i - b.i)
    .slice(0, LESSON_CARDS);
  let created = 0;
  for (const { id } of order) {
    const ex = exercises.get(id) as ExerciseData;
    const r = await ctx.ports.notes.createCaseSentenceNote(tx, {
      source: 'declension',
      content: caseSentenceContent(ex, items.get(id) as ExerciseItem, data),
      sourceRef: { kind: 'lesson', lessonId },
    });
    if (r.created) created += 1;
  }
  return created;
}

/**
 * Saves where the learner stands in a lesson. A checkpoint score at the pass share or above
 * completes the lesson (so does `status: 'completed'` with such a score); completing creates the
 * lesson's cards and opens the next lesson. A completed lesson stays completed and keeps its
 * best score. `locked` and `available` cannot be set, nor `completed` without a passing score.
 */
export async function saveProgress(
  tx: Tx,
  ctx: ServiceContext,
  lessonId: string,
  body: SaveLessonProgress,
): Promise<LessonProgress> {
  const lessons = await repo.listLessons(tx);
  const index = lessons.findIndex((l) => l.id === lessonId);
  if (index < 0) throw notFound('No such lesson.');
  const steps = await repo.listSteps(tx, lessonId);
  if (body.stepIndex > steps.length)
    throw validationFailed({ 'body.stepIndex': `The lesson has ${steps.length} steps.` });
  if (body.score && body.score.correct > body.score.total)
    throw validationFailed({ 'body.score.correct': 'More correct answers than items.' });
  if (body.status === 'locked' || body.status === 'available')
    throw conflict(`A lesson cannot be set to ${body.status}.`);

  const checkpoint = steps.find((s) => s.content.kind === 'checkpoint')?.content;
  const passShare =
    (checkpoint && 'passShare' in checkpoint ? checkpoint.passShare : undefined) ?? PASS_SHARE;
  const ratio = (s: { correct: number; total: number } | null | undefined) =>
    s && s.total > 0 ? s.correct / s.total : -1;
  const passes = ratio(body.score) >= passShare;
  if (body.status === 'completed' && !passes)
    throw conflict('A lesson is completed by a checkpoint score of 75% or more.', {
      passShare,
    });

  const existing = await repo.getProgress(tx, ctx.userId, lessonId);
  const was = existing?.status;
  let status: LessonStatus;
  if (passes) status = 'completed';
  else if (was === 'completed') status = 'completed';
  else if (body.status === 'tested_out' || was === 'tested_out') status = 'tested_out';
  else status = body.status ?? 'in_progress';

  const score =
    existing?.score && ratio(existing.score) >= ratio(body.score ?? null) && DONE.includes(status)
      ? existing.score
      : (body.score ?? existing?.score ?? null);
  const nowDone = DONE.includes(status);
  const saved = await repo.upsertProgress(tx, ctx.userId, {
    lessonId,
    status,
    stepIndex: body.stepIndex,
    score,
    startedAt: existing?.startedAt ?? ctx.now,
    completedAt: existing?.completedAt ?? (nowDone ? ctx.now : null),
    updatedAt: ctx.now,
  });

  if (status === 'completed' && was !== 'completed')
    await createLessonCards(tx, ctx, lessonId, steps);
  if (nowDone) {
    const next = lessons[index + 1];
    if (next)
      await repo.insertProgressIfMissing(tx, ctx.userId, {
        lessonId: next.id,
        status: 'available',
        stepIndex: 0,
        score: null,
        startedAt: null,
        completedAt: null,
        updatedAt: ctx.now,
      });
  }
  return toProgress(saved);
}

// --- Sessions --------------------------------------------------------------------------

/**
 * Builds a trainer session. `lesson` drills one lesson (the one given, else the first in
 * progress, else the first available); `mixed` and `weak` drill every lesson that is not
 * locked. Shares come from the focus weights of those lessons.
 */
export async function createSession(
  tx: Tx,
  ctx: ServiceContext,
  body: SessionRequest,
  sessionId: string,
  seed: number,
): Promise<ResponseOf<'declension.createSession'>> {
  const { lessons, statuses } = await statusesOf(tx, ctx.userId);
  let chosen: repo.LessonRow[];
  if (body.mode === 'lesson') {
    const lesson = body.lessonId
      ? lessons.find((l) => l.id === body.lessonId)
      : (lessons.find((l) => statuses.get(l.id) === 'in_progress') ??
        lessons.find((l) => statuses.get(l.id) === 'available'));
    if (!lesson) throw notFound('No such lesson.');
    chosen = [lesson];
  } else {
    chosen = lessons.filter((l) => statuses.get(l.id) !== 'locked');
  }

  const shares = new Map<string, number>();
  for (const l of chosen)
    for (const b of l.focus.buckets)
      shares.set(bucketKey(b), Math.max(shares.get(bucketKey(b)) ?? 0, b.weight));

  const candidates = await repo.candidatesOfLessons(
    tx,
    chosen.map((l) => l.id),
  );
  const lastSeen = await repo.lastSeenByExercise(tx, ctx.userId);
  const mastery = await getMastery(tx, ctx.userId);
  const ids = selectSession({
    mode: body.mode,
    size: body.size,
    seed,
    shares,
    mastery,
    candidates: candidates.map((c) => ({
      exerciseId: c.id,
      bucket: bucketKey(c),
      lastSeenAt: lastSeen.get(c.id) ?? null,
    })),
  });
  const { items } = await itemsByIds(tx, ids);
  return {
    sessionId,
    seed,
    items: ids.flatMap((id) => {
      const item = items.get(id);
      return item ? [item] : [];
    }),
  };
}

// --- Attempts --------------------------------------------------------------------------

/**
 * Stores a batch of trainer and lesson attempts. The server diagnoses each answer again,
 * records it in `app.attempt` with features and error type (ids already stored are skipped and
 * still count as accepted), and turns new wrong trainer items into case sentence cards, up to
 * DAILY_TRAINER_CARDS per learner day. Returns the mastery of the buckets the batch touched.
 */
export async function submitAttempts(
  tx: Tx,
  ctx: ServiceContext,
  body: SubmitAttempts,
): Promise<ResponseOf<'declension.submitAttempts'>> {
  const { exercises, items, data } = await itemsByIds(
    tx,
    body.attempts.map((a) => a.exerciseId),
  );
  const unknown: Record<string, string> = {};
  body.attempts.forEach((a, i) => {
    if (!exercises.has(a.exerciseId))
      unknown[`body.attempts.${i}.exerciseId`] = 'No such exercise.';
  });
  if (Object.keys(unknown).length > 0) throw validationFailed(unknown);

  const records = body.attempts.map((a) => toRecord(a, exercises, items, data, ctx.now));
  const fresh = await repo.insertAttempts(tx, ctx.userId, records);

  let cardsCreated = 0;
  const wrongExercises = [
    ...new Set(
      records
        .filter((r) => fresh.has(r.id) && !r.correct && r.source === 'trainer')
        .map((r) => r.exerciseId as string),
    ),
  ];
  if (wrongExercises.length > 0) {
    const p = await repo.profileDay(tx, ctx.userId);
    const day = learnerDay(
      ctx.now,
      p?.timezone ?? DEFAULT_TZ,
      p?.dayStartHour ?? DEFAULT_DAY_START,
    );
    let left =
      DAILY_TRAINER_CARDS - (await repo.trainerNotesBetween(tx, ctx.userId, day.start, day.end));
    for (const id of wrongExercises) {
      if (left <= 0) break;
      const ex = exercises.get(id) as ExerciseData;
      if (ex.kind === 'choice_meaning') continue;
      const r = await ctx.ports.notes.createCaseSentenceNote(tx, {
        source: 'declension',
        content: caseSentenceContent(ex, items.get(id) as ExerciseItem, data),
        sourceRef: { kind: 'trainer', exerciseId: id },
      });
      if (r.created) {
        cardsCreated += 1;
        left -= 1;
      }
    }
  }

  const keys = [...new Set(records.map((r) => bucketKey({ ...r, gender: r.gender as never })))];
  return {
    accepted: body.attempts.length,
    cardsCreated,
    mastery: await getMastery(tx, ctx.userId, keys),
  };
}

/** One attempt as `app.attempt` stores it, with the server's diagnosis. */
function toRecord(
  a: AttemptInput,
  exercises: Map<string, ExerciseData>,
  items: Map<string, ExerciseItem>,
  data: ItemData,
  now: Date,
): AttemptRecord {
  const ex = exercises.get(a.exerciseId) as ExerciseData;
  const item = items.get(a.exerciseId) as ExerciseItem;
  const d = diagnoseAnswer(item, a.typed);
  const occurred = new Date(a.occurredAt);
  const lemmaId = headLemmaId(ex, data.lemmas);
  return {
    id: a.id,
    source: a.source,
    ...(a.sessionId ? { sourceRef: a.sessionId } : {}),
    exerciseId: ex.id,
    ...(lemmaId !== undefined ? { lemmaId } : {}),
    case: ex.case,
    number: ex.number,
    gender: ex.gender,
    ...(ex.pattern ? { pattern: ex.pattern } : {}),
    ...(ex.triggerId ? { triggerId: ex.triggerId } : {}),
    correct: d.correct,
    retry: a.retry,
    ...(d.diagnosis ? { diagnosis: d.diagnosis } : {}),
    ...(d.errorType ? { errorType: d.errorType } : {}),
    given: a.typed,
    expected: item.answers[0] as string,
    ...(d.givenCase ? { givenCase: d.givenCase } : {}),
    occurredAt: (occurred > now ? now : occurred).toISOString(),
    durationMs: a.durationMs,
  };
}

// --- Patterns --------------------------------------------------------------------------

export async function getPattern(tx: Tx, id: string): Promise<PatternDetail> {
  const p = await repo.getPattern(tx, id);
  if (!p) throw notFound('No such pattern.');
  const ids = [p.modelLemmaId, p.everydayModelLemmaId].filter((x): x is number => x !== null);
  const lemmas = new Map((await repo.lemmasByIds(tx, ids)).map((l) => [l.id, l]));
  const word = (lemmaId: number | null) => {
    const l = lemmaId === null ? undefined : lemmas.get(lemmaId);
    return l ? { lemmaId: l.id, lemma: l.lemma } : null;
  };
  return {
    id: p.id,
    labelSk: p.labelSk,
    pos: p.pos as PatternDetail['pos'],
    gender: (p.gender as PatternDetail['gender']) ?? null,
    model: word(p.modelLemmaId),
    everydayModel: word(p.everydayModelLemmaId),
    endings: p.endings,
    notesEn: p.notesEn,
  };
}
