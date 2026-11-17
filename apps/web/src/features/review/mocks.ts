// Mock answers of the review feature (picked up by src/mocks/handlers.ts). The contract
// example of `GET /review/queue` has two cards and a scheduler state that packages/srs does not
// read, so this queue builds seven cards from the contract's example exercises, each with a
// real scheduler state. `POST /review/answers` answers with a card state per answer.
import {
  type CardSnapshot,
  type Case,
  examples,
  type GrammaticalNumber,
  type QueueCounts,
  type ReviewItem,
  type ReviewQueue,
  type SubmitAnswers,
  type SubmitAnswersResult,
} from '@app/contracts';
import { newState, type SchedulerState, schedule } from '@app/srs';
import { HttpResponse, http } from 'msw';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';

const NOW = '2026-11-17T08:30:00.000Z';

function cardId(n: number) {
  return `0193a1b2-c3d4-7e5f-8a6b-0000000a${n.toString(16).padStart(4, '0')}`;
}
function noteId(n: number) {
  return `0193a1b2-c3d4-7e5f-8a6b-0000000b${n.toString(16).padStart(4, '0')}`;
}

interface ExampleExercise {
  exerciseId: string;
  sentenceSk: string;
  sentenceEn: string;
  blank: { start: number; end: number };
  cue: string;
  answers: string[];
  formMap: Record<string, string[]>;
  features: { case: Case; number: GrammaticalNumber };
  trigger?: { label: string };
}

/** Every example exercise of the contract, once each (their forms are checked there). */
function exampleExercises(): ExampleExercise[] {
  const seen = new Map<string, ExampleExercise>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.exerciseId === 'string' && o.formMap && Array.isArray(o.answers) && o.blank) {
        seen.set(o.exerciseId, o as unknown as ExampleExercise);
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  walk(examples);
  return [...seen.values()].sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
}

/** A card in long intervals whose due date has passed: learnt `daysAgo` days ago. */
function reviewState(now: Date, daysAgo: number): SchedulerState {
  let t = new Date(now.getTime() - daysAgo * 86_400_000);
  let s = newState(t);
  while (s.state !== 2) {
    s = schedule(s, 3, t, { desiredRetention: 0.9 }).state;
    t = new Date(s.dueAt);
  }
  return s;
}

/** The mock queue: three due reviews and four new cards, all due at `now`. */
export function mockQueue(now = new Date(NOW)): ReviewQueue {
  const items: ReviewItem[] = exampleExercises().map((ex, i) => {
    const scheduler = i < 3 ? reviewState(now, 30 + i) : newState(now);
    const isReview = scheduler.state === 2;
    return {
      cardId: cardId(i + 1),
      noteId: noteId(i + 1),
      kind: 'case_sentence',
      state: isReview ? 'review' : 'new',
      dueAt: isReview ? scheduler.dueAt : null,
      prompt: {
        sentenceSk: ex.sentenceSk,
        blank: ex.blank,
        sentenceEn: ex.sentenceEn,
        cue: ex.cue,
      },
      answers: ex.answers,
      formMap: ex.formMap,
      explain: {
        case: ex.features.case,
        number: ex.features.number,
        ...(ex.trigger ? { triggerLabel: ex.trigger.label } : {}),
      },
      variant: 0,
      scheduler,
    };
  });
  const due = items.filter((i) => i.state === 'review').length;
  return {
    items,
    counts: { due, new: items.length - due, learning: 0 },
    serverTime: now.toISOString(),
  };
}

let counts: QueueCounts | null = null;

/**
 * `mockEndpoint` of src/mocks/handlers cannot be called here: that module imports this one
 * through its glob before its own imports are ready (an import cycle), so the two handlers are
 * built with msw directly, on the same URL pattern.
 */
function pattern(name: 'review.queue' | 'review.submitAnswers'): string {
  const base = env.apiBase.replace(/\/$/, '');
  const path = `${base}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(base) ? path : `*${path}`;
}

const reviewHandlers = [
  http.get(pattern('review.queue'), () => {
    const q = mockQueue(new Date());
    counts = q.counts;
    return HttpResponse.json(q);
  }),
  http.post(pattern('review.submitAnswers'), async ({ request }) => {
    const body = (await request.json()) as SubmitAnswers;
    const results = body.answers.map((a) => {
      const at = new Date(a.answeredAt);
      const { state, snapshot } = schedule(newState(at), a.rating, at, { desiredRetention: 0.9 });
      const card: CardSnapshot = { cardId: a.cardId, ...snapshot, scheduler: state };
      return { id: a.id, cardId: a.cardId, grade: a.clientGrade, rating: a.rating, card };
    });
    const reply: SubmitAnswersResult = {
      results,
      counts: counts ?? { due: 0, new: 0, learning: 0 },
    };
    return HttpResponse.json(reply);
  }),
];

/**
 * In the browser (dev:mock, the mock build, Playwright) these replace the defaults. Under
 * Vitest they stay off: src/lib/api/client.test.ts (F6) expects every endpoint of the shared
 * mock server to answer with its contract example. The review tests install them per test
 * with `server.use(...reviewMockHandlers)` or their own answers.
 */
export const reviewMockHandlers = reviewHandlers;
export const handlers = import.meta.env.MODE === 'test' ? [] : reviewHandlers;
