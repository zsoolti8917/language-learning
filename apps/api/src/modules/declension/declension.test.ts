// The declension endpoints and the real AttemptsPort on PGlite with the mini dataset. One test
// database for the whole file; every test signs in as a new learner.
import {
  type AttemptInput,
  CourseSchema,
  LessonDetailSchema,
  LessonProgressSchema,
  PatternDetailSchema,
  SubmitAttemptsResultSchema,
  TrainerSessionSchema,
} from '@app/contracts';
import { attempt, exercise, lessonProgress, note } from '@app/db';
import { uuidv7 } from '@app/testkit';
import { loadMini } from '@app/testkit/mini';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { currentUserId } from '../../platform/tx';
import type { NotesPort } from '../../ports';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import { masteryOf } from './mastery';
import { DAILY_TRAINER_CARDS, LESSON_CARDS } from './service';

const mini = loadMini();
let t: TestApp;

/**
 * NotesPort for these tests: stores case sentence notes in `app.note` (one per exercise, as
 * B1's port does), so the daily cap, which counts the learner's notes, can be tested before
 * the notes module lands.
 */
function createDbNotes(now: () => Date): NotesPort {
  const unused = () => {
    throw new Error('not used by the declension module');
  };
  return {
    async createCaseSentenceNote(tx, input) {
      const userId = await currentUserId(tx);
      const id = input.id ?? uuidv7();
      const rows = await tx
        .insert(note)
        .values({
          id,
          userId,
          kind: 'case_sentence',
          lemmaId: input.content.lemmaId ?? null,
          exerciseId: input.content.exerciseId ?? null,
          content: input.content,
          source: input.source,
          sourceRef: input.sourceRef ?? null,
          createdAt: now(),
          updatedAt: now(),
        })
        .onConflictDoNothing()
        .returning({ id: note.id });
      if (rows[0]) return { noteId: id, created: true };
      const [same] = await tx
        .select({ id: note.id })
        .from(note)
        .where(and(eq(note.userId, userId), eq(note.exerciseId, input.content.exerciseId ?? '')));
      return { noteId: same?.id ?? id, created: false };
    },
    createWordNote: unused,
    createPhraseNote: unused,
    suspendNote: unused,
    setLemmaStatus: unused,
  };
}

beforeAll(async () => {
  let clock: { now(): Date } | undefined;
  t = await createTestApp({
    ports: { notes: createDbNotes(() => (clock as { now(): Date }).now()) },
  });
  clock = t.clock;
});
afterAll(() => t.close());

const notesOf = async (userId: string) =>
  t.db.db.select().from(note).where(eq(note.userId, userId));
const attemptsOf = async (userId: string) =>
  t.db.db.select().from(attempt).where(eq(attempt.userId, userId));

function input(exerciseId: string, typed: string, over: Partial<AttemptInput> = {}): AttemptInput {
  const ex = mini.exerciseById.get(exerciseId);
  const right = ex?.target.answers[0];
  return {
    id: uuidv7(),
    source: 'trainer',
    exerciseId,
    typed,
    correct: typed === right,
    retry: false,
    clientDiagnosis: typed === right ? 'correct' : 'not_a_form',
    occurredAt: t.clock.now().toISOString(),
    durationMs: 3000,
    ...over,
  };
}

async function submit(me: TestClient, attempts: AttemptInput[]) {
  const res = await me.post('/declension/attempts', { attempts });
  expect(res.status, res.text).toBe(200);
  return SubmitAttemptsResultSchema.parse(res.body);
}

const LOC_CLOZE = [...mini.exerciseById.values()]
  .filter((e) => e.lessonId === 'loc-sg' && e.kind === 'cloze' && e.target.lemmaIds.length === 1)
  .map((e) => e.id);

describe('course', () => {
  it('opens the first lesson to a new learner and lists every bucket', async () => {
    const res = await t.as().get('/declension/course');
    expect(res.status).toBe(200);
    const course = CourseSchema.parse(res.body);
    expect(course.lessons.map((l) => l.id)).toEqual([
      'acc-sg',
      'loc-sg',
      'gen-sg',
      'ins-sg',
      'dat-pron',
      'nom-acc-pl',
      'loc-ins-dat-pl',
      'gen-pl',
      'mixed',
    ]);
    expect(course.lessons.map((l) => l.status)).toEqual([
      'available',
      ...Array.from({ length: 8 }, () => 'locked'),
    ]);
    expect(course.mastery).toHaveLength(56);
    expect(course.mastery.every((m) => m.level === 'unseen' && m.attempts === 0)).toBe(true);
  });

  it('lets a learner start any lesson early', async () => {
    const me = t.as();
    const res = await me.put('/declension/lessons/gen-pl/progress', { stepIndex: 1 });
    expect(res.status, res.text).toBe(200);
    const course = CourseSchema.parse((await me.get('/declension/course')).body);
    const status = Object.fromEntries(course.lessons.map((l) => [l.id, l.status]));
    expect(status).toMatchObject({
      'acc-sg': 'available',
      'gen-pl': 'in_progress',
      mixed: 'locked',
    });
  });
});

describe('lesson detail', () => {
  it('returns the steps with their exercises as items, the triggers and no progress yet', async () => {
    const res = await t.as().get('/declension/lessons/acc-sg');
    expect(res.status).toBe(200);
    const d = LessonDetailSchema.parse(res.body);
    expect(d.steps.map((s) => s.content.kind)).toEqual([
      'explain',
      'triggers',
      'comprehension',
      'production',
      'checkpoint',
    ]);
    for (const s of d.steps) {
      const ids = 'exerciseIds' in s.content ? s.content.exerciseIds : [];
      expect(s.exercises.map((e) => e.exerciseId)).toEqual(ids);
    }
    const knihu = d.steps[3]?.exercises.find((e) => e.exerciseId === 'ex-3fa94c21d0');
    expect(knihu?.formMap.knihu).toEqual(['s4']);
    expect(knihu?.siblingEndings).toMatchObject({ zena: 'u', ulica: 'u', gazdina: 'ú' });
    expect(d.triggers.map((x) => x.id).sort()).toEqual(
      ['prep-na-acc', 'prep-pre', 'q-co-acc', 'q-koho-acc', 'verb-vidiet'].sort(),
    );
    expect(d.progress).toBeNull();
  });

  it('answers 404 for an unknown lesson', async () => {
    const res = await t.as().get('/declension/lessons/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('pattern', () => {
  it('returns label, model word, endings and notes', async () => {
    const res = await t.as().get('/declension/patterns/chlap');
    expect(res.status).toBe(200);
    const p = PatternDetailSchema.parse(res.body);
    expect(p).toMatchObject({
      id: 'chlap',
      labelSk: 'chlap',
      pos: 'noun',
      gender: 'm_anim',
      model: { lemmaId: 1, lemma: 'chlap' },
      everydayModel: null,
    });
    expect(p.endings.s2).toBe('a');
    expect((await t.as().get('/declension/patterns/nope')).status).toBe(404);
  });
});

describe('lesson progress', () => {
  it('completes at 75%, creates the cards once with wrong items first, and opens the next lesson', async () => {
    const me = t.as();
    const userId = me.id as string;
    // Two wrong answers in the lesson before it is completed.
    await submit(me, [
      input('ex-3fa94c21d0', 'kniha', { source: 'lesson' }),
      input('ex-9308112f39', 'xyz', { source: 'lesson' }),
      input('ex-9308112f39', 'xyz', { source: 'lesson', retry: true }),
    ]);
    expect(await notesOf(userId)).toHaveLength(0); // lesson items wait for completion

    const started = await me.put('/declension/lessons/acc-sg/progress', { stepIndex: 2 });
    expect(LessonProgressSchema.parse(started.body)).toMatchObject({
      status: 'in_progress',
      stepIndex: 2,
      completedAt: null,
    });

    const failed = await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      score: { correct: 5, total: 8 },
    });
    expect(failed.body).toMatchObject({ status: 'in_progress', score: { correct: 5, total: 8 } });
    const refused = await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      status: 'completed',
      score: { correct: 5, total: 8 },
    });
    expect(refused.status).toBe(409);

    t.clock.advance(60_000);
    const done = await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      score: { correct: 6, total: 8 },
    });
    expect(done.status, done.text).toBe(200);
    const progress = LessonProgressSchema.parse(done.body);
    expect(progress).toMatchObject({ status: 'completed', score: { correct: 6, total: 8 } });
    expect(progress.completedAt).toBe(t.clock.now().toISOString());

    const notes = await notesOf(userId);
    expect(notes).toHaveLength(LESSON_CARDS);
    // Wrong items first: ex-9308112f39 (two wrong), then ex-3fa94c21d0 (one).
    const order = [...notes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => n.exerciseId);
    expect(order.slice(0, 2)).toEqual(['ex-9308112f39', 'ex-3fa94c21d0']);
    expect(notes.every((n) => n.source === 'declension' && n.kind === 'case_sentence')).toBe(true);
    const meaning = new Set(
      [...mini.exerciseById.values()].filter((e) => e.kind === 'choice_meaning').map((e) => e.id),
    );
    expect(notes.some((n) => meaning.has(n.exerciseId ?? ''))).toBe(false);

    // The same request again, and a later save: no new cards, still completed.
    const again = await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      status: 'completed',
      score: { correct: 6, total: 8 },
    });
    expect(again.status).toBe(200);
    const later = await me.put('/declension/lessons/acc-sg/progress', { stepIndex: 1 });
    expect(later.body).toMatchObject({ status: 'completed', completedAt: progress.completedAt });
    expect(await notesOf(userId)).toHaveLength(LESSON_CARDS);

    const course = CourseSchema.parse((await me.get('/declension/course')).body);
    expect(course.lessons.slice(0, 3).map((l) => l.status)).toEqual([
      'completed',
      'available',
      'locked',
    ]);
    const [next] = await t.db.db
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, 'loc-sg')));
    expect(next?.status).toBe('available');

    const detail = LessonDetailSchema.parse((await me.get('/declension/lessons/acc-sg')).body);
    expect(detail.progress?.status).toBe('completed');
  });

  it('refuses locked, available, a score above its total, a step past the end and unknown lessons', async () => {
    const me = t.as();
    expect(
      (await me.put('/declension/lessons/acc-sg/progress', { stepIndex: 0, status: 'locked' }))
        .status,
    ).toBe(409);
    expect(
      (await me.put('/declension/lessons/acc-sg/progress', { stepIndex: 0, status: 'available' }))
        .status,
    ).toBe(409);
    const over = await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 0,
      score: { correct: 9, total: 8 },
    });
    expect(over.status).toBe(400);
    expect((await me.put('/declension/lessons/acc-sg/progress', { stepIndex: 9 })).status).toBe(
      400,
    );
    expect((await me.put('/declension/lessons/nope/progress', { stepIndex: 0 })).status).toBe(404);
  });
});

describe('sessions', () => {
  it('gives the same items for the same seed and history', async () => {
    const me = t.as();
    const a = TrainerSessionSchema.parse(
      (await me.post('/declension/sessions', { mode: 'mixed', size: 8, seed: 7 })).body,
    );
    const b = TrainerSessionSchema.parse(
      (await me.post('/declension/sessions', { mode: 'mixed', size: 8, seed: 7 })).body,
    );
    expect(a.seed).toBe(7);
    expect(a.items).toHaveLength(8);
    expect(b.items.map((i) => i.exerciseId)).toEqual(a.items.map((i) => i.exerciseId));
    expect(b.sessionId).not.toBe(a.sessionId);
    // A new learner has only acc-sg open.
    expect(a.items.every((i) => mini.exerciseById.get(i.exerciseId)?.lessonId === 'acc-sg')).toBe(
      true,
    );
    // Without a seed the server picks one and returns it.
    const c = TrainerSessionSchema.parse(
      (await me.post('/declension/sessions', { mode: 'mixed', size: 3 })).body,
    );
    expect(Number.isInteger(c.seed)).toBe(true);
  });

  it('lesson mode drills the given lesson, or the current one', async () => {
    const me = t.as();
    const s = TrainerSessionSchema.parse(
      (
        await me.post('/declension/sessions', {
          mode: 'lesson',
          lessonId: 'loc-sg',
          size: 10,
          seed: 1,
        })
      ).body,
    );
    expect(s.items).toHaveLength(10);
    expect(s.items.every((i) => mini.exerciseById.get(i.exerciseId)?.lessonId === 'loc-sg')).toBe(
      true,
    );
    const cur = TrainerSessionSchema.parse(
      (await me.post('/declension/sessions', { mode: 'lesson', size: 50, seed: 1 })).body,
    );
    expect(cur.items.every((i) => mini.exerciseById.get(i.exerciseId)?.lessonId === 'acc-sg')).toBe(
      true,
    );
    expect(
      (await me.post('/declension/sessions', { mode: 'lesson', lessonId: 'nope', size: 5 })).status,
    ).toBe(404);
  });

  it('weak mode follows the history: most items from the weakest buckets, 30% from strong ones', async () => {
    const me = t.as();
    const userId = me.id as string;
    await me.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      score: { correct: 8, total: 8 },
    });
    // acc.sg.f and acc.sg.m_anim strong; loc.sg.f and loc.sg.n weak; the rest unseen.
    const run = async (
      bucket: { case: 'acc' | 'loc'; gender: 'f' | 'm_anim' | 'n' },
      correct: boolean,
    ) =>
      t.db.withUser(userId, (tx) =>
        t.ports.attempts.record(
          tx,
          Array.from({ length: 8 }, (_, i) => ({
            id: uuidv7(),
            source: 'trainer' as const,
            case: bucket.case,
            number: 'sg' as const,
            gender: bucket.gender,
            correct,
            occurredAt: new Date(Date.parse('2026-11-16T08:00:00Z') + i * 1000).toISOString(),
          })),
        ),
      );
    await run({ case: 'acc', gender: 'f' }, true);
    await run({ case: 'acc', gender: 'm_anim' }, true);
    await run({ case: 'loc', gender: 'f' }, false);
    await run({ case: 'loc', gender: 'n' }, false);

    for (const seed of [1, 2, 3, 4, 5]) {
      const s = TrainerSessionSchema.parse(
        (await me.post('/declension/sessions', { mode: 'weak', size: 10, seed })).body,
      );
      const keys = s.items.map((i) => `${i.features.case}.${i.features.gender}`);
      const strong = keys.filter((k) => k === 'acc.f' || k === 'acc.m_anim').length;
      const weakest = keys.filter((k) => k === 'loc.f' || k === 'loc.n').length;
      expect(s.items).toHaveLength(10);
      expect(strong).toBeGreaterThanOrEqual(3);
      expect(weakest).toBeGreaterThan(strong);
      expect(weakest).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('attempts', () => {
  it('diagnoses again on the server, stores features and error type, and is safe to repeat', async () => {
    const me = t.as();
    const userId = me.id as string;
    const sessionId = uuidv7();
    const batch = [
      // The client claims a right answer; the server knows better.
      input('ex-7b21c0d4e9', 'meste', { sessionId, correct: true, clientDiagnosis: 'correct' }),
      input('ex-7b21c0d4e9', 'mesta', { sessionId, retry: true }),
    ];
    const first = await submit(me, batch);
    expect(first).toMatchObject({ accepted: 2, cardsCreated: 1 });
    expect(first.mastery).toEqual([
      {
        case: 'gen',
        number: 'sg',
        gender: 'n',
        attempts: 2,
        mastery: masteryOf([
          { correct: true, retry: true },
          { correct: false, retry: false },
        ]),
        level: 'unseen',
      },
    ]);

    const rows = await attemptsOf(userId);
    expect(rows).toHaveLength(2);
    const wrong = rows.find((r) => r.given === 'meste');
    expect(wrong).toMatchObject({
      source: 'trainer',
      sourceRef: sessionId,
      exerciseId: 'ex-7b21c0d4e9',
      lemmaId: 20,
      gCase: 'gen',
      gNumber: 'sg',
      gGender: 'n',
      pattern: 'mesto',
      triggerId: 'prep-do',
      correct: false,
      retry: false,
      diagnosis: 'other_case',
      errorType: 'case_after_preposition',
      expected: 'mesta',
      givenCase: 'loc',
      durationMs: 3000,
    });
    expect(rows.find((r) => r.given === 'mesta')).toMatchObject({
      correct: true,
      retry: true,
      diagnosis: 'correct',
      errorType: null,
    });

    const again = await submit(me, batch);
    expect(again).toMatchObject({ accepted: 2, cardsCreated: 0 });
    expect(await attemptsOf(userId)).toHaveLength(2);
    expect(await notesOf(userId)).toHaveLength(1);
  });

  it('gives the stated diagnoses for zenam and z ulicy', async () => {
    const base = {
      kind: 'cloze',
      sentenceEn: '',
      lessonId: null,
      difficulty: 0.5,
      source: 'authored',
      verified: true,
    } as const;
    await t.db.db
      .insert(exercise)
      .values([
        {
          ...base,
          id: 'ex-00000000a1',
          sentenceSk: 'Pomáham ženám.',
          target: { start: 8, end: 13, lemmaIds: [11], cue: 'žena', answers: ['ženám'] },
          gCase: 'dat',
          gNumber: 'pl',
          gGender: 'f',
          pattern: 'zena',
          triggerId: 'verb-pomahat',
        },
        {
          ...base,
          id: 'ex-00000000a2',
          sentenceSk: 'Idem z ulice.',
          target: { start: 7, end: 12, lemmaIds: [14], cue: 'ulica', answers: ['ulice'] },
          gCase: 'gen',
          gNumber: 'sg',
          gGender: 'f',
          pattern: 'ulica',
          triggerId: 'prep-z',
        },
      ])
      .onConflictDoNothing();
    const me = t.as();
    await submit(me, [input('ex-00000000a1', 'zenam'), input('ex-00000000a2', 'ulicy')]);
    const rows = await attemptsOf(me.id as string);
    expect(rows.find((r) => r.given === 'zenam')).toMatchObject({
      diagnosis: 'diacritics',
      errorType: 'spelling',
      correct: false,
    });
    expect(rows.find((r) => r.given === 'ulicy')).toMatchObject({
      diagnosis: 'wrong_pattern',
      errorType: 'pattern_ending',
      correct: false,
    });
  });

  it(`turns at most ${DAILY_TRAINER_CARDS} wrong trainer items a day into cards`, async () => {
    const me = t.as();
    const userId = me.id as string;
    const seven = LOC_CLOZE.slice(0, 7).map((id) => input(id, 'xyz'));
    const res = await submit(me, seven);
    expect(res.cardsCreated).toBe(DAILY_TRAINER_CARDS);
    const more = await submit(
      me,
      LOC_CLOZE.slice(7, 9).map((id) => input(id, 'xyz')),
    );
    expect(more.cardsCreated).toBe(0);
    // Lesson attempts never count toward it and become no card here.
    const lesson = await submit(me, [input(LOC_CLOZE[10] as string, 'xyz', { source: 'lesson' })]);
    expect(lesson.cardsCreated).toBe(0);
    expect(await notesOf(userId)).toHaveLength(DAILY_TRAINER_CARDS);

    t.clock.advance(24 * 3600_000);
    try {
      const next = await submit(
        me,
        LOC_CLOZE.slice(0, 7).map((id) => input(id, 'xyz')),
      );
      // The first five already have notes; two are new.
      expect(next.cardsCreated).toBe(2);
    } finally {
      t.clock.advance(-24 * 3600_000);
    }
  });

  it('refuses unknown exercises and moves a future time to now', async () => {
    const me = t.as();
    const bad = await me.post('/declension/attempts', { attempts: [input('ex-ffffffffff', 'x')] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fields)).toEqual(['body.attempts.0.exerciseId']);
    await submit(me, [input('ex-7b21c0d4e9', 'mesta', { occurredAt: '2030-01-01T00:00:00.000Z' })]);
    const [row] = await attemptsOf(me.id as string);
    expect(row?.occurredAt.toISOString()).toBe(t.clock.now().toISOString());
  });
});

describe('AttemptsPort mastery', () => {
  it('reproduces hand computed values, retries included, over the newest 30 attempts', async () => {
    const userId = (await t.db.factory.profile()).userId;
    const at = (i: number) =>
      new Date(Date.parse('2026-11-10T08:00:00Z') + i * 60_000).toISOString();
    // Oldest to newest: 5 wrong (outside the window once 30 newer exist), then 26 right,
    // then a wrong, a correct retry, a right, a wrong retry.
    const seq: { correct: boolean; retry: boolean }[] = [
      ...Array.from({ length: 5 }, () => ({ correct: false, retry: false })),
      ...Array.from({ length: 26 }, () => ({ correct: true, retry: false })),
      { correct: false, retry: false },
      { correct: true, retry: true },
      { correct: true, retry: false },
      { correct: false, retry: true },
    ];
    await t.db.withUser(userId, (tx) =>
      t.ports.attempts.record(
        tx,
        seq.map((s, i) => ({
          id: uuidv7(),
          source: 'review' as const,
          case: 'ins',
          number: 'pl',
          gender: 'f',
          correct: s.correct,
          retry: s.retry,
          occurredAt: at(i),
        })),
      ),
    );
    const list = await t.db.withUser(userId, (tx) => t.ports.attempts.getMastery(tx));
    const m = list.find((x) => x.case === 'ins' && x.number === 'pl' && x.gender === 'f');
    // Newest first: wrong retry 0, right 1, correct retry 0.5, wrong 0, then 26 right (i = 4..29).
    let num = 0.9 * 1 + 0.81 * 0.5;
    let den = 0;
    for (let i = 0; i < 30; i++) den += 0.9 ** i;
    for (let i = 4; i < 30; i++) num += 0.9 ** i;
    expect(m?.attempts).toBe(35);
    expect(m?.mastery).toBeCloseTo(num / den, 10);
    expect(m?.level).toBe('ok');
    expect(num / den).toBeGreaterThan(0.6);
    expect(num / den).toBeLessThan(0.85);
  });

  it('calls a bucket with fewer than 5 attempts unseen, even when all are right', async () => {
    const userId = (await t.db.factory.profile()).userId;
    await t.db.withUser(userId, (tx) =>
      t.ports.attempts.record(
        tx,
        Array.from({ length: 4 }, () => ({
          id: uuidv7(),
          source: 'tutor' as const,
          case: 'dat',
          number: 'sg',
          gender: 'm_anim',
          correct: true,
          occurredAt: '2026-11-16T08:00:00.000Z',
        })),
      ),
    );
    const [m] = await t.db.withUser(userId, (tx) => t.ports.attempts.getMastery(tx));
    expect(m).toEqual({
      case: 'dat',
      number: 'sg',
      gender: 'm_anim',
      attempts: 4,
      mastery: 1,
      level: 'unseen',
    });
  });
});

describe('isolation', () => {
  it("never shows learner A's progress, attempts or mastery to learner B", async () => {
    const a = t.as();
    const b = t.as();
    const mine = input('ex-7b21c0d4e9', 'meste');
    await submit(a, [mine]);
    await a.put('/declension/lessons/acc-sg/progress', {
      stepIndex: 4,
      score: { correct: 8, total: 8 },
    });

    const course = CourseSchema.parse((await b.get('/declension/course')).body);
    expect(course.lessons[0]?.status).toBe('available');
    expect(course.lessons[0]?.score).toBeNull();
    expect(course.mastery.every((m) => m.attempts === 0)).toBe(true);
    expect(
      LessonDetailSchema.parse((await b.get('/declension/lessons/acc-sg')).body).progress,
    ).toBeNull();

    // B sends A's attempt id: accepted as a repeat, but A's row stays A's and B gets nothing.
    const res = await submit(b, [{ ...mine, typed: 'mesta' }]);
    expect(res.accepted).toBe(1);
    expect(res.mastery).toEqual([]);
    expect(await attemptsOf(b.id as string)).toHaveLength(0);
    const [row] = await attemptsOf(a.id as string);
    expect(row).toMatchObject({ id: mine.id, given: 'meste' });
    // Nothing of A is reachable through a row id: the module's paths name lessons and patterns.
    expect((await b.get(`/declension/lessons/${mine.id}`)).status).toBe(404);
  });
});
