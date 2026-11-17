// The review endpoints over a test database with the mini dataset and a fixed clock: one card
// walked through its whole life, server grading, repeated batches, daily caps in the
// learner's own day, queue order, attempts, known lemmas, and isolation.
import {
  type CreateNote,
  type ReviewAnswer,
  type ReviewItem,
  ReviewQueueSchema,
  SubmitAnswersResultSchema,
} from '@app/contracts';
import { card, profile, review, userLemma } from '@app/db';
import { uuidv7 } from '@app/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestClient } from '../../testing/app';
import type { AttemptsRecorder } from '../../testing/recorders';
import { BRATA_CASE_SENTENCE, V_MESTE_PHRASE } from '../../testing/suites/notes';

const T0 = '2026-11-17T08:30:00.000Z';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());
beforeEach(() => t.clock.set(T0));

async function note(me: TestClient, body: Partial<CreateNote> & Pick<CreateNote, 'kind'>) {
  const res = await me.post('/notes', { id: uuidv7(), source: 'words', ...body });
  expect(res.status, res.text).toBe(200);
  return res.body as { note: { id: string }; card: { cardId: string } };
}

const word = (me: TestClient, lemmaId: number, source: CreateNote['source'] = 'words') =>
  note(me, { kind: 'word', lemmaId, source } as CreateNote);

async function queue(me: TestClient, limit?: number) {
  const res = await me.get(`/review/queue${limit ? `?limit=${limit}` : ''}`);
  expect(res.status, res.text).toBe(200);
  return ReviewQueueSchema.parse(res.body);
}

function answer(item: Pick<ReviewItem, 'cardId' | 'variant'>, over: Partial<ReviewAnswer> = {}) {
  return {
    id: uuidv7(),
    cardId: item.cardId,
    answeredAt: t.clock.now().toISOString(),
    typed: '',
    variant: item.variant,
    clientGrade: 'correct',
    rating: 3,
    overridden: false,
    durationMs: 3000,
    ...over,
  } satisfies ReviewAnswer;
}

async function submit(me: TestClient, answers: ReviewAnswer[]) {
  const res = await me.post('/review/answers', { clientId: 'test-device', answers });
  expect(res.status, res.text).toBe(200);
  return SubmitAnswersResultSchema.parse(res.body);
}

const correct = (item: ReviewItem, over: Partial<ReviewAnswer> = {}) =>
  answer(item, { typed: item.answers[0] as string, ...over });

const due = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

describe('a card through its whole life (fixed clock)', () => {
  it('new, both learning steps, review and a lapse', async () => {
    const me = t.as();
    await word(me, 20);

    // New.
    let q = await queue(me);
    expect(q.counts).toEqual({ due: 0, new: 1, learning: 0 });
    expect(q.serverTime).toBe(T0);
    let item = q.items[0] as ReviewItem;
    expect(item).toMatchObject({ kind: 'word', state: 'new', dueAt: null, variant: 0 });
    expect(item.formMap.mesta).toEqual(['s2']);
    expect(item.answers).toEqual(['mesta']);
    expect(item.prompt).toMatchObject({ sentenceSk: 'Idem do mesta.', glossEn: 'town, city' });
    expect(item.explain).toMatchObject({ case: 'gen', number: 'sg', patternId: 'mesto' });
    expect(item.scheduler).toMatchObject({ v: 'fsrs7.1', state: 0 });

    // Again: the first learning step, 1 minute.
    let r = await submit(me, [answer(item, { typed: 'mesto', clientGrade: 'wrong', rating: 1 })]);
    expect(r.results[0]).toMatchObject({ grade: 'wrong', rating: 1 });
    expect(r.results[0]?.card).toMatchObject({ state: 'learning', reps: 1 });
    expect(due(r.results[0]?.card.dueAt ?? null)).toBe(Date.parse(T0) + MIN);
    expect((await queue(me)).items).toEqual([]);

    // Good: the second learning step, 10 minutes. The card shows the next sentence of its note.
    t.clock.advance(MIN);
    q = await queue(me);
    expect(q.counts).toEqual({ due: 0, new: 0, learning: 1 });
    item = q.items[0] as ReviewItem;
    expect(item.variant).toBe(1);
    expect(item.prompt.sentenceSk).not.toBe('Idem do mesta.');
    r = await submit(me, [correct(item)]);
    expect(r.results[0]?.card.state).toBe('learning');
    expect(due(r.results[0]?.card.dueAt ?? null)).toBe(t.clock.now().getTime() + 10 * MIN);

    // Graduates to review, a day or more away.
    t.clock.advance(10 * MIN);
    item = (await queue(me)).items[0] as ReviewItem;
    r = await submit(me, [correct(item)]);
    const reviewCard = r.results[0]?.card;
    expect(reviewCard?.state).toBe('review');
    expect(due(reviewCard?.dueAt ?? null) - t.clock.now().getTime()).toBeGreaterThanOrEqual(DAY);
    expect(reviewCard?.lapses).toBe(0);

    // Due again: a wrong answer is a lapse, back in 10 minutes.
    t.clock.set(reviewCard?.dueAt as string);
    q = await queue(me);
    expect(q.counts).toEqual({ due: 1, new: 0, learning: 0 });
    item = q.items[0] as ReviewItem;
    expect(item.state).toBe('review');
    r = await submit(me, [answer(item, { typed: 'mestom', clientGrade: 'wrong', rating: 1 })]);
    expect(r.results[0]).toMatchObject({ grade: 'wrong', rating: 1 });
    expect(r.results[0]?.card).toMatchObject({ state: 'relearning', lapses: 1, reps: 4 });
    expect(due(r.results[0]?.card.dueAt ?? null)).toBe(t.clock.now().getTime() + 10 * MIN);

    t.clock.advance(10 * MIN);
    expect((await queue(me)).counts).toEqual({ due: 0, new: 0, learning: 1 });

    const detail = await me.get(`/notes/${item.noteId}`);
    expect(detail.body.reviews).toHaveLength(4);
    expect(detail.body.card).toMatchObject({ state: 'relearning', lapses: 1 });
  });
});

describe('POST /review/answers', () => {
  it('sending a batch twice changes nothing and returns the same results', async () => {
    const me = t.as();
    await word(me, 20);
    await word(me, 3);
    const items = (await queue(me)).items;
    const batch = items.map((i) => correct(i));
    const first = await submit(me, batch);
    const count = async () =>
      (
        await t.db.db
          .select()
          .from(review)
          .where(eq(review.userId, me.id as string))
      ).length;
    const cards = async () =>
      t.db.db
        .select()
        .from(card)
        .where(eq(card.userId, me.id as string));
    const before = { n: await count(), cards: await cards() };
    t.clock.advance(5 * MIN);
    const second = await submit(me, batch);
    expect(second.results).toEqual(first.results);
    expect(await count()).toBe(before.n);
    expect(await cards()).toEqual(before.cards);
    // A repeated id inside one batch counts once.
    const twice = await submit(me, [batch[0] as ReviewAnswer, batch[0] as ReviewAnswer]);
    expect(twice.results).toHaveLength(1);
  });

  it('stores an answer the phone marked correct but the server grades wrong as wrong', async () => {
    const me = t.as();
    await note(me, { kind: 'case_sentence', source: 'declension', content: BRATA_CASE_SENTENCE });
    const item = (await queue(me)).items[0] as ReviewItem;
    expect(item.explain).toEqual({
      case: 'acc',
      number: 'sg',
      triggerLabel: 'vidieť + accusative',
      patternId: 'chlap',
    });
    const a = answer(item, { typed: 'brat', clientGrade: 'correct', rating: 3 });
    const r = await submit(me, [a]);
    expect(r.results[0]).toMatchObject({ grade: 'wrong', rating: 1 });
    expect(r.results[0]?.card.state).toBe('learning');
    const [row] = await t.db.db.select().from(review).where(eq(review.id, a.id));
    expect(row).toMatchObject({
      grade: 'wrong',
      rating: 1,
      overridden: false,
      typed: 'brat',
      expected: 'brata',
      clientId: 'test-device',
    });
    expect(row?.diagnosis).toEqual({ diagnosis: 'other_case', clientGrade: 'correct' });

    // Each case sentence review is an attempt, through AttemptsPort.
    const attempts = (t.ports.attempts as AttemptsRecorder).attempts.filter(
      (x) => x.userId === me.id,
    );
    expect(attempts).toEqual([
      expect.objectContaining({
        id: a.id,
        source: 'review',
        sourceRef: a.id,
        exerciseId: 'ex-140da36a9f',
        lemmaId: 3,
        case: 'acc',
        number: 'sg',
        gender: 'm_anim',
        pattern: 'chlap',
        triggerId: 'verb-vidiet',
        correct: false,
        diagnosis: 'other_case',
        errorType: 'case_after_verb',
        givenCase: 'nom',
        given: 'brat',
        expected: 'brata',
      }),
    ]);
  });

  it('keeps a rating the learner changed, and rates a revealed answer again', async () => {
    const me = t.as();
    await note(me, { kind: 'case_sentence', source: 'declension', content: BRATA_CASE_SENTENCE });
    const item = (await queue(me)).items[0] as ReviewItem;
    const changed = answer(item, {
      typed: 'bratovi',
      clientGrade: 'wrong',
      rating: 3,
      overridden: true,
    });
    const r = await submit(me, [changed]);
    expect(r.results[0]).toMatchObject({ grade: 'wrong', rating: 3 });
    const [row] = await t.db.db.select().from(review).where(eq(review.id, changed.id));
    expect(row).toMatchObject({ grade: 'wrong', rating: 3, overridden: true });

    t.clock.advance(DAY);
    const revealed = answer(item, { typed: '', clientGrade: 'revealed', rating: 3 });
    const r2 = await submit(me, [revealed]);
    expect(r2.results[0]).toMatchObject({ grade: 'revealed', rating: 1 });
  });

  it('grades accents only as close, and sets a future time to now', async () => {
    const me = t.as();
    await word(me, 20);
    const item = (await queue(me)).items[0] as ReviewItem;
    const a = answer(item, {
      typed: 'mestá',
      clientGrade: 'correct',
      answeredAt: new Date(Date.parse(T0) + DAY).toISOString(),
    });
    // mestá is another form of the word: wrong, not close.
    const r = await submit(me, [a]);
    expect(r.results[0]).toMatchObject({ grade: 'wrong', rating: 1 });
    const [row] = await t.db.db.select().from(review).where(eq(review.id, a.id));
    expect(row?.answeredAt.toISOString()).toBe(T0);

    await note(me, { kind: 'case_sentence', source: 'declension', content: BRATA_CASE_SENTENCE });
    const q = await queue(me);
    const brata = q.items.find((i) => i.kind === 'case_sentence') as ReviewItem;
    const close = await submit(me, [answer(brata, { typed: 'Bráta', clientGrade: 'close' })]);
    expect(close.results[0]).toMatchObject({ grade: 'close', rating: 2 });
  });

  it('replays the log when an older answer arrives from a second device', async () => {
    const me = t.as();
    const other = t.as();
    await word(me, 20);
    await word(other, 20);
    const item = (await queue(me)).items[0] as ReviewItem;
    const item2 = (await queue(other)).items[0] as ReviewItem;
    const early = correct(item, { answeredAt: T0 });
    const later = correct(item, { answeredAt: new Date(Date.parse(T0) + 2 * MIN).toISOString() });
    t.clock.advance(5 * MIN);
    // Device B sends the later answer first; device A's older answer follows.
    await submit(me, [later]);
    const out = await submit(me, [early]);

    const inOrder = await submit(other, [
      { ...early, id: uuidv7(), cardId: item2.cardId },
      { ...later, id: uuidv7(), cardId: item2.cardId },
    ]);
    const strip = ({ cardId: _, ...rest }: { cardId: string }) => rest;
    expect(strip(out.results[0]?.card as { cardId: string })).toEqual(
      strip(inOrder.results[1]?.card as { cardId: string }),
    );
    expect(out.results[0]?.card).toMatchObject({ state: 'review', reps: 2 });
  });

  it('sets a lemma known once its card stability passes 21 days', async () => {
    const me = t.as();
    await word(me, 20);
    let item = (await queue(me)).items[0] as ReviewItem;
    const status = async () =>
      (
        await t.db.db
          .select()
          .from(userLemma)
          .where(and(eq(userLemma.userId, me.id as string), eq(userLemma.lemmaId, 20)))
      )[0];
    expect((await status())?.status).toBe('learning');
    let stability = 0;
    for (let i = 0; i < 12 && stability <= 21; i++) {
      const r = await submit(me, [correct(item, { rating: 4, overridden: true })]);
      const c = r.results[0]?.card;
      stability = c?.stability ?? 0;
      if (stability <= 21) {
        expect((await status())?.status).toBe('learning');
        t.clock.set(c?.dueAt as string);
        item = (await queue(me)).items[0] as ReviewItem;
      }
    }
    expect(stability).toBeGreaterThan(21);
    expect(await status()).toMatchObject({ status: 'known', source: 'review' });
  });
});

describe('GET /review/queue', () => {
  it('shows learning cards, then due reviews oldest first, then new cards, reader first', async () => {
    const me = t.as();
    const a = await word(me, 3);
    const b = await word(me, 12);
    const fromWords = await word(me, 20, 'words');
    t.clock.advance(1000);
    const fromReader = await note(me, {
      kind: 'phrase',
      source: 'reader',
      content: V_MESTE_PHRASE,
    });
    let q = await queue(me);
    expect(q.items.map((i) => i.noteId)).toEqual([
      fromReader.note.id,
      a.note.id,
      b.note.id,
      fromWords.note.id,
    ]);

    // a: easy now, b: easy a minute later; both go straight to review.
    const byNote = (id: string) => q.items.find((i) => i.noteId === id) as ReviewItem;
    await submit(me, [correct(byNote(a.note.id), { rating: 4, overridden: true })]);
    t.clock.advance(MIN);
    await submit(me, [correct(byNote(b.note.id), { rating: 4, overridden: true })]);
    // reader phrase: into learning.
    await submit(me, [correct(byNote(fromReader.note.id))]);

    t.clock.advance(60 * DAY);
    q = await queue(me);
    expect(q.items.map((i) => [i.noteId, i.state])).toEqual([
      [fromReader.note.id, 'learning'],
      [a.note.id, 'review'],
      [b.note.id, 'review'],
      [fromWords.note.id, 'new'],
    ]);
    expect(q.counts).toEqual({ learning: 1, due: 2, new: 1 });
    expect((await queue(me, 2)).items.map((i) => i.noteId)).toEqual([
      fromReader.note.id,
      a.note.id,
    ]);
  });

  it('holds the daily caps across the day boundary of a learner outside UTC', async () => {
    const me = t.as();
    await me.get('/me');
    await t.db.db
      .update(profile)
      .set({ timezone: 'America/New_York', dayStartHour: 4, dailyNewLimit: 2, dailyReviewLimit: 1 })
      .where(eq(profile.userId, me.id as string));
    for (const lemmaId of [3, 12, 20, 21]) await word(me, lemmaId);

    // 08:30 UTC is 03:30 in New York: still the learner's day of 16 November.
    let q = await queue(me);
    expect(q.counts.new).toBe(2);
    expect(q.items).toHaveLength(2);
    await submit(
      me,
      q.items.map((i) => correct(i, { rating: 4, overridden: true })),
    );
    q = await queue(me);
    expect(q.counts.new).toBe(0);
    expect(q.items).toEqual([]);

    // 08:59 UTC (03:59 New York): the same learner day, the cap holds.
    t.clock.set('2026-11-17T08:59:00.000Z');
    expect((await queue(me)).counts.new).toBe(0);

    // 09:00 UTC is 04:00 in New York: a new learner day, two more new cards.
    t.clock.set('2026-11-17T09:00:00.000Z');
    q = await queue(me);
    expect(q.counts.new).toBe(2);
    await submit(
      me,
      q.items.map((i) => correct(i, { rating: 4, overridden: true })),
    );

    // Months later all four are due, but only one review is allowed per day.
    t.clock.set('2027-02-01T12:00:00.000Z');
    q = await queue(me);
    expect(q.counts).toEqual({ learning: 0, due: 1, new: 0 });
    expect(q.items).toHaveLength(1);
    await submit(me, [correct(q.items[0] as ReviewItem)]);
    expect((await queue(me)).counts.due).toBe(0);
    // Next learner day (04:00 New York = 09:00 UTC): one more.
    t.clock.set('2027-02-02T09:00:00.000Z');
    expect((await queue(me)).counts.due).toBe(1);
  });
});

describe('isolation', () => {
  it('shows learner B none of learner A cards and never changes them', async () => {
    const a = t.as();
    const b = t.as();
    await word(a, 20);
    const item = (await queue(a)).items[0] as ReviewItem;
    expect((await queue(b)).items).toEqual([]);
    // B's answer for A's card is not stored and gets no result; A's card does not change.
    const res = await submit(b, [correct(item)]);
    expect(res.results).toEqual([]);
    const [row] = await t.db.db.select().from(card).where(eq(card.id, item.cardId));
    expect(row).toMatchObject({ state: 'new', reps: 0 });
    // An answer id A already used is not B's to take.
    const mine = correct(item);
    await submit(a, [mine]);
    await word(b, 20);
    const bItem = (await queue(b)).items[0] as ReviewItem;
    const taken = await b.post('/review/answers', {
      clientId: 'b',
      answers: [{ ...mine, cardId: bItem.cardId }],
    });
    expect(taken.status).toBe(409);
  });
});
