// The placement check end to end: three simulated learners, safe repeats, applying a result
// twice, and isolation. One test database for the file: the mini dataset (ranks 1 to 72, the
// whole course and its exercises) plus generated lemmas ranked 73 to 3000
// (testing/lemmas.ts), so all six strata of 500 ranks hold words.
//
// The simulated learners read the key of each item from `app.placement.items` as the table
// owner (the API never sends it): a vocabulary item is answered right when the learner
// "knows" its rank, a case item when the learner knows the cases.
import {
  PlacementAnswersResultSchema,
  type PlacementResult,
  PlacementRunSchema,
} from '@app/contracts';
import { lessonProgress, placement, profile, queryRows, userLemma } from '@app/db';
import { createTestDb, type TestDb, uuidv7 } from '@app/testkit';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import type { AttemptsRecorder } from '../../testing/recorders';
import {
  CASE_ROUND,
  isCase,
  isVocab,
  STRATUM_SIZE,
  type StoredItem,
  stratumOf,
  VOCAB_ROUND_SIZE,
} from './items';
import * as service from './service';
import { createDbNotes, type DbNotes } from './testing/db-notes';
import { addRankedLemmas } from './testing/lemmas';

let db: TestDb;
let t: TestApp;
let notes: DbNotes;
let attempts: AttemptsRecorder;
let rankedTotal: number;

beforeAll(async () => {
  db = await createTestDb({ content: 'mini' });
  await addRankedLemmas(db, 73, 3000);
  notes = createDbNotes();
  t = await createTestApp({ db, ports: { notes } });
  attempts = t.ports.attempts as AttemptsRecorder;
  const [row] = await queryRows<{ n: number }>(
    db.db,
    sql`select count(*)::int as n from ling.lemma where freq_rank <= 3000`,
  );
  rankedTotal = Number(row?.n);
});

afterAll(async () => {
  await t?.close();
  await db?.close();
});

async function stored(id: string): Promise<StoredItem[]> {
  const [row] = await db.db.select().from(placement).where(eq(placement.id, id));
  return (row?.items ?? []) as StoredItem[];
}

interface Learner {
  knowsUpToRank: number;
  /** right: the first accepted answer; wrong: a wrong word; skip: no answer at all. */
  cases: 'right' | 'wrong' | 'skip';
}

type Answer = { itemId: string; choice?: number; typed?: string };

function answersFor(items: StoredItem[], round: number, who: Learner): Answer[] {
  return items
    .filter((i) => i.round === round)
    .flatMap((i): Answer[] => {
      if (isVocab(i))
        return [
          {
            itemId: i.item.itemId,
            choice: i.rank <= who.knowsUpToRank ? i.correctIndex : i.item.options.length - 1,
          },
        ];
      if (!isCase(i) || who.cases === 'skip') return [{ itemId: i.item.itemId }];
      return [{ itemId: i.item.itemId, typed: who.cases === 'right' ? i.answers[0] : 'xyz' }];
    });
}

/** Runs a whole check; returns the run id, the result and every response. */
async function simulate(client: TestClient, who: Learner) {
  const id = uuidv7();
  const start = await client.call('placement.start', { body: { id } });
  expect(start.status).toBe(200);
  const responses: unknown[] = [PlacementRunSchema.parse(start.body)];
  let round = start.body.round.round as number;
  let result: PlacementResult | undefined;
  for (let guard = 0; guard < 10 && !result; guard++) {
    const answers = answersFor(await stored(id), round, who);
    const res = await client.call('placement.answer', {
      params: { id },
      body: { round, answers },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = PlacementAnswersResultSchema.parse(res.body);
    responses.push(body);
    if (body.result) result = body.result;
    else round = body.round?.round as number;
  }
  if (!result) throw new Error('no result');
  return { id, result, responses };
}

async function snapshot(userId: string) {
  const statuses = await db.db
    .select()
    .from(userLemma)
    .where(eq(userLemma.userId, userId))
    .orderBy(userLemma.lemmaId);
  const lessons = await db.db
    .select()
    .from(lessonProgress)
    .where(eq(lessonProgress.userId, userId))
    .orderBy(lessonProgress.lessonId);
  const [prof] = await db.db.select().from(profile).where(eq(profile.userId, userId));
  return {
    statuses,
    lessons,
    profile: prof,
    attempts: attempts.attempts.filter((a) => a.userId === userId).length,
  };
}

const TEACHING = [
  'acc-sg',
  'loc-sg',
  'gen-sg',
  'ins-sg',
  'dat-pron',
  'nom-acc-pl',
  'loc-ins-dat-pl',
  'gen-pl',
];

describe('three simulated learners', () => {
  it('one who knows the first 1,000 words', async () => {
    const a = t.as();
    const { id, result } = await simulate(a, { knowsUpToRank: 1000, cases: 'wrong' });
    expect(result).toMatchObject({
      knownUpToRank: 1000,
      lessonsTestedOut: [],
      startLessonId: 'acc-sg',
    });
    expect(result.buckets.map((b) => [b.lessonId, b.correct, b.total])).toEqual(
      TEACHING.map((l) => [l, 0, 2]),
    );

    // Rounds: 12 words each; round 1 two per stratum, rounds 2 and 3 around stratum 3.
    const items = await stored(id);
    const vocab = items.filter(isVocab);
    for (const r of [1, 2, 3]) expect(vocab.filter((i) => i.round === r)).toHaveLength(12);
    expect(vocab.filter((i) => i.round === 1).map((i) => stratumOf(i.rank))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ]);
    for (const i of vocab.filter((v) => v.round > 1)) expect(i.rank).toBeGreaterThan(STRATUM_SIZE);
    expect(items.filter(isCase)).toHaveLength(16);
    expect(new Set(vocab.map((i) => i.item.lemmaId)).size).toBe(3 * VOCAB_ROUND_SIZE);

    // Applied: every word up to rank 1000 known, no lesson tested out, start lesson set.
    const s = await snapshot(a.id as string);
    expect(s.statuses).toHaveLength(1000);
    expect(s.statuses.every((r) => r.status === 'known' && r.source === 'placement')).toBe(true);
    expect(s.lessons).toEqual([]);
    expect(s.profile?.currentLessonId).toBe('acc-sg');
    expect(s.profile?.placementDoneAt?.toISOString()).toBe(t.clock.now().toISOString());
    // Each typed case answer is logged as an attempt.
    const logged = attempts.attempts.filter((x) => x.userId === a.id);
    expect(logged).toHaveLength(16);
    expect(logged.every((x) => x.source === 'placement' && x.sourceRef === id && !x.correct)).toBe(
      true,
    );
    expect(logged[0]).toMatchObject({ given: 'xyz', diagnosis: 'not_a_form', errorType: 'other' });
  });

  it('one who knows nothing', async () => {
    const a = t.as();
    const { id, result } = await simulate(a, { knowsUpToRank: 0, cases: 'skip' });
    expect(result).toMatchObject({
      knownUpToRank: 0,
      lessonsTestedOut: [],
      startLessonId: 'acc-sg',
    });
    const vocab = (await stored(id)).filter(isVocab);
    // Rounds 2 and 3 stay in the lowest strata.
    for (const i of vocab.filter((v) => v.round > 1)) expect(i.stratum).toBeLessThanOrEqual(1);
    const s = await snapshot(a.id as string);
    expect(s.statuses).toEqual([]);
    expect(s.lessons).toEqual([]);
    expect(s.attempts).toBe(0); // no typed answer, nothing to log
    expect(s.profile?.currentLessonId).toBe('acc-sg');
    expect(s.profile?.placementDoneAt).not.toBeNull();
  });

  it('one who knows everything', async () => {
    const a = t.as();
    const { result } = await simulate(a, { knowsUpToRank: 3000, cases: 'right' });
    expect(result).toMatchObject({
      knownUpToRank: 3000,
      lessonsTestedOut: TEACHING,
      startLessonId: 'mixed',
    });
    expect(result.buckets.every((b) => b.correct === 2 && b.total === 2)).toBe(true);
    const s = await snapshot(a.id as string);
    expect(s.statuses).toHaveLength(rankedTotal);
    expect(s.lessons.map((l) => [l.lessonId, l.status])).toEqual(
      [...TEACHING].sort().map((l) => [l, 'tested_out']),
    );
    expect(s.profile?.currentLessonId).toBe('mixed');
    const logged = attempts.attempts.filter((x) => x.userId === a.id);
    expect(logged).toHaveLength(16);
    expect(logged.every((x) => x.correct && x.diagnosis === 'correct')).toBe(true);
  });
});

describe('rounds are safe to repeat', () => {
  it('the same answers return the same next round; other answers are refused', async () => {
    const a = t.as();
    const id = uuidv7();
    const first = await a.call('placement.start', { body: { id } });
    const again = await a.call('placement.start', { body: { id } });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);

    const answers = answersFor(await stored(id), 1, { knowsUpToRank: 500, cases: 'right' });
    const r2 = await a.call('placement.answer', { params: { id }, body: { round: 1, answers } });
    const r2again = await a.call('placement.answer', {
      params: { id },
      body: { round: 1, answers: [...answers].reverse() },
    });
    expect(r2.body.round.round).toBe(2);
    expect(r2again.body).toEqual(r2.body);
    expect((await stored(id)).filter((i) => i.round === 2)).toHaveLength(12);

    const changed = answers.map((x, i) => (i === 0 ? { ...x, choice: 4 - (x.choice ?? 0) } : x));
    const refused = await a.call('placement.answer', {
      params: { id },
      body: { round: 1, answers: changed },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('conflict');

    const ahead = await a.call('placement.answer', {
      params: { id },
      body: { round: 3, answers: [{ itemId: 'v3-1' }] },
    });
    expect(ahead.status).toBe(409);
    const get = PlacementRunSchema.parse((await a.call('placement.get', { params: { id } })).body);
    expect(get.round).toEqual(r2.body.round);
  });

  it('refuses items of another round and options that do not exist', async () => {
    const a = t.as();
    const id = uuidv7();
    await a.call('placement.start', { body: { id } });
    const items = (await stored(id)).filter(isVocab);
    const bad = await a.call('placement.answer', {
      params: { id },
      body: {
        round: 1,
        answers: [
          { itemId: 'v9-1', choice: 0 },
          { itemId: items[0]?.item.itemId as string, choice: 99 },
        ],
      },
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details.fields).sort()).toEqual([
      'body.answers.0.itemId',
      'body.answers.1.choice',
    ]);
  });

  it('replaying the last round returns the same result and changes nothing more', async () => {
    const a = t.as();
    const { id, result } = await simulate(a, { knowsUpToRank: 1500, cases: 'right' });
    expect(result.knownUpToRank).toBe(1500);
    const before = await snapshot(a.id as string);
    const statusCalls = notes.statusCalls.length;
    const replay = await a.call('placement.answer', {
      params: { id },
      body: {
        round: CASE_ROUND,
        answers: answersFor(await stored(id), CASE_ROUND, { knowsUpToRank: 0, cases: 'right' }),
      },
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ status: 'completed', result });
    expect(await snapshot(a.id as string)).toEqual(before);
    expect(notes.statusCalls.length).toBe(statusCalls);
    const run = PlacementRunSchema.parse((await a.call('placement.get', { params: { id } })).body);
    expect(run).toEqual({ id, status: 'completed', result });
  });
});

describe('applying a result', () => {
  it('twice changes nothing more', async () => {
    const a = t.as();
    const { id, result } = await simulate(a, { knowsUpToRank: 3000, cases: 'right' });
    const items = await stored(id);
    const [row] = await db.db.select().from(placement).where(eq(placement.id, id));
    const run = { userId: a.id as string, items, result, completedAt: row?.completedAt as Date };
    const before = await snapshot(a.id as string);
    const calls = notes.statusCalls.length;
    for (let i = 0; i < 2; i++)
      await db.withUser(a.id as string, (tx) => service.applyResult(tx, t.ports, run));
    expect(await snapshot(a.id as string)).toEqual(before);
    expect(notes.statusCalls.length).toBe(calls);
  });

  it("keeps the learner's own word statuses and lesson rows", async () => {
    const a = t.as();
    await a.call('words.bands'); // creates the profile
    const userId = a.id as string;
    await db.factory.userLemma({ userId, lemmaId: 5, status: 'learning', source: 'triage' });
    await db.factory.userLemma({ userId, lemmaId: 6, status: 'ignored', source: 'triage' });
    await db.factory.lessonProgress({ userId, lessonId: 'acc-sg', status: 'in_progress' });
    await simulate(a, { knowsUpToRank: 3000, cases: 'right' });
    const s = await snapshot(userId);
    expect(s.statuses.find((r) => r.lemmaId === 5)?.status).toBe('learning');
    expect(s.statuses.find((r) => r.lemmaId === 6)?.status).toBe('ignored');
    expect(s.statuses.filter((r) => r.status === 'known')).toHaveLength(rankedTotal - 2);
    expect(s.lessons.find((l) => l.lessonId === 'acc-sg')?.status).toBe('in_progress');
    expect(s.lessons.filter((l) => l.status === 'tested_out')).toHaveLength(7);
  });

  it('runs in the transaction of the last answer: a failure leaves nothing applied', async () => {
    const a = t.as();
    const id = uuidv7();
    await a.call('placement.start', { body: { id } });
    const who: Learner = { knowsUpToRank: 3000, cases: 'right' };
    for (const round of [1, 2, 3]) {
      const res = await a.call('placement.answer', {
        params: { id },
        body: { round, answers: answersFor(await stored(id), round, who) },
      });
      expect(res.status).toBe(200);
    }
    notes.failAfter(0);
    const res = await a.call('placement.answer', {
      params: { id },
      body: { round: CASE_ROUND, answers: answersFor(await stored(id), CASE_ROUND, who) },
    });
    notes.failAfter(null);
    expect(res.status).toBe(500);
    const s = await snapshot(a.id as string);
    expect(s.statuses).toEqual([]);
    expect(s.lessons).toEqual([]);
    expect(s.profile?.placementDoneAt).toBeNull();
    const run = PlacementRunSchema.parse((await a.call('placement.get', { params: { id } })).body);
    expect(run.status).toBe('active');
    expect(run.round?.round).toBe(CASE_ROUND);
  });
});

describe('isolation', () => {
  it("learner B gets not_found for learner A's run on every endpoint", async () => {
    const a = t.as();
    const b = t.as();
    const id = uuidv7();
    await a.call('placement.start', { body: { id } });
    const get = await b.call('placement.get', { params: { id } });
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe('not_found');
    const ans = await b.call('placement.answer', {
      params: { id },
      body: { round: 1, answers: [{ itemId: 'v1-1', choice: 0 }] },
    });
    expect(ans.status).toBe(404);
    expect(ans.body.error.code).toBe('not_found');
    // Starting a run with A's id cannot create a second row with it, nor show A's run.
    const start = await b.call('placement.start', { body: { id } });
    expect(start.status).toBe(409);
    expect(start.body.error).not.toHaveProperty('details.items');
    const [rows] = await db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(placement)
      .where(and(eq(placement.id, id), eq(placement.userId, b.id as string)));
    expect(rows?.n).toBe(0);
    expect((await a.call('placement.get', { params: { id } })).status).toBe(200);
  });

  it('answers not_found for a run that does not exist', async () => {
    const a = t.as();
    expect((await a.call('placement.get', { params: { id: uuidv7() } })).status).toBe(404);
  });
});
