// The scheduler wrapper over ts-fsrs (docs/architecture.md, "Scheduling").
// No other package imports ts-fsrs. FSRS-7 with its default weights, explicit learning steps
// of 1 and 10 minutes, one relearning step of 10 minutes, no fuzz.
import type { CardSnapshot, CardState, Rating } from '@app/contracts';
import {
  dateChrono,
  defineScheduler,
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from 'ts-fsrs';
import { FSRS7Model, migrateFSRS7Parameters } from 'ts-fsrs/models/fsrs-7';

/** The version label of the stored state. A new layout gets a new label. */
export const SCHEDULER_VERSION = 'fsrs7.1' as const;

export const LEARNING_STEPS = ['1m', '10m'] as const;
export const RELEARNING_STEPS = ['10m'] as const;
export const DEFAULT_DESIRED_RETENTION = 0.9;
export const MAXIMUM_INTERVAL_DAYS = 36_500;
/** A word counts as known for text coverage once its card's stability passes this many days. */
export const KNOWN_STABILITY_DAYS = 21;

/**
 * The scheduler state of one card, stored as opaque JSON (`app.card.scheduler`,
 * `ReviewItem.scheduler`, `CardSnapshot.scheduler`). Read it only through this package.
 */
export type SchedulerState = {
  v: typeof SCHEDULER_VERSION;
  /** 0 new, 1 learning, 2 review, 3 relearning (ts-fsrs `State`). */
  state: 0 | 1 | 2 | 3;
  /** ISO 8601, UTC. */
  dueAt: string;
  lastReviewAt: string | null;
  stability: number;
  stabilityFast: number;
  difficulty: number;
  reps: number;
  lapses: number;
  learningStep: number;
  scheduledDays: number;
};

/** A card snapshot without its id: what `schedule` and `replay` know. */
export type SchedulerSnapshot = Omit<CardSnapshot, 'cardId'>;

export type ScheduleOptions = { desiredRetention: number };

/** A fixed id inside ts-fsrs; it only seeds fuzz, which is off, and keeps states deterministic. */
const TS_FSRS_CARD_ID = 'card';

const CARD_STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning'];

const definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);

function createScheduler(desiredRetention: number) {
  return definition.create({
    config: {
      fractionalDays: true,
      weights: migrateFSRS7Parameters(undefined),
      enableShortTerm: true,
      desiredRetention,
      learningSteps: [...LEARNING_STEPS],
      relearningSteps: [...RELEARNING_STEPS],
      // Keep the 1 and 10 minute steps even when FSRS-7 would jump straight to days.
      allowModelOverride: false,
      enableFuzz: false,
      maximumInterval: MAXIMUM_INTERVAL_DAYS,
    },
  });
}

type Scheduler = ReturnType<typeof createScheduler>;
type FsrsCard = ReturnType<Scheduler['newCard']>;

const schedulers = new Map<number, Scheduler>();

function schedulerFor(desiredRetention: number): Scheduler {
  if (!(desiredRetention > 0 && desiredRetention < 1)) {
    throw new RangeError(`desiredRetention must be between 0 and 1, got ${desiredRetention}`);
  }
  let s = schedulers.get(desiredRetention);
  if (!s) {
    s = createScheduler(desiredRetention);
    schedulers.set(desiredRetention, s);
  }
  return s;
}

function validDate(d: Date, what: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new RangeError(`${what} must be a valid Date`);
  }
  return d;
}

function toState(card: FsrsCard): SchedulerState {
  return {
    v: SCHEDULER_VERSION,
    state: card.state as SchedulerState['state'],
    dueAt: card.dueAt.toISOString(),
    lastReviewAt: card.lastReviewAt ? card.lastReviewAt.toISOString() : null,
    stability: card.stability,
    stabilityFast: card.stabilityFast,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    learningStep: card.learningStep,
    scheduledDays: card.scheduledDays,
  };
}

const SCHEDULE_STATUS = ['new', 'learning', 'review', 'learning'] as const;

function toCard(state: SchedulerState): FsrsCard {
  return {
    cardId: TS_FSRS_CARD_ID,
    state: state.state,
    scheduleStatus: SCHEDULE_STATUS[state.state],
    dueAt: new Date(state.dueAt),
    lastReviewAt: state.lastReviewAt === null ? null : new Date(state.lastReviewAt),
    stability: state.stability,
    stabilityFast: state.stabilityFast,
    difficulty: state.difficulty,
    reps: state.reps,
    lapses: state.lapses,
    learningStep: state.learningStep,
    scheduledDays: state.scheduledDays,
  } as FsrsCard;
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isIso = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));

/** Whether a value is a scheduler state of the current version. */
export function isSchedulerState(value: unknown): value is SchedulerState {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    s.v === SCHEDULER_VERSION &&
    (s.state === 0 || s.state === 1 || s.state === 2 || s.state === 3) &&
    isIso(s.dueAt) &&
    (s.lastReviewAt === null || isIso(s.lastReviewAt)) &&
    isNum(s.stability) &&
    isNum(s.stabilityFast) &&
    isNum(s.difficulty) &&
    isNum(s.reps) &&
    isNum(s.lapses) &&
    isNum(s.learningStep) &&
    isNum(s.scheduledDays)
  );
}

/** Reads opaque JSON as a scheduler state. Throws a TypeError on anything else. */
export function parseSchedulerState(value: unknown): SchedulerState {
  if (!isSchedulerState(value)) {
    const v =
      typeof value === 'object' && value !== null ? (value as { v?: unknown }).v : undefined;
    throw new TypeError(
      v !== undefined && v !== SCHEDULER_VERSION
        ? `unknown scheduler state version ${JSON.stringify(v)}`
        : 'not a scheduler state',
    );
  }
  return value;
}

/** The card snapshot of a state, without the card id. A new card has no due date yet. */
export function snapshotOf(state: SchedulerState): SchedulerSnapshot {
  const isNew = state.state === 0;
  return {
    state: CARD_STATES[state.state] as CardState,
    dueAt: isNew ? null : state.dueAt,
    stability: isNew ? null : state.stability,
    difficulty: isNew ? null : state.difficulty,
    reps: state.reps,
    lapses: state.lapses,
    scheduler: state,
  };
}

/** Whether a card's stability passes 21 days, so its word counts as known. */
export function isKnownStability(stability: number | null | undefined): boolean {
  return typeof stability === 'number' && stability > KNOWN_STABILITY_DAYS;
}

/** The state of a new card made at `now`. */
export function newState(now: Date): SchedulerState {
  validDate(now, 'now');
  return toState(
    schedulerFor(DEFAULT_DESIRED_RETENTION).newCard({ now, cardId: TS_FSRS_CARD_ID }) as FsrsCard,
  );
}

/**
 * Schedules one answer. `state` is the stored opaque state (it is validated). An answer
 * stamped before the card's last review is scheduled at the last review's time, so a
 * clock that runs behind never throws; the server replays the log for out of order answers.
 */
export function schedule(
  state: SchedulerState,
  rating: Rating,
  now: Date,
  opts: ScheduleOptions,
): { state: SchedulerState; snapshot: SchedulerSnapshot } {
  const current = parseSchedulerState(state);
  validDate(now, 'now');
  if (!(rating === 1 || rating === 2 || rating === 3 || rating === 4)) {
    throw new RangeError(`rating must be 1 to 4, got ${String(rating)}`);
  }
  const last = current.lastReviewAt === null ? null : new Date(current.lastReviewAt);
  const at = last !== null && now.getTime() < last.getTime() ? last : now;
  const result = schedulerFor(opts.desiredRetention).review({
    card: toCard(current),
    grade: rating,
    now: at,
  });
  const next = toState(result.card as FsrsCard);
  return { state: next, snapshot: snapshotOf(next) };
}

/**
 * Rebuilds a card's state from its whole review log, in time order (the order of equal
 * times is kept). The card starts as new at `opts.createdAt`, or at the first review.
 * The result equals scheduling the same reviews one by one. Throws a RangeError for an
 * empty log without `createdAt`.
 */
export function replay(
  reviews: readonly { rating: Rating; answeredAt: Date }[],
  opts: ScheduleOptions & { createdAt?: Date },
): { state: SchedulerState; snapshot: SchedulerSnapshot } {
  const ordered = reviews
    .map((r, i) => ({ r, i, t: validDate(r.answeredAt, 'answeredAt').getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.r);
  const start = opts.createdAt ?? ordered[0]?.answeredAt;
  if (start === undefined) throw new RangeError('replay needs a review or createdAt');
  let state = newState(start);
  for (const review of ordered) {
    state = schedule(state, review.rating, review.answeredAt, opts).state;
  }
  return { state, snapshot: snapshotOf(state) };
}
