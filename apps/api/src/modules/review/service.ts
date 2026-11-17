// Logic of the review module. Owner: B1. It takes ports and a transaction and knows
// nothing about HTTP. Grading and scheduling go through @app/srs only.
import type {
  AnswerResult,
  CardSnapshot,
  CardState,
  Grade,
  QueueCounts,
  Rating,
  ReviewAnswer,
  ReviewItem,
  ReviewQueue,
  SubmitAnswers,
  SubmitAnswersResult,
} from '@app/contracts';
import type { Tx } from '@app/db';
import { diagnoseForm, errorTypeFor, tagOf } from '@app/ling';
import {
  gradeAnswer,
  isKnownStability,
  isSchedulerState,
  newState,
  ratingForGrade,
  replay,
  SCHEDULER_VERSION,
  type SchedulerState,
  schedule,
  snapshotOf,
} from '@app/srs';
import { conflict } from '../../platform/errors';
import { learnerDay } from '../../platform/time';
import type { AttemptRecord, Clock, Ports } from '../../ports';
import { type LingData, lingNeeds, targetOf, variantCount } from './items';
import * as repo from './repo';

export interface ReviewEnv {
  clock: Clock;
  ports: Ports;
}

/** Profile retention is a `real`; round away the float noise so equal settings schedule alike. */
const retentionOf = (s: repo.ReviewSettings) => Math.round(s.desiredRetention * 1e4) / 1e4;

// --- Card shapes --------------------------------------------------------------------------

/** The card's snapshot, read from the scheduler's own state when it has one. */
export function snapshotOfRow(row: repo.CardRow): CardSnapshot {
  if (isSchedulerState(row.schedulerState)) {
    return { cardId: row.id, ...snapshotOf(row.schedulerState) };
  }
  return {
    cardId: row.id,
    state: row.state as CardState,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    scheduler: row.schedulerState ?? null,
  };
}

function stateOf(row: repo.CardRow): SchedulerState | null {
  return isSchedulerState(row.schedulerState) ? row.schedulerState : null;
}

function toItem(row: { card: repo.CardRow; note: repo.NoteRow }, ling: LingData): ReviewItem {
  const snap = snapshotOfRow(row.card);
  const target = targetOf(row.note.content, row.card.variantCursor, ling);
  return {
    cardId: row.card.id,
    noteId: row.note.id,
    kind: row.note.kind as ReviewItem['kind'],
    state: snap.state,
    dueAt: snap.dueAt,
    prompt: target.prompt,
    answers: target.answers,
    formMap: target.formMap,
    ...(target.explain ? { explain: target.explain } : {}),
    variant: target.variant,
    scheduler: stateOf(row.card) ?? newState(row.card.createdAt),
  };
}

// --- Queue --------------------------------------------------------------------------------

interface Allowance {
  counts: QueueCounts;
  remainingNew: number;
  remainingReview: number;
}

/** Today's counts: due learning cards, due reviews and new cards left under the daily caps. */
async function allowance(
  tx: Tx,
  userId: string,
  settings: repo.ReviewSettings,
  now: Date,
): Promise<Allowance> {
  const day = learnerDay(now, settings.timezone, settings.dayStartHour);
  const done = await repo.doneInDay(tx, userId, day);
  const remainingNew = Math.max(0, settings.dailyNewLimit - done.newDone);
  const remainingReview = Math.max(0, settings.dailyReviewLimit - done.reviewDone);
  const [learning, due, fresh] = [
    await repo.countGroup(tx, userId, 'learning', now),
    await repo.countGroup(tx, userId, 'review', now),
    await repo.countGroup(tx, userId, 'new', now),
  ];
  return {
    counts: {
      learning,
      due: Math.min(due, remainingReview),
      new: Math.min(fresh, remainingNew),
    },
    remainingNew,
    remainingReview,
  };
}

/**
 * `GET /review/queue`: learning cards that are due, then due reviews with the oldest first,
 * then new cards in their queue order, up to the daily caps and `limit` items.
 */
export async function reviewQueue(
  tx: Tx,
  env: ReviewEnv,
  userId: string,
  limit: number,
): Promise<ReviewQueue> {
  const now = env.clock.now();
  const settings = await repo.getSettings(tx, userId);
  const a = await allowance(tx, userId, settings, now);
  const learning = await repo.listGroup(tx, userId, 'learning', now, limit);
  const reviews = await repo.listGroup(
    tx,
    userId,
    'review',
    now,
    Math.min(a.remainingReview, limit - learning.length),
  );
  const fresh = await repo.listGroup(
    tx,
    userId,
    'new',
    now,
    Math.min(a.remainingNew, limit - learning.length - reviews.length),
  );
  const rows = [...learning, ...reviews, ...fresh];
  const ling = await repo.loadLing(tx, lingNeeds(rows.map((r) => r.note.content)));
  return {
    items: rows.map((r) => toItem(r, ling)),
    counts: a.counts,
    serverTime: now.toISOString(),
  };
}

// --- Answers ------------------------------------------------------------------------------

interface Graded {
  answer: ReviewAnswer;
  at: Date;
  grade: Grade;
  rating: Rating;
  expected: string;
  variant: number;
  diagnosis: ReturnType<typeof gradeAnswer>['diagnosis'] | null;
  answers: string[];
  formMap: ReviewItem['formMap'];
}

/**
 * Grades again on the server. A revealed answer stays revealed. The learner's own rating wins
 * when it was changed (`overridden`); otherwise the rating follows the server's grade, so an
 * answer the phone marked correct but the server grades wrong is stored as wrong.
 */
function grade(
  answer: ReviewAnswer,
  note: repo.NoteRow,
  ling: LingData,
  strictDiacritics: boolean,
  at: Date,
): Graded {
  const target = targetOf(note.content, answer.variant, ling);
  let g: Grade;
  let diagnosis: Graded['diagnosis'] = null;
  if (answer.clientGrade === 'revealed') {
    g = 'revealed';
  } else {
    const r = gradeAnswer(answer.typed, target.answers, target.formMap, { strictDiacritics });
    g = r.grade;
    diagnosis = r.diagnosis;
  }
  return {
    answer,
    at,
    grade: g,
    rating: answer.overridden ? answer.rating : ratingForGrade(g),
    expected: target.answers[0] ?? '',
    variant: target.variant,
    diagnosis,
    answers: target.answers,
    formMap: target.formMap,
  };
}

const byTimeThenId = (a: { t: number; id: string }, b: { t: number; id: string }) =>
  a.t - b.t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

interface Scheduled {
  final: SchedulerState;
  steps: Map<string, { before: SchedulerState; after: SchedulerState }>;
  total: number;
}

/**
 * Schedules a card's new answers. When every new answer is later than the card's whole log,
 * they are scheduled one by one from the stored state. Otherwise (an answer older than the
 * last review, e.g. from a second device that was offline) the whole log is replayed in time
 * order, ties broken by review id, so any delivery order gives the same state.
 */
function scheduleCard(
  row: repo.CardRow,
  log: { id: string; answeredAt: Date; rating: number }[],
  graded: Graded[],
  retention: number,
): Scheduled {
  const opts = { desiredRetention: retention };
  const fresh = graded
    .map((g) => ({ id: g.answer.id, t: g.at.getTime(), at: g.at, rating: g.rating }))
    .sort(byTimeThenId);
  const steps: Scheduled['steps'] = new Map();
  const current = stateOf(row);
  const lastLogged = log.reduce((m, r) => Math.max(m, r.answeredAt.getTime()), -Infinity);
  const inOrder = current !== null && fresh.every((f) => f.t > lastLogged);

  if (inOrder && current) {
    let state = current;
    for (const f of fresh) {
      const before = state;
      state = schedule(state, f.rating as Rating, f.at, opts).state;
      steps.set(f.id, { before, after: state });
    }
    return { final: state, steps, total: log.length + fresh.length };
  }

  const freshIds = new Set(fresh.map((f) => f.id));
  const all = [
    ...log.map((r) => ({
      id: r.id,
      t: r.answeredAt.getTime(),
      at: r.answeredAt,
      rating: r.rating,
    })),
    ...fresh,
  ].sort(byTimeThenId);
  const final = replay(
    all.map((r) => ({ rating: r.rating as Rating, answeredAt: r.at })),
    { ...opts, createdAt: row.createdAt },
  ).state;
  // The states before and after each new answer, for the log.
  let state = newState(row.createdAt);
  for (const r of all) {
    const before = state;
    state = schedule(state, r.rating as Rating, r.at, opts).state;
    if (freshIds.has(r.id)) steps.set(r.id, { before, after: state });
  }
  return { final, steps, total: all.length };
}

/** The attempt a case sentence review becomes. Its id is the review's id. */
function attemptOf(g: Graded, note: repo.NoteRow, ling: LingData): AttemptRecord | null {
  const c = note.content;
  if (c.kind !== 'case_sentence') return null;
  const trigger = c.triggerId ? ling.triggers.get(c.triggerId) : undefined;
  const lemma = c.lemmaId !== undefined ? ling.lemmas.get(c.lemmaId) : undefined;
  let givenCase: AttemptRecord['givenCase'];
  if (g.diagnosis === 'other_case') {
    const d = diagnoseForm(g.answer.typed, { answers: g.answers, formMap: g.formMap });
    if (d.diagnosis === 'other_case') givenCase = d.readings.find((r) => r.case)?.case;
  }
  const errorType = g.diagnosis
    ? errorTypeFor(g.diagnosis, {
        triggerKind: trigger?.kind,
        expectedTag: tagOf({ case: c.features.case, number: c.features.number }),
      })
    : null;
  return {
    id: g.answer.id,
    source: 'review',
    sourceRef: g.answer.id,
    ...(c.exerciseId ? { exerciseId: c.exerciseId } : {}),
    ...(c.lemmaId !== undefined ? { lemmaId: c.lemmaId } : {}),
    case: c.features.case,
    number: c.features.number,
    ...(c.features.gender ? { gender: c.features.gender } : {}),
    ...(lemma?.pattern ? { pattern: lemma.pattern } : {}),
    ...(c.triggerId ? { triggerId: c.triggerId } : {}),
    // Accents aside, the case was right: a close answer counts as correct for mastery.
    correct: g.grade === 'correct' || g.grade === 'close',
    retry: false,
    ...(g.diagnosis ? { diagnosis: g.diagnosis } : {}),
    ...(errorType ? { errorType } : {}),
    given: g.answer.typed,
    expected: g.expected,
    ...(givenCase ? { givenCase } : {}),
    occurredAt: g.at.toISOString(),
    durationMs: g.answer.durationMs,
  };
}

/**
 * `POST /review/answers`: skips ids already stored and answers for cards the learner does
 * not own, grades again, schedules, and stores the
 * reviews and card states in the caller's one transaction. Every result carries the card's
 * state after the whole batch, so a repeated batch returns the same results.
 */
export async function submitAnswers(
  tx: Tx,
  env: ReviewEnv,
  userId: string,
  body: SubmitAnswers,
): Promise<SubmitAnswersResult> {
  const now = env.clock.now();
  // A repeated id inside one batch counts once.
  const answers = [...new Map(body.answers.map((a) => [a.id, a])).values()];

  // Lock the cards first, so two devices sending the same answers wait for each other.
  const cardIds = [...new Set(answers.map((a) => a.cardId))];
  const rows = await repo.lockCards(tx, userId, cardIds);
  const byCard = new Map(rows.map((r) => [r.card.id, r]));
  const stored = new Map(
    (
      await repo.findReviews(
        tx,
        userId,
        answers.map((a) => a.id),
      )
    ).map((r) => [r.id, r]),
  );
  // An answer for a card the learner does not own (another learner's, or none) is not
  // stored and gets no result: the batch still goes through, so an outbox never sticks, and
  // nothing about the other card is revealed or changed.
  const fresh = answers.filter((a) => !stored.has(a.id) && byCard.has(a.cardId));

  const settings = await repo.getSettings(tx, userId);
  const retention = retentionOf(settings);
  const ling = await repo.loadLing(tx, lingNeeds(rows.map((r) => r.note.content)));

  const freshByCard = new Map<string, Graded[]>();
  for (const a of fresh) {
    const row = byCard.get(a.cardId);
    if (!row) continue;
    // A time in the future is set to now; a time before the card existed to its creation.
    const t = Math.min(
      now.getTime(),
      Math.max(Date.parse(a.answeredAt), row.card.createdAt.getTime()),
    );
    const list = freshByCard.get(a.cardId) ?? [];
    list.push(grade(a, row.note, ling, settings.strictDiacritics, new Date(t)));
    freshByCard.set(a.cardId, list);
  }

  const reviewRows: repo.NewReview[] = [];
  const attempts: AttemptRecord[] = [];
  const knownCandidates: number[] = [];
  for (const [cardId, graded] of freshByCard) {
    const row = byCard.get(cardId);
    if (!row) continue;
    const log = await repo.cardLog(tx, userId, cardId);
    const s = scheduleCard(row.card, log, graded, retention);
    for (const g of graded) {
      const step = s.steps.get(g.answer.id);
      reviewRows.push({
        id: g.answer.id,
        userId,
        cardId,
        answeredAt: g.at,
        receivedAt: now,
        rating: g.rating,
        grade: g.grade,
        overridden: g.answer.overridden,
        typed: g.answer.typed,
        expected: g.expected,
        variant: g.variant,
        durationMs: g.answer.durationMs,
        stateBefore: (step?.before ?? null) as Record<string, unknown> | null,
        stateAfter: (step?.after ?? null) as Record<string, unknown> | null,
        clientId: body.clientId,
        diagnosis: { diagnosis: g.diagnosis, clientGrade: g.answer.clientGrade },
      });
      const attempt = attemptOf(g, row.note, ling);
      if (attempt) attempts.push(attempt);
    }
    const snap = snapshotOf(s.final);
    await repo.updateCard(tx, userId, cardId, {
      state: snap.state,
      dueAt: snap.dueAt ? new Date(snap.dueAt) : null,
      stability: snap.stability,
      difficulty: snap.difficulty,
      reps: snap.reps,
      lapses: snap.lapses,
      lastReviewAt: s.final.lastReviewAt ? new Date(s.final.lastReviewAt) : null,
      schedulerState: s.final as unknown as Record<string, unknown>,
      schedulerVersion: SCHEDULER_VERSION,
      variantCursor: s.total % variantCount(row.note.content),
      updatedAt: now,
    });
    if (row.note.content.kind === 'word' && isKnownStability(s.final.stability)) {
      knownCandidates.push(row.note.content.lemmaId);
    }
  }

  const inserted = await repo.insertReviews(tx, reviewRows);
  if (inserted.size !== reviewRows.length) {
    // Another learner holds one of these ids; nothing of this batch is kept.
    throw conflict('An answer id is taken.');
  }
  if (attempts.length > 0) await env.ports.attempts.record(tx, attempts);
  const newlyKnown = await repo.notYetKnown(tx, userId, [...new Set(knownCandidates)]);
  if (newlyKnown.length > 0) {
    await env.ports.notes.setLemmaStatus(tx, newlyKnown, 'known', 'review');
  }

  const touched = [...new Set([...cardIds, ...[...stored.values()].map((r) => r.cardId)])];
  const cards = new Map(
    (await repo.getCards(tx, userId, touched)).map((c) => [c.id, snapshotOfRow(c)]),
  );
  const gradedById = new Map([...freshByCard.values()].flat().map((g) => [g.answer.id, g]));
  const results: AnswerResult[] = [];
  for (const a of answers) {
    const old = stored.get(a.id);
    const g = gradedById.get(a.id);
    const cardId = old ? old.cardId : a.cardId;
    const card = cards.get(cardId);
    if (!card) continue;
    if (old) {
      results.push({
        id: a.id,
        cardId,
        grade: old.grade as Grade,
        rating: old.rating as Rating,
        card,
      });
    } else if (g) {
      results.push({ id: a.id, cardId, grade: g.grade, rating: g.rating, card });
    }
  }
  const { counts } = await allowance(tx, userId, settings, now);
  return { results, counts };
}
