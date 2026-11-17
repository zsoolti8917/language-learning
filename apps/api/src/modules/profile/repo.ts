// SQL of the profile module (Drizzle). Owner: B7. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts.
// The module reads the tables of other modules; it writes only `app.profile`.
import {
  aiCall,
  appText,
  attempt,
  card,
  contentReport,
  conversation,
  lesson,
  lessonProgress,
  message,
  note,
  placement,
  profile,
  queryRows,
  review,
  scenario,
  type Tx,
  tutorError,
  userLemma,
} from '@app/db';
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';

export type ProfileRow = typeof profile.$inferSelect;
export type ProfilePatch = Partial<
  Omit<typeof profile.$inferInsert, 'userId' | 'createdAt' | 'placementDoneAt' | 'currentLessonId'>
>;

const iso = (d: Date) => d.toISOString();
const num = (v: unknown) => Number(v ?? 0);

// --- Profile ---------------------------------------------------------------------

export async function findProfile(tx: Tx, userId: string): Promise<ProfileRow | undefined> {
  const [row] = await tx.select().from(profile).where(eq(profile.userId, userId));
  return row;
}

export async function updateProfile(
  tx: Tx,
  userId: string,
  patch: ProfilePatch,
): Promise<ProfileRow | undefined> {
  const [row] = await tx.update(profile).set(patch).where(eq(profile.userId, userId)).returning();
  return row;
}

/** Deletes the profile; every learner table cascades from it. Returns the rows deleted. */
export async function deleteProfile(tx: Tx, userId: string): Promise<number> {
  const rows = await tx
    .delete(profile)
    .where(eq(profile.userId, userId))
    .returning({ id: profile.userId });
  return rows.length;
}

// --- Export ----------------------------------------------------------------------

/** Every learner table but `profile`, keyed by its camelCase export name. */
export const EXPORT_TABLES = {
  userLemma,
  note,
  card,
  review,
  attempt,
  lessonProgress,
  text: appText,
  conversation,
  message,
  tutorError,
  placement,
  aiCall,
  contentReport,
} as const;

export type ExportTableName = keyof typeof EXPORT_TABLES;

/** All rows of every learner table for this learner (row level security applies too). */
export async function exportRows(
  tx: Tx,
  userId: string,
): Promise<Record<ExportTableName, Record<string, unknown>[]>> {
  const out = {} as Record<ExportTableName, Record<string, unknown>[]>;
  for (const [name, table] of Object.entries(EXPORT_TABLES) as [
    ExportTableName,
    (typeof EXPORT_TABLES)[ExportTableName],
  ][]) {
    // The tables differ in shape; each has user_id, so the filter is the same.
    const rows = (await tx
      .select()
      .from(table as typeof note)
      .where(eq((table as typeof note).userId, userId))) as Record<string, unknown>[];
    out[name] = rows;
  }
  return out;
}

// --- Review counts ----------------------------------------------------------------

export interface CardCounts {
  /** New cards that may be introduced. */
  newAvailable: number;
  /** Learning and relearning cards due at `now`. */
  learningDue: number;
  /** Review cards due at `now`. */
  reviewDue: number;
}

/** Cards in the queue: not suspended, and their note neither suspended nor deleted. */
export async function cardCounts(tx: Tx, userId: string, now: Date): Promise<CardCounts> {
  const [row] = await queryRows<Record<string, unknown>>(
    tx,
    sql`select
          count(*) filter (where c.state = 'new') as new_available,
          count(*) filter (where c.state in ('learning', 'relearning')
                             and c.due_at <= ${iso(now)}::timestamptz) as learning_due,
          count(*) filter (where c.state = 'review'
                             and c.due_at <= ${iso(now)}::timestamptz) as review_due
        from app.card c
        join app.note n on n.id = c.note_id
        where c.user_id = ${userId}::uuid
          and not c.suspended and not n.suspended and n.deleted_at is null`,
  );
  return {
    newAvailable: num(row?.new_available),
    learningDue: num(row?.learning_due),
    reviewDue: num(row?.review_due),
  };
}

export interface DayActivity {
  /** Cards whose first review falls in the day: new cards introduced today. */
  newIntroduced: number;
  /** Reviews in the day of cards first reviewed before the day. */
  reviewsDone: number;
}

export async function dayActivity(
  tx: Tx,
  userId: string,
  start: Date,
  end: Date,
): Promise<DayActivity> {
  const [row] = await queryRows<Record<string, unknown>>(
    tx,
    sql`with first as (
          select card_id, min(answered_at) as first_at
          from app.review where user_id = ${userId}::uuid group by card_id
        )
        select
          (select count(*) from first
            where first_at >= ${iso(start)}::timestamptz
              and first_at < ${iso(end)}::timestamptz) as new_introduced,
          (select count(*) from app.review r join first f on f.card_id = r.card_id
            where r.user_id = ${userId}::uuid
              and r.answered_at >= ${iso(start)}::timestamptz
              and r.answered_at < ${iso(end)}::timestamptz
              and f.first_at < ${iso(start)}::timestamptz) as reviews_done`,
  );
  return { newIntroduced: num(row?.new_introduced), reviewsDone: num(row?.reviews_done) };
}

// --- Today -----------------------------------------------------------------------

export interface ContinueTextRow {
  id: string;
  title: string;
  coverage: number | null;
  progress: { sentence?: number };
}

/** The ready, not archived text the learner opened last. */
export async function lastOpenedText(tx: Tx, userId: string): Promise<ContinueTextRow | undefined> {
  const [row] = await tx
    .select({
      id: appText.id,
      title: appText.title,
      coverage: appText.coverage,
      progress: appText.progress,
    })
    .from(appText)
    .where(
      and(
        eq(appText.userId, userId),
        eq(appText.archived, false),
        eq(appText.status, 'ready'),
        isNotNull(appText.lastOpenedAt),
      ),
    )
    .orderBy(desc(appText.lastOpenedAt), desc(appText.id))
    .limit(1);
  return row;
}

export interface LessonRow {
  id: string;
  ord: number;
  titleEn: string;
  titleSk: string;
  status: string | null;
}

/** The lessons of the declension course in order, with this learner's status (null: no row). */
export async function courseLessons(tx: Tx, userId: string): Promise<LessonRow[]> {
  return tx
    .select({
      id: lesson.id,
      ord: lesson.ord,
      titleEn: lesson.titleEn,
      titleSk: lesson.titleSk,
      status: lessonProgress.status,
    })
    .from(lesson)
    .leftJoin(
      lessonProgress,
      and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, userId)),
    )
    .where(eq(lesson.course, 'declension'))
    .orderBy(asc(lesson.ord), asc(lesson.id));
}

export interface ScenarioRow {
  id: string;
  mode: string;
  titleEn: string;
  titleSk: string;
  targetCases: string[];
  ord: number;
  timesDone: number;
}

/** Every scenario with the number of this learner's completed conversations in it. */
export async function scenarios(tx: Tx, userId: string): Promise<ScenarioRow[]> {
  const done = tx
    .select({ scenarioId: conversation.scenarioId, n: sql<number>`count(*)`.as('n') })
    .from(conversation)
    .where(and(eq(conversation.userId, userId), eq(conversation.status, 'completed')))
    .groupBy(conversation.scenarioId)
    .as('done');
  const rows = await tx
    .select({
      id: scenario.id,
      mode: scenario.mode,
      titleEn: scenario.titleEn,
      titleSk: scenario.titleSk,
      targetCases: scenario.targetCases,
      ord: scenario.ord,
      timesDone: done.n,
    })
    .from(scenario)
    .leftJoin(done, eq(done.scenarioId, scenario.id))
    .orderBy(asc(scenario.ord), asc(scenario.id));
  return rows.map((r) => ({ ...r, timesDone: num(r.timesDone) }));
}

export interface BandCountRow {
  total: number;
  known: number;
  learning: number;
  ignored: number;
}

/** Lemmas ranked `fromRank` to `toRank` and the learner's statuses among them. */
export async function bandCounts(
  tx: Tx,
  userId: string,
  fromRank: number,
  toRank: number,
): Promise<BandCountRow> {
  const [row] = await queryRows<Record<string, unknown>>(
    tx,
    sql`select count(*) as total,
          count(*) filter (where ul.status = 'known') as known,
          count(*) filter (where ul.status = 'learning') as learning,
          count(*) filter (where ul.status = 'ignored') as ignored
        from ling.lemma l
        left join app.user_lemma ul on ul.lemma_id = l.id and ul.user_id = ${userId}::uuid
        where l.freq_rank between ${fromRank} and ${toRank}`,
  );
  return {
    total: num(row?.total),
    known: num(row?.known),
    learning: num(row?.learning),
    ignored: num(row?.ignored),
  };
}

// --- Stats -----------------------------------------------------------------------

export interface ReviewMoment {
  answeredAt: Date;
  rating: number;
}

/** The learner's reviews in [start, end). */
export async function reviewsBetween(
  tx: Tx,
  userId: string,
  start: Date,
  end: Date,
): Promise<ReviewMoment[]> {
  return tx
    .select({ answeredAt: review.answeredAt, rating: review.rating })
    .from(review)
    .where(
      and(
        eq(review.userId, userId),
        sql`${review.answeredAt} >= ${iso(start)}::timestamptz`,
        sql`${review.answeredAt} < ${iso(end)}::timestamptz`,
      ),
    );
}

/**
 * Reviews in [start, end) of mature cards: the card's previous review lies at least
 * `matureDays` before. Returns how many there were and how many passed (rating 2 or more).
 */
export async function matureReviews(
  tx: Tx,
  userId: string,
  start: Date,
  end: Date,
  matureDays: number,
): Promise<{ total: number; passed: number }> {
  const [row] = await queryRows<Record<string, unknown>>(
    tx,
    sql`with log as (
          select answered_at, rating,
                 lag(answered_at) over (partition by card_id order by answered_at, id) as prev_at
          from app.review where user_id = ${userId}::uuid
        )
        select count(*) as total, count(*) filter (where rating >= 2) as passed
        from log
        where answered_at >= ${iso(start)}::timestamptz
          and answered_at < ${iso(end)}::timestamptz
          and prev_at is not null
          and answered_at - prev_at >= make_interval(days => ${matureDays})`,
  );
  return { total: num(row?.total), passed: num(row?.passed) };
}

/** The learner's lemmas by status. */
export async function wordStatusCounts(
  tx: Tx,
  userId: string,
): Promise<{ known: number; learning: number }> {
  const [row] = await queryRows<Record<string, unknown>>(
    tx,
    sql`select count(*) filter (where status = 'known') as known,
               count(*) filter (where status = 'learning') as learning
        from app.user_lemma where user_id = ${userId}::uuid`,
  );
  return { known: num(row?.known), learning: num(row?.learning) };
}
