import { CardSnapshotSchema, type Rating } from '@app/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isKnownStability,
  isSchedulerState,
  newState,
  parseSchedulerState,
  replay,
  SCHEDULER_VERSION,
  type SchedulerState,
  schedule,
  snapshotOf,
} from './scheduler';

const T0 = new Date('2026-11-17T08:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const opts = { desiredRetention: 0.9 };

const at = (ms: number) => new Date(T0.getTime() + ms);
const dueMs = (s: SchedulerState) => Date.parse(s.dueAt);

describe('newState', () => {
  it('makes a new card with no due date in its snapshot', () => {
    const state = newState(T0);
    expect(state.v).toBe(SCHEDULER_VERSION);
    expect(snapshotOf(state)).toEqual({
      state: 'new',
      dueAt: null,
      stability: null,
      difficulty: null,
      reps: 0,
      lapses: 0,
      scheduler: state,
    });
    expect(newState(T0)).toEqual(state);
  });
});

describe('schedule with a fixed clock', () => {
  it('takes a new card through 1 and 10 minute steps into review', () => {
    let s = newState(T0);

    // Again: the first step, one minute.
    let r = schedule(s, 1, T0, opts);
    s = r.state;
    expect(r.snapshot.state).toBe('learning');
    expect(dueMs(s) - T0.getTime()).toBe(1 * MIN);

    // Good: the next step, ten minutes.
    const t1 = at(1 * MIN);
    r = schedule(s, 3, t1, opts);
    s = r.state;
    expect(r.snapshot.state).toBe('learning');
    expect(dueMs(s) - t1.getTime()).toBe(10 * MIN);

    // Good after the last step: review, a day or more away.
    const t2 = at(11 * MIN);
    r = schedule(s, 3, t2, opts);
    s = r.state;
    expect(r.snapshot.state).toBe('review');
    expect(dueMs(s) - t2.getTime()).toBeGreaterThanOrEqual(DAY);
    expect(r.snapshot.reps).toBe(3);
    expect(r.snapshot.lapses).toBe(0);
    expect(r.snapshot.stability).toBeGreaterThan(0);
    expect(r.snapshot.dueAt).toBe(s.dueAt);
  });

  it('a new card answered good goes to the ten minute step, not straight to days', () => {
    const r = schedule(newState(T0), 3, T0, opts);
    expect(r.snapshot.state).toBe('learning');
    expect(dueMs(r.state) - T0.getTime()).toBe(10 * MIN);
  });

  it('a lapse sends a review card to a ten minute relearning step, then back to review', () => {
    let s = newState(T0);
    s = schedule(s, 3, T0, opts).state;
    s = schedule(s, 3, at(10 * MIN), opts).state;
    const due = dueMs(s);
    const review = schedule(s, 3, new Date(due), opts);
    s = review.state;
    expect(review.snapshot.state).toBe('review');
    const stabilityBefore = s.stability;

    const lapseAt = new Date(dueMs(s));
    const lapse = schedule(s, 1, lapseAt, opts);
    expect(lapse.snapshot.state).toBe('relearning');
    expect(lapse.snapshot.lapses).toBe(1);
    expect(dueMs(lapse.state) - lapseAt.getTime()).toBe(10 * MIN);
    expect(lapse.state.stability).toBeLessThan(stabilityBefore);

    const backAt = new Date(lapseAt.getTime() + 10 * MIN);
    const back = schedule(lapse.state, 3, backAt, opts);
    expect(back.snapshot.state).toBe('review');
    expect(dueMs(back.state) - backAt.getTime()).toBeGreaterThanOrEqual(DAY);
  });

  it('a higher target retention gives a shorter interval', () => {
    let s = newState(T0);
    s = schedule(s, 3, T0, opts).state;
    s = schedule(s, 3, at(10 * MIN), opts).state;
    const when = new Date(dueMs(s));
    const low = schedule(s, 3, when, { desiredRetention: 0.8 }).state;
    const high = schedule(s, 3, when, { desiredRetention: 0.95 }).state;
    expect(dueMs(high)).toBeLessThan(dueMs(low));
  });

  it('survives a round trip through JSON, and its snapshot fits the contract', () => {
    let s = newState(T0);
    s = schedule(s, 3, T0, opts).state;
    const stored = JSON.parse(JSON.stringify(s));
    const fromJson = schedule(parseSchedulerState(stored), 3, at(10 * MIN), opts);
    const direct = schedule(s, 3, at(10 * MIN), opts);
    expect(fromJson).toEqual(direct);
    expect(
      CardSnapshotSchema.parse({
        cardId: '0190a3c4-5b6d-7e8f-9a0b-1c2d3e4f5a6b',
        ...direct.snapshot,
      }),
    ).toBeTruthy();
  });

  it('does not throw for an answer stamped before the last review', () => {
    let s = newState(T0);
    s = schedule(s, 3, at(5 * MIN), opts).state;
    const r = schedule(s, 3, T0, opts);
    expect(r.state.lastReviewAt).toBe(at(5 * MIN).toISOString());
  });

  it('refuses bad input', () => {
    const s = newState(T0);
    expect(() => schedule(s, 5 as Rating, T0, opts)).toThrow(RangeError);
    expect(() => schedule(s, 3, new Date('nope'), opts)).toThrow(RangeError);
    expect(() => schedule(s, 3, T0, { desiredRetention: 1 })).toThrow(RangeError);
    expect(() =>
      schedule({ ...s, v: 'fsrs6.1' } as unknown as SchedulerState, 3, T0, opts),
    ).toThrow(/unknown scheduler state version/);
    expect(() => parseSchedulerState({})).toThrow(TypeError);
    expect(isSchedulerState(null)).toBe(false);
    expect(isSchedulerState({ ...s, dueAt: 'never' })).toBe(false);
  });
});

describe('replay', () => {
  const ratings = fc.constantFrom<Rating>(1, 2, 3, 4);
  const log = fc.array(
    fc.record({ rating: ratings, gapMs: fc.integer({ min: 0, max: 60 * DAY }) }),
    { minLength: 1, maxLength: 25 },
  );

  it('equals scheduling the same reviews one by one, in any input order', () => {
    fc.assert(
      fc.property(log, fc.integer({ min: 0, max: 2 ** 31 - 1 }), (steps, seed) => {
        let t = T0.getTime();
        const reviews = steps.map(({ rating, gapMs }) => {
          t += gapMs;
          return { rating, answeredAt: new Date(t) };
        });

        let s = newState(T0);
        for (const r of reviews) s = schedule(s, r.rating, r.answeredAt, opts).state;

        // Shuffle reviews with distinct times; equal times keep their order.
        const shuffled = [...reviews]
          .map((r, i) => ({ r, k: (i * 2654435761 + seed) % 1000 }))
          .sort((a, b) => a.k - b.k)
          .map((x) => x.r);
        const distinct =
          new Set(reviews.map((r) => r.answeredAt.getTime())).size === reviews.length;
        const input = distinct ? shuffled : reviews;

        const replayed = replay(input, { ...opts, createdAt: T0 });
        expect(replayed.state).toEqual(s);
        expect(replayed.snapshot).toEqual(snapshotOf(s));
      }),
      { numRuns: 200 },
    );
  });

  it('starts at the first review without createdAt, and needs one of them', () => {
    const r = replay([{ rating: 3, answeredAt: T0 }], opts);
    expect(r.state).toEqual(schedule(newState(T0), 3, T0, opts).state);
    expect(replay([], { ...opts, createdAt: T0 }).state).toEqual(newState(T0));
    expect(() => replay([], opts)).toThrow(RangeError);
  });
});

describe('isKnownStability', () => {
  it('is true once stability passes 21 days', () => {
    expect(isKnownStability(21)).toBe(false);
    expect(isKnownStability(21.5)).toBe(true);
    expect(isKnownStability(null)).toBe(false);
  });
});
