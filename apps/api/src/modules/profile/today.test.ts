// B7: GET /today and GET /stats/summary against hand built expectations.

import { StatsSummarySchema, TodaySchema } from '@app/contracts';
import { createTestDb, MESTO_WORD_CONTENT, type TestDb, uuidv7 } from '@app/testkit';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AttemptRecord } from '../../ports';
import { createTestApp, type TestApp } from '../../testing/app';
import { lastDays, pickNextLesson, pickTutorScenario, weakBuckets } from './service';

let db: TestDb;
let t: TestApp;

const NOW = '2026-11-17T08:30:00.000Z';

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  t = await createTestApp({ db, now: NOW });
});
afterAll(async () => {
  await t.close();
  await db.close();
});
beforeEach(() => {
  t.clock.set(NOW);
});

const at = (s: string) => new Date(s);

/** Attempts through AttemptsPort (the recorder now, B5's port later), as the learner. */
async function recordAttempts(userId: string, list: Omit<AttemptRecord, 'id'>[]): Promise<void> {
  await t.deps.database.withUser(userId, (tx) =>
    t.ports.attempts.record(
      tx,
      list.map((a) => ({ ...a, id: uuidv7() })),
    ),
  );
}

function attempts(
  n: number,
  bucket: Pick<AttemptRecord, 'case' | 'number' | 'gender'>,
  correct: boolean,
): Omit<AttemptRecord, 'id'>[] {
  return Array.from({ length: n }, (_, i) => ({
    source: 'trainer' as const,
    ...bucket,
    correct,
    occurredAt: new Date(Date.parse('2026-11-15T10:00:00Z') + i * 60_000).toISOString(),
  }));
}

/** A card of a new phrase note. */
async function cardOf(userId: string, over: Parameters<TestDb['factory']['card']>[0] = {}) {
  return db.factory.card({ userId, ...over });
}

describe('GET /today', () => {
  it('a fresh account gets the first run state', async () => {
    const me = t.as();
    const res = await me.get('/today');
    expect(res.status).toBe(200);
    expect(TodaySchema.parse(res.body)).toEqual({
      date: '2026-11-17',
      review: { due: 0, new: 0, learning: 0 },
      continueText: null,
      nextLesson: {
        id: 'acc-sg',
        titleEn: 'Accusative singular',
        titleSk: 'Akuzatív jednotného čísla',
        status: 'available',
      },
      weakBuckets: [],
      tutorSuggestion: null,
      words: { band: 0, fromRank: 1, toRank: 1000, total: 72, known: 0, learning: 0, target: 1000 },
    });
  });

  it('a learner without placement keeps the first run state even with weak buckets', async () => {
    const id = uuidv7();
    await db.factory.profile({ userId: id });
    await recordAttempts(id, attempts(8, { case: 'loc', number: 'sg', gender: 'f' }, false));
    const res = await t.as(id).get('/today');
    expect(res.body.weakBuckets).toEqual([]);
    expect(res.body.tutorSuggestion).toBeNull();
  });

  it('a seeded learner in the middle of the course', async () => {
    const id = uuidv7();
    await db.factory.profile({
      userId: id,
      timezone: 'America/New_York',
      placementDoneAt: at('2026-11-01T12:00:00Z'),
      currentLessonId: 'loc-sg',
      wordsBandTarget: 2000,
    });
    // Course: acc-sg done, loc-sg in progress (the current lesson).
    await db.factory.lessonProgress({ userId: id, lessonId: 'acc-sg', status: 'completed' });
    await db.factory.lessonProgress({ userId: id, lessonId: 'loc-sg', status: 'in_progress' });
    // Words of band 0: three known, two learning, one ignored.
    for (const lemmaId of [1, 2, 3])
      await db.factory.userLemma({ userId: id, lemmaId, status: 'known', source: 'placement' });
    for (const lemmaId of [4, 20])
      await db.factory.userLemma({ userId: id, lemmaId, status: 'learning', source: 'reader' });
    await db.factory.userLemma({ userId: id, lemmaId: 5, status: 'ignored', source: 'triage' });
    // Cards: 2 new, 1 learning due, 3 reviews due.
    await cardOf(id);
    await cardOf(id);
    await cardOf(id, { state: 'learning', dueAt: at('2026-11-17T08:20:00Z') });
    for (let i = 0; i < 3; i++)
      await cardOf(id, { state: 'review', dueAt: at('2026-11-16T00:00:00Z') });
    // Texts: the one opened last continues; an archived and a failed one never do.
    const text = await db.factory.text({
      userId: id,
      title: 'V Bratislave',
      status: 'ready',
      coverage: 0.86,
      progress: { sentence: 1 },
      lastOpenedAt: at('2026-11-16T20:00:00Z'),
    });
    await db.factory.text({
      userId: id,
      status: 'ready',
      lastOpenedAt: at('2026-11-15T20:00:00Z'),
    });
    await db.factory.text({
      userId: id,
      status: 'ready',
      archived: true,
      lastOpenedAt: at('2026-11-17T08:00:00Z'),
    });
    await db.factory.text({
      userId: id,
      status: 'failed',
      lastOpenedAt: at('2026-11-17T08:00:00Z'),
    });
    // Mastery: loc.sg.f weakest (8 wrong), gen.sg.n weak (6 wrong), acc.sg.f strong.
    await recordAttempts(id, [
      ...attempts(8, { case: 'loc', number: 'sg', gender: 'f' }, false),
      ...attempts(6, { case: 'gen', number: 'sg', gender: 'n' }, false),
      ...attempts(10, { case: 'acc', number: 'sg', gender: 'f' }, true),
    ]);

    const res = await t.as(id).get('/today');
    expect(res.status).toBe(200);
    expect(TodaySchema.parse(res.body)).toEqual({
      // 08:30Z is 03:30 in New York, before the 04:00 day start: still the 16th.
      date: '2026-11-16',
      review: { due: 3, new: 2, learning: 1 },
      continueText: {
        id: text.id,
        title: 'V Bratislave',
        coverage: 0.86,
        progress: { sentence: 1 },
      },
      nextLesson: {
        id: 'loc-sg',
        titleEn: 'Locative singular',
        titleSk: 'Lokál jednotného čísla',
        status: 'in_progress',
      },
      weakBuckets: [
        { case: 'loc', number: 'sg', gender: 'f', attempts: 8, mastery: 0, level: 'weak' },
        { case: 'gen', number: 'sg', gender: 'n', attempts: 6, mastery: 0, level: 'weak' },
      ],
      tutorSuggestion: {
        scenarioId: 'scn-coach-loc',
        mode: 'case_coach',
        titleEn: 'Where are you?',
        titleSk: 'Kde si?',
      },
      words: { band: 0, fromRank: 1, toRank: 1000, total: 72, known: 3, learning: 2, target: 2000 },
    });
  });

  it('everything done: no lesson left, counts at zero, the least used scenario', async () => {
    const id = uuidv7();
    await db.factory.profile({ userId: id, placementDoneAt: at('2026-11-01T12:00:00Z') });
    for (const lessonId of [
      'acc-sg',
      'loc-sg',
      'gen-sg',
      'ins-sg',
      'dat-pron',
      'nom-acc-pl',
      'loc-ins-dat-pl',
      'gen-pl',
      'mixed',
    ])
      await db.factory.lessonProgress({ userId: id, lessonId, status: 'tested_out' });
    await db.factory.conversation({ userId: id, scenarioId: 'scn-city-walk', status: 'completed' });
    const res = await t.as(id).get('/today');
    expect(res.body).toMatchObject({
      review: { due: 0, new: 0, learning: 0 },
      nextLesson: null,
      weakBuckets: [],
      tutorSuggestion: { scenarioId: 'scn-coach-loc' },
    });
  });

  describe('review counts follow the learner day and the caps', () => {
    /**
     * New York learner, caps 2 new and 3 reviews. At 2026-11-17T08:30Z (03:30 New York) the
     * learner day runs from 2026-11-16T09:00Z to 2026-11-17T09:00Z.
     */
    async function seed(timezone: string): Promise<string> {
      const id = uuidv7();
      await db.factory.profile({
        userId: id,
        timezone,
        dailyNewLimit: 2,
        dailyReviewLimit: 3,
        placementDoneAt: at('2026-11-01T12:00:00Z'),
      });
      for (let i = 0; i < 4; i++) await cardOf(id); // new
      // Learning: one due, one due later. L1 was first reviewed on 2026-11-16 12:00Z.
      const l1 = await cardOf(id, { state: 'learning', dueAt: at('2026-11-17T08:00:00Z') });
      await db.factory.review({
        userId: id,
        cardId: l1.id,
        answeredAt: at('2026-11-16T12:00:00Z'),
      });
      await cardOf(id, { state: 'relearning', dueAt: at('2026-11-17T08:45:00Z') });
      // Reviews due: four. R1 was reviewed today (New York), R2 the evening before.
      const r1 = await cardOf(id, { state: 'review', dueAt: at('2026-11-17T00:00:00Z') });
      await db.factory.review({
        userId: id,
        cardId: r1.id,
        answeredAt: at('2026-11-01T10:00:00Z'),
      });
      await db.factory.review({
        userId: id,
        cardId: r1.id,
        answeredAt: at('2026-11-16T15:00:00Z'),
      });
      const r2 = await cardOf(id, { state: 'review', dueAt: at('2026-11-17T00:00:00Z') });
      await db.factory.review({
        userId: id,
        cardId: r2.id,
        answeredAt: at('2026-11-01T10:00:00Z'),
      });
      await db.factory.review({
        userId: id,
        cardId: r2.id,
        answeredAt: at('2026-11-16T08:00:00Z'),
      });
      await cardOf(id, { state: 'review', dueAt: at('2026-11-15T00:00:00Z') });
      await cardOf(id, { state: 'review', dueAt: at('2026-11-17T08:30:00Z') });
      // Not due yet, suspended, or of a suspended or deleted note: never counted.
      await cardOf(id, { state: 'review', dueAt: at('2026-11-18T00:00:00Z') });
      await cardOf(id, { state: 'review', dueAt: at('2026-11-10T00:00:00Z'), suspended: true });
      const suspended = await db.factory.note({ userId: id, suspended: true });
      await cardOf(id, {
        noteId: suspended.id,
        state: 'review',
        dueAt: at('2026-11-10T00:00:00Z'),
      });
      const deleted = await db.factory.note({
        userId: id,
        content: MESTO_WORD_CONTENT,
        deletedAt: at('2026-11-12T00:00:00Z'),
      });
      await cardOf(id, { noteId: deleted.id });
      return id;
    }

    it('New York: one new card and one review already done today', async () => {
      const id = await seed('America/New_York');
      const res = await t.as(id).get('/today');
      expect(res.body.date).toBe('2026-11-16');
      expect(res.body.review).toEqual({ due: 2, new: 1, learning: 1 });
    });

    it('the same rows in UTC: the reviews of the 16th belong to yesterday', async () => {
      const id = await seed('UTC');
      const res = await t.as(id).get('/today');
      expect(res.body.date).toBe('2026-11-17');
      expect(res.body.review).toEqual({ due: 3, new: 2, learning: 1 });
    });

    it('New York after its day boundary: the caps start again', async () => {
      const id = await seed('America/New_York');
      t.clock.set('2026-11-17T09:30:00.000Z');
      const res = await t.as(id).get('/today');
      expect(res.body.date).toBe('2026-11-17');
      // The relearning card became due at 08:45Z.
      expect(res.body.review).toEqual({ due: 3, new: 2, learning: 2 });
    });

    it('agree with GET /review/queue for the same moment and time zone', async () => {
      const id = await seed('America/New_York');
      const me = t.as(id);
      const queue = await me.get('/review/queue?limit=200');
      expect(queue.status).toBe(200);
      const today = await me.get('/today');
      expect(today.body.review).toEqual(queue.body.counts);
    });
  });
});

describe('GET /stats/summary', () => {
  it('a fresh account', async () => {
    const res = await t.as().get('/stats/summary');
    expect(res.status).toBe(200);
    const s = StatsSummarySchema.parse(res.body);
    expect(s.reviewsPerDay.map((d) => d.date)).toEqual([
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
      '2026-11-16',
      '2026-11-17',
    ]);
    expect(s.reviewsPerDay.every((d) => d.reviews === 0 && d.correct === 0)).toBe(true);
    expect(s).toMatchObject({ retention30d: null, words: { known: 0, learning: 0 }, mastery: [] });
  });

  it('reviews per learner day, retention of mature cards, words and mastery', async () => {
    const id = uuidv7();
    await db.factory.profile({ userId: id, timezone: 'Europe/Bratislava' });
    const c1 = await cardOf(id, { state: 'review' });
    const c2 = await cardOf(id, { state: 'review' });
    const r = (cardId: string, answeredAt: string, rating: number) =>
      db.factory.review({ userId: id, cardId, answeredAt: at(answeredAt), rating });
    // Bratislava (UTC+1), day start 04:00 = 03:00Z.
    await r(c1.id, '2026-09-01T10:00:00Z', 3); // too old for the chart
    await r(c1.id, '2026-11-11T03:30:00Z', 3); // 11th, mature (71 days), passed
    await r(c2.id, '2026-11-11T02:30:00Z', 1); // still the 10th: not in the chart
    await r(c2.id, '2026-11-14T12:00:00Z', 2); // 14th, 3.4 days after: not mature
    await r(c2.id, '2026-11-17T02:00:00Z', 1); // still the 16th
    await r(c1.id, '2026-12-02T00:00:00Z', 1); // in the future of the clock: ignored
    const c3 = await cardOf(id, { state: 'review' });
    await r(c3.id, '2026-10-01T10:00:00Z', 3);
    await r(c3.id, '2026-11-17T08:00:00Z', 1); // 17th, mature (47 days), failed
    await db.factory.userLemma({ userId: id, lemmaId: 1, status: 'known' });
    await db.factory.userLemma({ userId: id, lemmaId: 2, status: 'known' });
    await db.factory.userLemma({ userId: id, lemmaId: 3, status: 'learning' });
    await db.factory.userLemma({ userId: id, lemmaId: 4, status: 'ignored' });
    await recordAttempts(id, attempts(10, { case: 'acc', number: 'sg', gender: 'f' }, true));

    const res = await t.as(id).get('/stats/summary');
    const s = StatsSummarySchema.parse(res.body);
    expect(s.reviewsPerDay).toEqual([
      { date: '2026-11-11', reviews: 1, correct: 1 },
      { date: '2026-11-12', reviews: 0, correct: 0 },
      { date: '2026-11-13', reviews: 0, correct: 0 },
      { date: '2026-11-14', reviews: 1, correct: 1 },
      { date: '2026-11-15', reviews: 0, correct: 0 },
      { date: '2026-11-16', reviews: 1, correct: 0 },
      { date: '2026-11-17', reviews: 1, correct: 0 },
    ]);
    expect(s.retention30d).toBe(0.5);
    expect(s.words).toEqual({ known: 2, learning: 1 });
    expect(s.mastery).toEqual([
      expect.objectContaining({ case: 'acc', number: 'sg', gender: 'f', attempts: 10 }),
    ]);
  });
});

describe('pure helpers', () => {
  it('lastDays spans a change of summer time with seven distinct days', () => {
    const days = lastDays(new Date('2026-11-03T12:00:00Z'), {
      timezone: 'America/New_York',
      dayStartHour: 4,
    });
    expect(days.map((d) => d.date)).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
    // Summer time ends at 02:00 on 1 November, so the learner day that starts at 04:00 on
    // 31 October is 25 hours long.
    const oct31 = days[3];
    expect(oct31 && oct31.end.getTime() - oct31.start.getTime()).toBe(25 * 3_600_000);
  });

  it('weakBuckets keeps weak ones, weakest first, at most three', () => {
    const b = (c: 'acc' | 'gen' | 'loc' | 'dat', mastery: number, level: 'weak' | 'ok') => ({
      case: c,
      number: 'sg' as const,
      gender: 'f' as const,
      attempts: 10,
      mastery,
      level,
    });
    expect(
      weakBuckets([
        b('acc', 0.5, 'weak'),
        b('gen', 0.7, 'ok'),
        b('loc', 0.2, 'weak'),
        b('dat', 0.4, 'weak'),
        b('gen', 0.1, 'weak'),
      ]).map((x) => x.case),
    ).toEqual(['gen', 'loc', 'dat']);
  });

  it('pickNextLesson skips a finished current lesson', () => {
    const l = (id: string, ord: number, status: string | null) => ({
      id,
      ord,
      titleEn: id,
      titleSk: id,
      status,
    });
    const lessons = [l('a', 1, 'completed'), l('b', 2, null), l('c', 3, 'in_progress')];
    expect(pickNextLesson(lessons, 'c')?.id).toBe('c');
    expect(pickNextLesson(lessons, 'a')?.id).toBe('b');
    expect(pickNextLesson(lessons, null)).toMatchObject({ id: 'b', status: 'available' });
  });

  it('pickTutorScenario prefers a case coach for the weakest case', () => {
    const s = (id: string, mode: string, targetCases: string[], ord: number, timesDone = 0) => ({
      id,
      mode,
      titleEn: id,
      titleSk: id,
      targetCases,
      ord,
      timesDone,
    });
    const list = [
      s('walk', 'scenario', ['gen', 'loc'], 1),
      s('coach-loc', 'case_coach', ['loc'], 2, 5),
      s('coach-ins', 'case_coach', ['ins'], 3),
    ];
    expect(pickTutorScenario(list, 'loc')?.scenarioId).toBe('coach-loc');
    expect(pickTutorScenario(list, 'gen')?.scenarioId).toBe('walk');
    expect(pickTutorScenario(list, 'dat')?.scenarioId).toBe('walk');
    expect(pickTutorScenario([], 'dat')).toBeNull();
  });
});
