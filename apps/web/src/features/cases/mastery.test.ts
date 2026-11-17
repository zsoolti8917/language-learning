import { type AttemptInput, AttemptInputSchema, type BucketMastery } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { dueBatch, type ItemResult, makeAttempt } from './attempts';
import { EX_KNIHU, EX_MESTA, EX_ULICE } from './fixtures';
import { cellMastery, levelOf, summarize } from './mastery';

function result(exerciseId: string, tries: [correct: boolean][]): ItemResult {
  return {
    exerciseId,
    attempts: tries.map(([correct], i) =>
      makeAttempt({
        exerciseId,
        source: 'trainer',
        typed: 'x',
        correct,
        retry: i > 0,
        diagnosis: correct ? 'correct' : 'other_case',
        durationMs: 1000,
      }),
    ),
  };
}

describe('attempts', () => {
  it('makes attempts that match the contract schema', () => {
    const a: AttemptInput = makeAttempt({
      exerciseId: 'ex-1',
      source: 'lesson',
      typed: 'mesta',
      correct: true,
      retry: false,
      diagnosis: 'correct',
      durationMs: 1234.6,
      now: new Date('2026-11-17T08:00:00Z'),
    });
    expect(AttemptInputSchema.parse(a)).toEqual(a);
    expect(a).toMatchObject({ durationMs: 1235, occurredAt: '2026-11-17T08:00:00.000Z' });
    expect('sessionId' in a).toBe(false);
  });

  it('batches every five items and the rest at the end', () => {
    const results = Array.from({ length: 12 }, (_, i) => result(`ex-${i}`, [[true]]));
    expect(dueBatch(results.slice(0, 4), 0, false)).toEqual({ attempts: [], sentItems: 0 });
    const first = dueBatch(results.slice(0, 5), 0, false);
    expect(first.sentItems).toBe(5);
    expect(first.attempts.map((a) => a.exerciseId)).toEqual([
      'ex-0',
      'ex-1',
      'ex-2',
      'ex-3',
      'ex-4',
    ]);
    expect(dueBatch(results.slice(0, 9), 5, false).attempts).toEqual([]);
    const end = dueBatch(results, 10, true);
    expect(end.attempts.map((a) => a.exerciseId)).toEqual(['ex-10', 'ex-11']);
    expect(dueBatch(results, 12, true)).toEqual({ attempts: [], sentItems: 12 });
  });
});

describe('mastery', () => {
  const list: BucketMastery[] = [
    { case: 'acc', number: 'sg', gender: 'f', attempts: 30, mastery: 0.91, level: 'strong' },
    { case: 'acc', number: 'sg', gender: 'n', attempts: 10, mastery: 0.5, level: 'weak' },
    { case: 'loc', number: 'sg', gender: 'n', attempts: 3, mastery: 1, level: 'unseen' },
  ];

  it('uses the thresholds of the contract', () => {
    expect(levelOf(4, 1)).toBe('unseen');
    expect(levelOf(5, 0.59)).toBe('weak');
    expect(levelOf(5, 0.6)).toBe('ok');
    expect(levelOf(5, 0.85)).toBe('strong');
  });

  it('builds a grid cell from its genders, weighted by attempts', () => {
    const acc = cellMastery(list, 'acc', 'sg');
    expect(acc.attempts).toBe(40);
    expect(acc.mastery).toBeCloseTo((0.91 * 30 + 0.5 * 10) / 40);
    expect(acc.level).toBe('ok');
    expect(acc.genders.map((g) => [g.gender, g.level])).toEqual([
      ['m_anim', 'unseen'],
      ['m_inan', 'unseen'],
      ['f', 'strong'],
      ['n', 'weak'],
    ]);
    expect(cellMastery(list, 'loc', 'sg').level).toBe('unseen');
    expect(cellMastery(list, 'ins', 'pl')).toMatchObject({ attempts: 0, level: 'unseen' });
  });

  it('summarizes the session: improved and still weak buckets', () => {
    const items = [EX_MESTA, EX_ULICE, EX_KNIHU];
    const results = [
      result(EX_MESTA.exerciseId, [[false], [true]]),
      result(EX_ULICE.exerciseId, [[false], [false]]),
      result(EX_KNIHU.exerciseId, [[true]]),
    ];
    const before: BucketMastery[] = [
      { case: 'gen', number: 'sg', gender: 'n', attempts: 6, mastery: 0.41, level: 'weak' },
      { case: 'acc', number: 'sg', gender: 'f', attempts: 30, mastery: 0.8, level: 'ok' },
    ];
    // Before the server answers, this session's scores decide.
    const local = summarize(items, results, before, null);
    expect(local.all.map((b) => [b.key, b.sessionScore])).toEqual([
      ['gen.sg.n', 0.5],
      ['gen.sg.f', 0],
      ['acc.sg.f', 1],
    ]);
    expect(local.improved.map((b) => b.key)).toEqual(['acc.sg.f']);
    expect(local.weak.map((b) => b.key)).toEqual(['gen.sg.n', 'gen.sg.f']);

    // Once it answers, mastery before and after decide.
    const after: BucketMastery[] = [
      { case: 'gen', number: 'sg', gender: 'n', attempts: 8, mastery: 0.62, level: 'ok' },
      { case: 'acc', number: 'sg', gender: 'f', attempts: 31, mastery: 0.82, level: 'ok' },
    ];
    const server = summarize(items, results, before, after);
    expect(server.improved.map((b) => b.key)).toEqual(['gen.sg.n', 'acc.sg.f']);
    expect(server.weak.map((b) => b.key)).toEqual(['gen.sg.f']);
  });
});
