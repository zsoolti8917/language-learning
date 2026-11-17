// The running review session: a pure reducer (docs/architecture.md, "Review engine").
// Grading and scheduling run here on the phone through packages/srs; the hook around it
// writes each answer to the local queue and the outbox.
import type {
  CardState,
  Diagnosis,
  Grade,
  QueueCounts,
  Rating,
  ReviewAnswer,
  ReviewItem,
} from '@app/contracts';
import {
  DEFAULT_DESIRED_RETENTION,
  gradeAnswer,
  isSchedulerState,
  newState,
  type SchedulerState,
  schedule,
} from '@app/srs';

export interface SessionOptions {
  strictDiacritics: boolean;
  desiredRetention: number;
}

export const DEFAULT_OPTIONS: SessionOptions = {
  strictDiacritics: false,
  desiredRetention: DEFAULT_DESIRED_RETENTION,
};

/** Cards of the current queue already answered on this device, counted against its caps. */
export interface Consumed {
  new: number;
  due: number;
}

export interface Outcome {
  grade: Grade;
  diagnosis: Diagnosis | null;
  /** The rating that Enter accepts: good, hard or again by the grade. */
  defaultRating: Rating;
}

/** One answer the session produced: the record for the outbox and the card's new state. */
export interface AnsweredCard {
  answer: ReviewAnswer;
  item: ReviewItem;
  /** What the card was before the answer, for the cap counts. */
  before: CardState;
}

export interface SessionState {
  status: 'idle' | 'answering' | 'feedback' | 'done';
  options: SessionOptions;
  /** Cards still to show for the first time, in order. */
  main: ReviewItem[];
  /** Learning cards that come back inside the session when their minutes are up. */
  returning: { item: ReviewItem; dueAt: number }[];
  current: ReviewItem | null;
  shownAt: number;
  typed: string;
  outcome: Outcome | null;
  answered: number;
  correct: number;
  /** The last answer, for the hook to store. */
  last: AnsweredCard | null;
}

export type SessionAction =
  | {
      type: 'start';
      items: ReviewItem[];
      counts?: QueueCounts | undefined;
      consumed?: Consumed | undefined;
      options?: Partial<SessionOptions>;
      now: number;
    }
  | { type: 'type'; value: string }
  | { type: 'submit'; now: number }
  | { type: 'reveal'; now: number }
  | { type: 'rate'; rating?: Rating; id: string; now: number };

export const initialSession: SessionState = {
  status: 'idle',
  options: DEFAULT_OPTIONS,
  main: [],
  returning: [],
  current: null,
  shownAt: 0,
  typed: '',
  outcome: null,
  answered: 0,
  correct: 0,
  last: null,
};

const LEARNING: readonly CardState[] = ['learning', 'relearning'];

function dueMs(item: ReviewItem): number {
  return item.dueAt ? Date.parse(item.dueAt) : Number.NEGATIVE_INFINITY;
}

/**
 * Orders the stored queue into a session (docs/architecture.md, "Scheduling"): cards in short
 * steps first, then due reviews with the oldest first, then new cards in the server's order.
 * Due reviews and new cards stop at the queue's counts, less what this device already answered,
 * so the daily caps hold. Cards scheduled for later go to `returning` (learning steps) or wait.
 */
export function buildSession(
  items: readonly ReviewItem[],
  now: number,
  counts?: QueueCounts,
  consumed: Consumed = { new: 0, due: 0 },
): Pick<SessionState, 'main' | 'returning'> {
  const learning: ReviewItem[] = [];
  const returning: SessionState['returning'] = [];
  const due: ReviewItem[] = [];
  const fresh: ReviewItem[] = [];
  for (const item of items) {
    if (item.state === 'new') {
      fresh.push(item);
    } else if (LEARNING.includes(item.state)) {
      if (dueMs(item) <= now) learning.push(item);
      else returning.push({ item, dueAt: dueMs(item) });
    } else if (dueMs(item) <= now) {
      due.push(item);
    }
  }
  learning.sort((a, b) => dueMs(a) - dueMs(b));
  due.sort((a, b) => dueMs(a) - dueMs(b));
  returning.sort((a, b) => a.dueAt - b.dueAt);
  const dueCap = counts ? Math.max(0, counts.due - consumed.due) : due.length;
  const newCap = counts ? Math.max(0, counts.new - consumed.new) : fresh.length;
  return {
    main: [...learning, ...due.slice(0, dueCap), ...fresh.slice(0, newCap)],
    returning,
  };
}

/**
 * The next card: a returning card whose time is up, else the next card of the queue, else the
 * earliest returning card ahead of its time (learning ahead, so the session can finish).
 */
function advance(state: SessionState, now: number): SessionState {
  const base = { ...state, typed: '', outcome: null, shownAt: now };
  const ready = state.returning[0];
  if (ready && ready.dueAt <= now) {
    return {
      ...base,
      status: 'answering',
      current: ready.item,
      returning: state.returning.slice(1),
    };
  }
  const [next, ...rest] = state.main;
  if (next) return { ...base, status: 'answering', current: next, main: rest };
  if (ready) {
    return {
      ...base,
      status: 'answering',
      current: ready.item,
      returning: state.returning.slice(1),
    };
  }
  return { ...base, status: 'done', current: null };
}

/** The card's scheduler state; a missing or unknown one starts the card fresh. */
export function schedulerStateOf(item: ReviewItem, now: number): SchedulerState {
  return isSchedulerState(item.scheduler) ? item.scheduler : newState(new Date(now));
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'start': {
      const options = { ...DEFAULT_OPTIONS, ...action.options };
      const built = buildSession(action.items, action.now, action.counts, action.consumed);
      return advance({ ...initialSession, ...built, options }, action.now);
    }
    case 'type':
      return state.status === 'answering' ? { ...state, typed: action.value } : state;
    case 'submit': {
      if (state.status !== 'answering' || !state.current) return state;
      if (state.typed.trim() === '') return state;
      const { grade, rating, diagnosis } = gradeAnswer(
        state.typed,
        state.current.answers,
        state.current.formMap,
        { strictDiacritics: state.options.strictDiacritics },
      );
      return { ...state, status: 'feedback', outcome: { grade, diagnosis, defaultRating: rating } };
    }
    case 'reveal': {
      if (state.status !== 'answering' || !state.current) return state;
      return {
        ...state,
        status: 'feedback',
        outcome: { grade: 'revealed', diagnosis: null, defaultRating: 1 },
      };
    }
    case 'rate': {
      if (state.status !== 'feedback' || !state.current || !state.outcome) return state;
      const item = state.current;
      const rating = action.rating ?? state.outcome.defaultRating;
      const result = schedule(schedulerStateOf(item, action.now), rating, new Date(action.now), {
        desiredRetention: state.options.desiredRetention,
      });
      const updated: ReviewItem = {
        ...item,
        state: result.snapshot.state,
        dueAt: result.snapshot.dueAt,
        scheduler: result.state,
      };
      const answer: ReviewAnswer = {
        id: action.id,
        cardId: item.cardId,
        answeredAt: new Date(action.now).toISOString(),
        typed: state.typed,
        variant: item.variant,
        clientGrade: state.outcome.grade,
        rating,
        overridden: rating !== state.outcome.defaultRating,
        durationMs: Math.max(0, Math.round(action.now - state.shownAt)),
      };
      const returning =
        LEARNING.includes(updated.state) && updated.dueAt
          ? [...state.returning, { item: updated, dueAt: Date.parse(updated.dueAt) }].sort(
              (a, b) => a.dueAt - b.dueAt,
            )
          : state.returning;
      return advance(
        {
          ...state,
          returning,
          answered: state.answered + 1,
          correct: state.correct + (state.outcome.grade === 'correct' ? 1 : 0),
          last: { answer, item: updated, before: item.state },
        },
        action.now,
      );
    }
  }
}

/** Cards left in the session, the current one included. */
export function remaining(state: SessionState): number {
  return state.main.length + state.returning.length + (state.current ? 1 : 0);
}

/** How an answer counts against the caps of the fetched queue. */
export function consumedBy(before: CardState): Partial<Consumed> {
  if (before === 'new') return { new: 1 };
  if (before === 'review') return { due: 1 };
  return {};
}
