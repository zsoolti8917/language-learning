// Mock answers of the declension endpoints for this feature (picked up by src/mocks/handlers).
// The course has all nine lessons; acc-sg is the short contract example, the other lessons come
// from the mini dataset (mock-data/lessons.json). The mock remembers progress and attempts for
// the page's lifetime, so the course reflects a completed lesson and the summary sees mastery.
import type {
  BucketMastery,
  Course,
  EndpointName,
  ExerciseItem,
  LessonDetail,
  LessonProgress,
  NoteSummary,
  ResponseOf,
} from '@app/contracts';
import { bucketKey, bucketOf } from '@app/ling';
import { type HttpHandler, HttpResponse, http } from 'msw';
import type { ApiInput } from '../../lib/api/client';
import { ENDPOINT_META } from '../../lib/api/endpoints.gen';
import { env } from '../../lib/env';
import { newId } from '../../lib/ids';
import { COURSE, LESSON_ACC_SG, TRAINER_POOL } from './fixtures';
import { levelOf } from './mastery';
import { DATASET_LESSONS } from './mock-data/lessons.gen';
import { DATASET_PATTERNS as PATTERNS } from './mock-data/patterns.gen';

// src/mocks/handlers.ts imports this module (by glob) before its own imports are ready, so
// `mockEndpoint` from there cannot run at load time here. This is the same helper, kept small.
function endpointPattern(name: EndpointName): string {
  const base = env.apiBase.replace(/\/$/, '');
  const path = `${base}${ENDPOINT_META[name].path}`;
  return /^https?:\/\//.test(base) ? path : `*${path}`;
}

type BodyOf<N extends EndpointName> = ApiInput<N> extends { body: infer B } ? B : undefined;

function mockEndpoint<N extends EndpointName>(
  name: N,
  reply: (info: { params: Record<string, string>; body: BodyOf<N> }) => ResponseOf<N> | Response,
): HttpHandler {
  const method = ENDPOINT_META[name].method.toLowerCase() as 'get' | 'post' | 'put';
  return http[method](endpointPattern(name), async ({ request, params }) => {
    const text = await request.text();
    const body = (text ? JSON.parse(text) : undefined) as BodyOf<N>;
    const value = reply({ params: params as Record<string, string>, body });
    if (value instanceof Response) return value;
    return HttpResponse.json(value as never, { status: ENDPOINT_META[name].status });
  });
}

const LESSONS: Record<string, LessonDetail> = {
  ...DATASET_LESSONS,
  'acc-sg': LESSON_ACC_SG,
};

/** Every item the mock knows, to find the bucket of an attempt. */
function findItem(exerciseId: string): ExerciseItem | undefined {
  return (
    TRAINER_POOL.find((i) => i.exerciseId === exerciseId) ??
    Object.values(LESSONS)
      .flatMap((l) => l.steps.flatMap((s) => s.exercises))
      .find((i) => i.exerciseId === exerciseId)
  );
}

interface MockState {
  progress: Map<string, LessonProgress>;
  mastery: Map<string, BucketMastery>;
  /** Cards made by the last completion, for GET /notes?kind=case_sentence. */
  cards: NoteSummary[];
}

function freshState(): MockState {
  return {
    progress: new Map(),
    mastery: new Map(COURSE.mastery.map((b) => [bucketKey(b), b])),
    cards: [],
  };
}

let state = freshState();

/** Forgets progress, mastery and cards (tests call it between runs). */
export function resetCasesMock(): void {
  state = freshState();
}

function course(): Course {
  return {
    lessons: COURSE.lessons.map((l) => {
      const p = state.progress.get(l.id);
      return p ? { ...l, status: p.status, score: p.score ?? l.score } : l;
    }),
    mastery: [...state.mastery.values()],
  };
}

/** This feature's mock answers. */
export const casesHandlers: HttpHandler[] = [
  mockEndpoint('declension.course', () => course()),

  mockEndpoint('declension.lesson', ({ params }) => {
    const detail = LESSONS[params.id as string];
    if (!detail) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'No such lesson' } },
        { status: 404 },
      );
    }
    return { ...detail, progress: state.progress.get(detail.lesson.id) ?? detail.progress };
  }),

  mockEndpoint('declension.saveProgress', ({ params, body }) => {
    const id = params.id as string;
    const now = new Date().toISOString();
    const prev = state.progress.get(id);
    const completed = body.status === 'completed';
    const progress: LessonProgress = {
      lessonId: id,
      status: body.status ?? prev?.status ?? 'in_progress',
      stepIndex: body.stepIndex,
      score: body.score ?? prev?.score ?? null,
      startedAt: prev?.startedAt ?? now,
      completedAt: completed ? now : (prev?.completedAt ?? null),
      updatedAt: now,
    };
    state.progress.set(id, progress);
    if (completed) {
      // About ten of the lesson's sentences become cards.
      const items = (LESSONS[id]?.steps ?? []).flatMap((s) => s.exercises);
      const seen = new Set<string>();
      state.cards = items
        .filter((i) => !seen.has(i.exerciseId) && seen.add(i.exerciseId))
        .slice(0, 10)
        .map((i) => ({
          id: newId(),
          kind: 'case_sentence',
          label: i.cue,
          glossEn: null,
          lemmaId: null,
          source: 'declension',
          suspended: false,
          state: 'new',
          dueAt: null,
          createdAt: now,
        }));
    }
    return progress;
  }),

  // Only the lesson's new cards; any other deck request falls through to the default handler.
  http.get(endpointPattern('notes.list'), ({ request }) => {
    const kind = new URL(request.url).searchParams.get('kind');
    if (kind !== 'case_sentence' || state.cards.length === 0) return undefined;
    const page: ResponseOf<'notes.list'> = { items: state.cards, nextCursor: null };
    return HttpResponse.json(page);
  }),

  mockEndpoint('declension.createSession', ({ body }) => ({
    sessionId: newId(),
    seed: body.seed ?? 42,
    items: TRAINER_POOL.slice(0, body.size),
  })),

  mockEndpoint('declension.submitAttempts', ({ body }) => {
    const touched = new Map<string, { score: number; n: number; bucket: BucketMastery }>();
    for (const a of body.attempts) {
      const item = findItem(a.exerciseId);
      const b = item ? bucketOf(item.features) : null;
      if (!b) continue;
      const key = bucketKey(b);
      const current = state.mastery.get(key) ?? {
        ...b,
        attempts: 0,
        mastery: 0,
        level: 'unseen' as const,
      };
      const x = a.correct ? (a.retry ? 0.5 : 1) : 0;
      const t = touched.get(key) ?? { score: 0, n: 0, bucket: current };
      t.score += x;
      t.n += 1;
      touched.set(key, t);
    }
    for (const [key, t] of touched) {
      const attempts = t.bucket.attempts + t.n;
      const mastery = Math.min(
        1,
        Math.max(0, (t.bucket.mastery * t.bucket.attempts + t.score) / attempts),
      );
      state.mastery.set(key, { ...t.bucket, attempts, mastery, level: levelOf(attempts, mastery) });
    }
    return {
      accepted: body.attempts.length,
      cardsCreated: body.attempts.filter((a) => !a.correct && !a.retry).length,
      mastery: [...touched.keys()].map((k) => state.mastery.get(k) as BucketMastery),
    };
  }),

  mockEndpoint('declension.pattern', ({ params }) => {
    const p = PATTERNS[params.id as string];
    if (!p) {
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'No such pattern' } },
        { status: 404 },
      );
    }
    return p;
  }),
];

/**
 * Picked up by src/mocks/handlers in the browser (mock mode). Under Vitest the shared server
 * keeps the contract examples, because src/lib/api/client.test.ts expects every endpoint to
 * replay its example; this feature's tests add `casesHandlers` with `server.use`.
 */
export const handlers: HttpHandler[] = import.meta.env.MODE === 'test' ? [] : casesHandlers;
