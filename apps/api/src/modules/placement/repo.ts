// SQL of the placement module (Drizzle). Owner: B6. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts.
//
// Reference data (`ling`) is read here inside the learner's transaction. Of the learner
// tables, this module writes `placement`, and the three cases docs/contracts.md names:
// `profile.placement_done_at` / `current_lesson_id`, and `tested_out` rows of
// `lesson_progress` for lessons that have no row yet. Word statuses and attempts go through
// NotesPort and AttemptsPort.
import type {
  Case,
  Gender,
  GrammaticalNumber,
  PlacementResult,
  Pos,
  RunStatus,
  TriggerKind,
} from '@app/contracts';
import { form, lessonProgress, placement, profile, queryRows, type Tx, trigger } from '@app/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { StoredItem } from './items';

// --- Reference data ---------------------------------------------------------------

export interface VocabCandidate {
  lemmaId: number;
  lemma: string;
  pos: Pos;
  rank: number;
  gloss: string;
}

/**
 * Ranked lemmas up to `maxRank` that a vocabulary item can ask or use as a wrong option:
 * not retired, not a proper name, with a gloss (the first sense).
 */
export async function vocabCandidates(tx: Tx, maxRank: number): Promise<VocabCandidate[]> {
  const rows = await queryRows<{
    id: number;
    lemma: string;
    pos: Pos;
    rank: number;
    gloss: string;
  }>(
    tx,
    sql`select l.id, l.lemma, l.pos, l.freq_rank as rank, s.gloss_en as gloss
        from ling.lemma l
        join lateral (
          select gloss_en from ling.sense where lemma_id = l.id order by ord limit 1
        ) s on true
        where l.freq_rank between 1 and ${maxRank}
          and coalesce((l.flags ->> 'retired')::boolean, false) = false
          and coalesce((l.flags ->> 'proper')::boolean, false) = false
        order by l.freq_rank, l.id`,
  );
  return rows.map((r) => ({
    lemmaId: Number(r.id),
    lemma: r.lemma,
    pos: r.pos,
    rank: Number(r.rank),
    gloss: r.gloss,
  }));
}

export interface TeachingLesson {
  id: string;
  ord: number;
}

/**
 * The teaching lessons of the declension course, in course order: those with a case or a
 * number of their own. The mixed review lesson has neither.
 */
export async function teachingLessons(tx: Tx): Promise<TeachingLesson[]> {
  const rows = await queryRows<{ id: string; ord: number }>(
    tx,
    sql`select id, ord from ling.lesson
        where course = 'declension' and (g_case is not null or g_number is not null)
        order by ord, id`,
  );
  return rows.map((r) => ({ id: r.id, ord: Number(r.ord) }));
}

/** Every lesson of the declension course in order (for the start lesson). */
export async function courseLessons(tx: Tx): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(
    tx,
    sql`select id from ling.lesson where course = 'declension' order by ord, id`,
  );
  return rows.map((r) => r.id);
}

export interface ClozeExercise {
  id: string;
  lessonId: string;
  sentenceSk: string;
  sentenceEn: string;
  start: number;
  end: number;
  lemmaIds: number[];
  cue: string;
  answers: string[];
  case: Case;
  number: GrammaticalNumber;
  gender: Gender;
  pattern: string | null;
  triggerId: string | null;
  difficulty: number;
  verified: boolean;
}

/** Typed gap exercises (`cloze`) of the given lessons. */
export async function clozeExercises(tx: Tx, lessonIds: string[]): Promise<ClozeExercise[]> {
  if (lessonIds.length === 0) return [];
  const rows = await queryRows<{
    id: string;
    lesson_id: string;
    sentence_sk: string;
    sentence_en: string;
    target: { start: number; end: number; lemmaIds: number[]; cue: string; answers: string[] };
    g_case: Case;
    g_number: GrammaticalNumber;
    g_gender: Gender;
    pattern: string | null;
    trigger_id: string | null;
    difficulty: number;
    verified: boolean;
  }>(
    tx,
    sql`select id, lesson_id, sentence_sk, sentence_en, target, g_case, g_number, g_gender,
          pattern, trigger_id, difficulty, verified
        from ling.exercise
        where kind = 'cloze'
          and lesson_id in (${sql.join(
            lessonIds.map((l) => sql`${l}`),
            sql`, `,
          )})
          and coalesce((flags ->> 'retired')::boolean, false) = false
        order by lesson_id, id`,
  );
  return rows.map((r) => ({
    id: r.id,
    lessonId: r.lesson_id,
    sentenceSk: r.sentence_sk,
    sentenceEn: r.sentence_en,
    start: r.target.start,
    end: r.target.end,
    lemmaIds: r.target.lemmaIds,
    cue: r.target.cue,
    answers: r.target.answers,
    case: r.g_case,
    number: r.g_number,
    gender: r.g_gender,
    pattern: r.pattern,
    triggerId: r.trigger_id,
    difficulty: Number(r.difficulty),
    verified: r.verified,
  }));
}

export async function formsOf(tx: Tx, lemmaIds: number[]) {
  if (lemmaIds.length === 0) return [];
  return tx
    .select({ lemmaId: form.lemmaId, form: form.form, tags: form.tags })
    .from(form)
    .where(inArray(form.lemmaId, lemmaIds));
}

export async function triggerKinds(tx: Tx, ids: string[]): Promise<Map<string, TriggerKind>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: trigger.id, kind: trigger.kind })
    .from(trigger)
    .where(inArray(trigger.id, ids));
  return new Map(rows.map((r) => [r.id, r.kind as TriggerKind]));
}

// --- Runs -------------------------------------------------------------------------

export interface RunRow {
  id: string;
  userId: string;
  status: RunStatus;
  items: StoredItem[];
  result: PlacementResult | null;
  startedAt: Date;
  completedAt: Date | null;
}

function toRun(r: typeof placement.$inferSelect): RunRow {
  return {
    id: r.id,
    userId: r.userId,
    status: r.status as RunStatus,
    items: r.items as StoredItem[],
    result: r.result,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
  };
}

/** The learner's run (row level security hides other learners' runs), locked for update. */
export async function getRun(tx: Tx, id: string, forUpdate = false): Promise<RunRow | null> {
  const q = tx.select().from(placement).where(eq(placement.id, id));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ? toRun(row) : null;
}

/** Inserts a new run; false when the id is already taken (by this or another learner). */
export async function insertRun(
  tx: Tx,
  run: { id: string; userId: string; items: StoredItem[]; startedAt: Date },
): Promise<boolean> {
  const rows = await tx
    .insert(placement)
    .values({ ...run, status: 'active' })
    .onConflictDoNothing({ target: placement.id })
    .returning({ id: placement.id });
  return rows.length > 0;
}

export async function updateRun(
  tx: Tx,
  id: string,
  patch: {
    items: StoredItem[];
    status?: RunStatus;
    result?: PlacementResult;
    completedAt?: Date;
  },
): Promise<void> {
  await tx.update(placement).set(patch).where(eq(placement.id, id));
}

// --- Applying a result ------------------------------------------------------------

/**
 * Ranked lemmas up to `rank` (not retired) whose status for the learner is still unknown:
 * no row, or the status `unknown`. Words the learner already sorted keep their status.
 */
export async function unknownLemmasUpTo(tx: Tx, rank: number): Promise<number[]> {
  if (rank <= 0) return [];
  const rows = await queryRows<{ id: number }>(
    tx,
    sql`select l.id from ling.lemma l
        left join app.user_lemma ul on ul.lemma_id = l.id and ul.user_id = (select auth.uid())
        where l.freq_rank between 1 and ${rank}
          and coalesce((l.flags ->> 'retired')::boolean, false) = false
          and coalesce(ul.status, 'unknown') = 'unknown'
        order by l.freq_rank, l.id`,
  );
  return rows.map((r) => Number(r.id));
}

/** `tested_out` rows for the lessons that have no row yet. */
export async function insertTestedOut(
  tx: Tx,
  userId: string,
  lessonIds: string[],
  at: Date,
): Promise<void> {
  if (lessonIds.length === 0) return;
  await tx
    .insert(lessonProgress)
    .values(
      lessonIds.map((lessonId) => ({
        userId,
        lessonId,
        status: 'tested_out',
        completedAt: at,
        updatedAt: at,
      })),
    )
    .onConflictDoNothing();
}

/** Sets the start lesson and the placement date; writes nothing when both already match. */
export async function setPlacementOnProfile(
  tx: Tx,
  userId: string,
  startLessonId: string,
  doneAt: Date,
): Promise<void> {
  await tx
    .update(profile)
    .set({ currentLessonId: startLessonId, placementDoneAt: doneAt, updatedAt: doneAt })
    .where(
      and(
        eq(profile.userId, userId),
        sql`(${profile.currentLessonId} is distinct from ${startLessonId}
          or ${profile.placementDoneAt} is distinct from ${doneAt.toISOString()}::timestamptz)`,
      ),
    );
}
