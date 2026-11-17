// Logic of the profile module. Owner: B7. It takes ports and a transaction and knows
// nothing about HTTP.
import type {
  BucketMastery,
  Case,
  Export,
  LessonStatus,
  Profile,
  QueueCounts,
  ScenarioMode,
  StatsSummary,
  Today,
  UpdateProfile,
} from '@app/contracts';
import type { Tx } from '@app/db';
import type { Config } from '../../platform/config';
import { ApiError, notFound, upstreamFailed, validationFailed } from '../../platform/errors';
import { isTimeZone, learnerDay } from '../../platform/time';
import type { Ports } from '../../ports';
import * as repo from './repo';

// --- Profile ---------------------------------------------------------------------

export function toProfile(row: repo.ProfileRow): Profile {
  return {
    userId: row.userId,
    displayName: row.displayName,
    uiLang: row.uiLang,
    explainLang: row.explainLang,
    level: row.level as Profile['level'],
    timezone: row.timezone,
    dayStartHour: row.dayStartHour,
    dailyNewLimit: row.dailyNewLimit,
    dailyReviewLimit: row.dailyReviewLimit,
    // `real` is a 4 byte float: 0.9 comes back as 0.8999999761581421.
    desiredRetention: Math.round(row.desiredRetention * 1e6) / 1e6,
    strictDiacritics: row.strictDiacritics,
    wordsBandTarget: row.wordsBandTarget,
    settings: row.settings,
    placementDoneAt: row.placementDoneAt?.toISOString() ?? null,
    currentLessonId: row.currentLessonId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function loadProfile(tx: Tx, userId: string): Promise<repo.ProfileRow> {
  const row = await repo.findProfile(tx, userId);
  // The route helper creates the row before the handler runs; a miss means it was deleted.
  if (!row) throw notFound('No profile.');
  return row;
}

export async function getProfile(tx: Tx, userId: string): Promise<Profile> {
  return toProfile(await loadProfile(tx, userId));
}

/**
 * Checks what the contract schema cannot: the time zone must be one the runtime knows.
 * The ranges of the caps, the hour and the retention are checked by the schema.
 */
export function checkUpdate(body: UpdateProfile): void {
  const fields: Record<string, string> = {};
  if (body.timezone !== undefined && !isTimeZone(body.timezone))
    fields['body.timezone'] = 'Unknown time zone name.';
  if (Object.keys(fields).length > 0) throw validationFailed(fields);
}

export async function updateProfile(
  tx: Tx,
  userId: string,
  body: UpdateProfile,
  now: Date,
): Promise<Profile> {
  checkUpdate(body);
  const patch: repo.ProfilePatch = {};
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length === 0) return getProfile(tx, userId);
  const row = await repo.updateProfile(tx, userId, { ...patch, updatedAt: now });
  if (!row) throw notFound('No profile.');
  return toProfile(row);
}

// --- Deletion --------------------------------------------------------------------

/** Throws before anything is deleted when the login could not be deleted afterwards. */
export function checkLoginDeletion(config: Config): void {
  if (config.authMode !== 'supabase') return;
  if (!config.supabaseUrl || !config.supabaseSecretKey)
    throw new ApiError('internal', 'Account deletion is not configured.');
}

/** Deletes the profile row; every learner table cascades from it. */
export async function deleteRows(tx: Tx, userId: string): Promise<void> {
  await repo.deleteProfile(tx, userId);
}

/**
 * Deletes the login through the Supabase admin interface. In dev mode there is no login to
 * delete. Never call it inside a transaction. A login that is already gone counts as deleted.
 */
export async function deleteLogin(
  config: Config,
  userId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (config.authMode !== 'supabase') return;
  checkLoginDeletion(config);
  const key = config.supabaseSecretKey as string;
  let res: Response;
  try {
    res = await fetchImpl(
      `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { apikey: key, authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw upstreamFailed('The login service could not be reached.');
  }
  // Drain the body so the connection is released.
  await res.text().catch(() => '');
  if (res.ok || res.status === 404) return;
  throw upstreamFailed('The login service refused to delete the login.');
}

// --- Export ----------------------------------------------------------------------

function plain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'userId') continue;
    out[k] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

export async function exportAll(tx: Tx, userId: string, now: Date): Promise<Export> {
  const profile = await getProfile(tx, userId);
  const rows = await repo.exportRows(tx, userId);
  const tables: Export['tables'] = {};
  for (const [name, list] of Object.entries(rows)) tables[name] = list.map(plain);
  return { version: 1, exportedAt: now.toISOString(), profile, tables };
}

// --- The learner's day -----------------------------------------------------------

interface DayOf {
  start: Date;
  end: Date;
  /** YYYY-MM-DD of the day in the learner's time zone. */
  date: string;
}

function dateIn(t: Date, timezone: string): string {
  const tz = isTimeZone(timezone) ? timezone : 'UTC';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}

function dayOf(now: Date, p: Pick<repo.ProfileRow, 'timezone' | 'dayStartHour'>): DayOf {
  const { start, end } = learnerDay(now, p.timezone, p.dayStartHour);
  return { start, end, date: dateIn(start, p.timezone) };
}

// --- Review counts ---------------------------------------------------------------

/**
 * The counts of the review queue at `now` (the definition B1's `GET /review/queue` uses):
 * - `learning`: learning and relearning cards due at `now`, without a cap;
 * - `due`: review cards due at `now`, capped by `dailyReviewLimit` minus the reviews done
 *   today of cards first reviewed before today;
 * - `new`: new cards, capped by `dailyNewLimit` minus the cards first reviewed today.
 * Suspended cards and cards of suspended or deleted notes do not count. The day is the
 * learner's day (time zone and day start hour of the profile).
 */
export async function queueCounts(tx: Tx, p: repo.ProfileRow, now: Date): Promise<QueueCounts> {
  const day = dayOf(now, p);
  const cards = await repo.cardCounts(tx, p.userId, now);
  const done = await repo.dayActivity(tx, p.userId, day.start, day.end);
  return {
    due: Math.min(cards.reviewDue, Math.max(0, p.dailyReviewLimit - done.reviewsDone)),
    new: Math.min(cards.newAvailable, Math.max(0, p.dailyNewLimit - done.newIntroduced)),
    learning: cards.learningDue,
  };
}

// --- Today -----------------------------------------------------------------------

/** Three bands of 1,000 frequency ranks (docs/work-packages.md, B6). */
export const BAND_SIZE = 1000;
export const BAND_COUNT = 3;
export const WEAK_BUCKET_LIMIT = 3;

const DONE_LESSON: ReadonlySet<string> = new Set(['completed', 'tested_out']);

/** Weak buckets, weakest first. */
export function weakBuckets(mastery: BucketMastery[], limit = WEAK_BUCKET_LIMIT): BucketMastery[] {
  return mastery
    .filter((m) => m.level === 'weak')
    .sort((a, b) => a.mastery - b.mastery || b.attempts - a.attempts)
    .slice(0, limit);
}

/**
 * The lesson to do next: the profile's current lesson unless it is done, else the first
 * lesson of the course that is not done. A lesson without a progress row is `available`
 * (every lesson may be opened). Null when every lesson is done.
 */
export function pickNextLesson(
  lessons: repo.LessonRow[],
  currentLessonId: string | null,
): Today['nextLesson'] {
  const open = (l: repo.LessonRow) => !DONE_LESSON.has(l.status ?? '');
  const current = lessons.find((l) => l.id === currentLessonId && open(l));
  const next = current ?? lessons.find(open);
  if (!next) return null;
  return {
    id: next.id,
    titleEn: next.titleEn,
    titleSk: next.titleSk,
    status: (next.status ?? 'available') as LessonStatus,
  };
}

/**
 * A tutor scenario for today. With a weak bucket: a case coach for the weakest case, else any
 * scenario that targets it. Without one: the scenario done least often (case coach included).
 * Ties go to the course order. Null when there is no scenario.
 */
export function pickTutorScenario(
  list: repo.ScenarioRow[],
  weakest: Case | undefined,
): Today['tutorSuggestion'] {
  const byUse = (a: repo.ScenarioRow, b: repo.ScenarioRow) =>
    a.timesDone - b.timesDone || a.ord - b.ord;
  let pick: repo.ScenarioRow | undefined;
  if (weakest) {
    const targeting = list.filter((s) => s.targetCases.includes(weakest)).sort(byUse);
    pick = targeting.find((s) => s.mode === 'case_coach') ?? targeting[0];
  }
  pick ??= [...list].sort(byUse)[0];
  if (!pick) return null;
  return {
    scenarioId: pick.id,
    mode: pick.mode as ScenarioMode,
    titleEn: pick.titleEn,
    titleSk: pick.titleSk,
  };
}

/**
 * The band the learner works on: the first band with a word that is neither known nor
 * ignored. When every band is finished, the last band that has words (band 0 without content).
 */
export async function currentBand(tx: Tx, p: repo.ProfileRow): Promise<Today['words']> {
  let last: Today['words'] | null = null;
  for (let band = 0; band < BAND_COUNT; band++) {
    const fromRank = band * BAND_SIZE + 1;
    const toRank = (band + 1) * BAND_SIZE;
    const c = await repo.bandCounts(tx, p.userId, fromRank, toRank);
    const words = {
      band,
      fromRank,
      toRank,
      total: c.total,
      known: c.known,
      learning: c.learning,
      target: p.wordsBandTarget,
    };
    if (c.known + c.ignored < c.total) return words;
    if (c.total > 0 || last === null) last = words;
  }
  return last as Today['words'];
}

/**
 * The plan for today. A learner who has not finished placement (`placementDoneAt` null) gets
 * the first run state: no weak buckets and no tutor suggestion, so the home screen leads to
 * the placement check; reviews, a text and the first lesson still show.
 */
export async function today(tx: Tx, ports: Ports, userId: string, now: Date): Promise<Today> {
  const p = await loadProfile(tx, userId);
  const day = dayOf(now, p);
  const review = await queueCounts(tx, p, now);
  const text = await repo.lastOpenedText(tx, userId);
  const nextLesson = pickNextLesson(await repo.courseLessons(tx, userId), p.currentLessonId);
  const firstRun = p.placementDoneAt === null;
  const weak = firstRun ? [] : weakBuckets(await ports.attempts.getMastery(tx));
  const tutorSuggestion = firstRun
    ? null
    : pickTutorScenario(await repo.scenarios(tx, userId), weak[0]?.case);
  return {
    date: day.date,
    review,
    continueText: text
      ? {
          id: text.id,
          title: text.title,
          coverage: text.coverage === null ? null : Math.min(1, Math.max(0, text.coverage)),
          progress: text.progress ?? {},
        }
      : null,
    nextLesson,
    weakBuckets: weak,
    tutorSuggestion,
    words: await currentBand(tx, p),
  };
}

// --- Stats -----------------------------------------------------------------------

export const STATS_DAYS = 7;
export const RETENTION_DAYS = 30;
/** A review is of a mature card when the card's previous review lies this many days back. */
export const MATURE_INTERVAL_DAYS = 21;

/** The learner days of the last `n` days, oldest first, ending with today. */
export function lastDays(
  now: Date,
  p: Pick<repo.ProfileRow, 'timezone' | 'dayStartHour'>,
  n: number = STATS_DAYS,
): DayOf[] {
  const days: DayOf[] = [dayOf(now, p)];
  while (days.length < n) {
    const first = days[0] as DayOf;
    days.unshift(dayOf(new Date(first.start.getTime() - 1), p));
  }
  return days;
}

/** A review counts as correct when it was not rated again. */
const passed = (rating: number) => rating >= 2;

export async function stats(
  tx: Tx,
  ports: Ports,
  userId: string,
  now: Date,
): Promise<StatsSummary> {
  const p = await loadProfile(tx, userId);
  const days = lastDays(now, p, STATS_DAYS);
  const first = days[0] as DayOf;
  const last = days[days.length - 1] as DayOf;
  const reviews = await repo.reviewsBetween(tx, userId, first.start, last.end);
  const reviewsPerDay = days.map((d) => {
    const inDay = reviews.filter(
      (r) =>
        r.answeredAt.getTime() >= d.start.getTime() && r.answeredAt.getTime() < d.end.getTime(),
    );
    return {
      date: d.date,
      reviews: inDay.length,
      correct: inDay.filter((r) => passed(r.rating)).length,
    };
  });

  const since = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const mature = await repo.matureReviews(tx, userId, since, now, MATURE_INTERVAL_DAYS);
  const retention30d = mature.total === 0 ? null : mature.passed / mature.total;

  const words = await repo.wordStatusCounts(tx, userId);
  const mastery = (await ports.attempts.getMastery(tx)).filter((m) => m.attempts > 0);
  return { reviewsPerDay, retention30d, words, mastery };
}
