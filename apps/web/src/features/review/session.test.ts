import type { ReviewItem } from '@app/contracts';
import { newState, schedule } from '@app/srs';
import { describe, expect, it } from 'vitest';
import {
  buildSession,
  initialSession,
  remaining,
  type SessionAction,
  type SessionState,
  sessionReducer,
} from './session';

// Forms of mesto and žena as in the contract fixtures (checked against the SNK data by F4).
const FORMS_MESTO = {
  mesto: ['s1', 's4', 's5'],
  mesta: ['s2'],
  mestu: ['s3'],
  meste: ['s6'],
  mestom: ['s7'],
  mestá: ['p1', 'p4', 'p5'],
  miest: ['p2'],
  mestám: ['p3'],
  mestách: ['p6'],
  mestami: ['p7'],
};

const T0 = Date.parse('2026-11-17T08:30:00.000Z');
const MIN = 60_000;
const DAY = 86_400_000;

let n = 0;
function card(state: 'new' | 'review' | 'learning', dueAt: number | null): ReviewItem {
  n += 1;
  const id = `0193a1b2-c3d4-7e5f-8a6b-${n.toString(16).padStart(12, '0')}`;
  let scheduler: unknown = newState(new Date(T0 - 40 * DAY));
  if (state === 'review') {
    let s = newState(new Date(T0 - 40 * DAY));
    let t = new Date(T0 - 40 * DAY);
    while (s.state !== 2) {
      s = schedule(s, 3, t, { desiredRetention: 0.9 }).state;
      t = new Date(s.dueAt);
    }
    scheduler = s;
  }
  return {
    cardId: id,
    noteId: id,
    kind: 'case_sentence',
    state,
    dueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
    prompt: {
      sentenceSk: 'Idem do mesta.',
      blank: { start: 8, end: 13 },
      sentenceEn: 'I am going to town.',
      cue: 'mesto',
    },
    answers: ['mesta'],
    formMap: FORMS_MESTO,
    explain: { case: 'gen', number: 'sg', triggerLabel: 'do + genitive' },
    variant: 0,
    scheduler,
  };
}

function run(state: SessionState, ...actions: SessionAction[]): SessionState {
  return actions.reduce(sessionReducer, state);
}

let idN = 0;
function answer(state: SessionState, typed: string, now: number, rating?: 1 | 2 | 3 | 4) {
  idN += 1;
  const id = `0193a1b2-c3d4-7e5f-8a6b-ffff${idN.toString(16).padStart(8, '0')}`;
  return run(
    state,
    { type: 'type', value: typed },
    { type: 'submit', now },
    { type: 'rate', id, now, ...(rating ? { rating } : {}) },
  );
}

describe('buildSession', () => {
  it('orders learning steps, then due reviews oldest first, then new cards', () => {
    const fresh = card('new', null);
    const recent = card('review', T0 - 1 * DAY);
    const old = card('review', T0 - 3 * DAY);
    const step = card('learning', T0 - MIN);
    const later = card('review', T0 + DAY);
    const s = buildSession([fresh, recent, old, step, later], T0);
    expect(s.main.map((c) => c.cardId)).toEqual([
      step.cardId,
      old.cardId,
      recent.cardId,
      fresh.cardId,
    ]);
    expect(s.returning).toEqual([]);
  });

  it('keeps the daily caps from the queue counts, less what was answered on this device', () => {
    const news = [1, 2, 3, 4, 5].map(() => card('new', null));
    const dues = [1, 2, 3, 4].map((i) => card('review', T0 - i * DAY));
    const items = [...dues, ...news];
    const capped = buildSession(items, T0, { due: 3, new: 2, learning: 0 });
    expect(capped.main.filter((c) => c.state === 'new')).toHaveLength(2);
    expect(capped.main.filter((c) => c.state === 'review')).toHaveLength(3);
    // The oldest reviews and the first new cards in the server's order.
    expect(capped.main.map((c) => c.cardId)).toEqual([
      dues[3]?.cardId,
      dues[2]?.cardId,
      dues[1]?.cardId,
      news[0]?.cardId,
      news[1]?.cardId,
    ]);
    const after = buildSession(items, T0, { due: 3, new: 2, learning: 0 }, { new: 1, due: 3 });
    expect(after.main.map((c) => c.state)).toEqual(['new']);
  });

  it('puts learning cards that are not yet due aside to return later', () => {
    const step = card('learning', T0 + 5 * MIN);
    const s = buildSession([step], T0);
    expect(s.main).toEqual([]);
    expect(s.returning).toEqual([{ item: step, dueAt: T0 + 5 * MIN }]);
  });
});

describe('sessionReducer', () => {
  it('runs a whole session: grade, default rating, override, reveal, done', () => {
    const items = [
      card('review', T0 - 2 * DAY),
      card('review', T0 - DAY),
      card('review', T0 - DAY / 2),
    ];
    let s = run(initialSession, { type: 'start', items, now: T0 });
    expect(s.status).toBe('answering');
    expect(s.current?.cardId).toBe(items[0]?.cardId);
    expect(remaining(s)).toBe(3);

    // An empty answer does nothing.
    expect(run(s, { type: 'submit', now: T0 })).toBe(s);

    // Correct, default rating good.
    s = run(s, { type: 'type', value: ' Mesta ' }, { type: 'submit', now: T0 + 4200 });
    expect(s.status).toBe('feedback');
    expect(s.outcome).toEqual({ grade: 'correct', diagnosis: 'correct', defaultRating: 3 });
    // Typing is ignored while the feedback shows.
    expect(run(s, { type: 'type', value: 'x' }).typed).toBe(' Mesta ');
    s = run(s, { type: 'rate', id: '0193a1b2-c3d4-7e5f-8a6b-aaaaaaaaaaa1', now: T0 + 5000 });
    expect(s.last?.answer).toMatchObject({
      cardId: items[0]?.cardId,
      typed: ' Mesta ',
      clientGrade: 'correct',
      rating: 3,
      overridden: false,
      durationMs: 5000,
      variant: 0,
      answeredAt: new Date(T0 + 5000).toISOString(),
    });
    expect(s.last?.item.state).toBe('review');
    expect(Date.parse(s.last?.item.dueAt ?? '')).toBeGreaterThan(T0 + DAY);
    expect(s.current?.cardId).toBe(items[1]?.cardId);
    expect(s.typed).toBe('');

    // Another form of the word: wrong, default again; the learner changes it to hard.
    s = run(s, { type: 'type', value: 'mestá' }, { type: 'submit', now: T0 + 6000 });
    expect(s.outcome).toEqual({ grade: 'wrong', diagnosis: 'other_case', defaultRating: 1 });
    s = run(s, {
      type: 'rate',
      rating: 2,
      id: '0193a1b2-c3d4-7e5f-8a6b-aaaaaaaaaaa2',
      now: T0 + 7000,
    });
    expect(s.last?.answer).toMatchObject({ clientGrade: 'wrong', rating: 2, overridden: true });

    // Show answer counts as revealed, rated again.
    s = run(s, { type: 'reveal', now: T0 + 8000 });
    expect(s.outcome).toEqual({ grade: 'revealed', diagnosis: null, defaultRating: 1 });
    s = run(s, { type: 'rate', id: '0193a1b2-c3d4-7e5f-8a6b-aaaaaaaaaaa3', now: T0 + 9000 });
    expect(s.last?.answer).toMatchObject({ clientGrade: 'revealed', rating: 1, typed: '' });
    expect(s.last?.item.state).toBe('relearning');

    // The forgotten card returns after 10 minutes; nothing else is left, so it comes now.
    expect(s.status).toBe('answering');
    expect(s.current?.cardId).toBe(items[2]?.cardId);
    s = answer(s, 'mesta', T0 + 10_000);
    expect(s.status).toBe('done');
    expect(s.answered).toBe(4);
    expect(s.correct).toBe(2);
    expect(remaining(s)).toBe(0);
  });

  it('brings learning cards back inside the session when their minutes are up', () => {
    const a = card('new', null);
    const others = [1, 2, 3].map(() => card('new', null));
    let s = run(initialSession, { type: 'start', items: [a, ...others], now: T0 });
    expect(s.current?.cardId).toBe(a.cardId);

    // A new card answered good: the ten minute step, so it waits aside.
    s = answer(s, 'mesta', T0);
    expect(s.last?.item.state).toBe('learning');
    expect(Date.parse(s.last?.item.dueAt ?? '')).toBe(T0 + 10 * MIN);
    expect(s.returning.map((r) => r.item.cardId)).toEqual([a.cardId]);
    expect(s.current?.cardId).toBe(others[0]?.cardId);

    // One minute later its time is not up: the next new card comes.
    s = answer(s, 'mesta', T0 + MIN);
    expect(s.current?.cardId).toBe(others[1]?.cardId);

    // After ten minutes it comes back before the remaining new card.
    s = answer(s, 'mesta', T0 + 11 * MIN);
    expect(s.current?.cardId).toBe(a.cardId);
    expect(s.current?.state).toBe('learning');

    // Good again: it graduates to days and leaves the session. The first other card's ten
    // minutes are up by now, so it comes before the last new card.
    s = answer(s, 'mesta', T0 + 12 * MIN);
    expect(s.last?.item.state).toBe('review');
    expect(s.current?.cardId).toBe(others[0]?.cardId);
    expect(s.returning.map((r) => r.item.cardId)).toEqual([others[1]?.cardId]);
    expect(s.main.map((c) => c.cardId)).toEqual([others[2]?.cardId]);
  });

  it('brings a card answered again back after one minute', () => {
    const a = card('new', null);
    const b = card('new', null);
    const c = card('new', null);
    let s = run(initialSession, { type: 'start', items: [a, b, c], now: T0 });
    s = answer(s, 'mesto', T0); // another form: wrong, again
    expect(s.last?.answer.rating).toBe(1);
    expect(Date.parse(s.last?.item.dueAt ?? '')).toBe(T0 + MIN);
    expect(s.current?.cardId).toBe(b.cardId);
    s = answer(s, 'mesta', T0 + 61_000);
    expect(s.current?.cardId).toBe(a.cardId);
  });

  it('answers with again keep a card in the session until it is learnt', () => {
    const a = card('new', null);
    let s = run(initialSession, { type: 'start', items: [a], now: T0 });
    s = answer(s, 'mesto', T0); // wrong: again
    expect(s.last?.answer.rating).toBe(1);
    expect(s.current?.cardId).toBe(a.cardId);
    s = answer(s, 'mesta', T0 + MIN);
    s = answer(s, 'mesta', T0 + 2 * MIN);
    s = answer(s, 'mesta', T0 + 12 * MIN);
    expect(s.last?.item.state).toBe('review');
    expect(s.status).toBe('done');
  });

  it('caps new cards and reviews by the queue counts', () => {
    const items = [
      card('review', T0 - DAY),
      card('review', T0 - 2 * DAY),
      card('new', null),
      card('new', null),
    ];
    let s = run(initialSession, {
      type: 'start',
      items,
      counts: { due: 1, new: 1, learning: 0 },
      now: T0,
    });
    expect(remaining(s)).toBe(2);
    s = answer(s, 'mesta', T0, 4);
    s = answer(s, 'mesta', T0, 4);
    expect(s.status).toBe('done');
    expect(s.answered).toBe(2);
  });

  it('grades with strict accents from the profile', () => {
    const c = { ...card('review', T0 - DAY), answers: ['mestá'] };
    const loose = run(
      initialSession,
      { type: 'start', items: [c], now: T0 },
      { type: 'type', value: 'mesta' },
      { type: 'submit', now: T0 },
    );
    // mesta is another form (genitive), so it is wrong even without strict accents.
    expect(loose.outcome?.grade).toBe('wrong');
    const zena = {
      ...c,
      answers: ['ženám'],
      formMap: { žena: ['s1'], ženám: ['p3'] },
    };
    const close = run(
      initialSession,
      { type: 'start', items: [zena], now: T0 },
      { type: 'type', value: 'zenam' },
      { type: 'submit', now: T0 },
    );
    expect(close.outcome).toMatchObject({ grade: 'close', defaultRating: 2 });
    const strict = run(
      initialSession,
      { type: 'start', items: [zena], now: T0, options: { strictDiacritics: true } },
      { type: 'type', value: 'zenam' },
      { type: 'submit', now: T0 },
    );
    expect(strict.outcome).toMatchObject({ grade: 'wrong', defaultRating: 1 });
  });

  it('starts a card without a readable scheduler state as new', () => {
    const c = { ...card('new', null), scheduler: { v: 'other' } };
    let s = run(initialSession, { type: 'start', items: [c], now: T0 });
    s = answer(s, 'mesta', T0);
    expect(s.last?.item.state).toBe('learning');
  });

  it('is done at once for an empty queue', () => {
    const s = run(initialSession, { type: 'start', items: [], now: T0 });
    expect(s.status).toBe('done');
    expect(s.answered).toBe(0);
  });
});
