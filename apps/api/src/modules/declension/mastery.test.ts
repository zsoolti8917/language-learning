import { describe, expect, it } from 'vitest';
import {
  allBuckets,
  type BucketAttemptRow,
  levelOf,
  type MasteryAttempt,
  masteryFromRows,
  masteryOf,
} from './mastery';

const ok: MasteryAttempt = { correct: true, retry: false };
const retry: MasteryAttempt = { correct: true, retry: true };
const wrong: MasteryAttempt = { correct: false, retry: false };
const wrongRetry: MasteryAttempt = { correct: false, retry: true };

describe('mastery formula', () => {
  it('weighs attempt i by 0.9^i, newest first', () => {
    // (1*1 + 0.9*0 + 0.81*1) / (1 + 0.9 + 0.81) = 1.81 / 2.71
    expect(masteryOf([ok, wrong, ok])).toBeCloseTo(1.81 / 2.71, 12);
    // newest wrong counts most: (0 + 0.9 + 0.81) / 2.71
    expect(masteryOf([wrong, ok, ok])).toBeCloseTo(1.71 / 2.71, 12);
  });

  it('counts a correct retry as 0.5 and a wrong retry as 0', () => {
    // (1*0.5 + 0.9*0 + 0.81*1 + 0.729*0) / (1 + 0.9 + 0.81 + 0.729) = 1.31 / 3.439
    expect(masteryOf([retry, wrong, ok, wrongRetry])).toBeCloseTo(1.31 / 3.439, 12);
    expect(masteryOf([retry])).toBe(0.5);
  });

  it('uses only the newest 30 attempts', () => {
    const thirty = Array.from({ length: 30 }, () => ok);
    expect(masteryOf([...thirty, ...Array.from({ length: 20 }, () => wrong)])).toBe(1);
    // 29 right then one wrong at i = 29: 1 - 0.9^29 / sum(0.9^i, i < 30)
    const list = [...Array.from({ length: 29 }, () => ok), wrong, wrong];
    const den = (1 - 0.9 ** 30) / 0.1;
    expect(masteryOf(list)).toBeCloseTo((den - 0.9 ** 29) / den, 12);
  });

  it('is 0 without attempts', () => {
    expect(masteryOf([])).toBe(0);
  });

  it('calls a bucket unseen below 5 attempts, whatever its mastery', () => {
    expect(levelOf(0, 0)).toBe('unseen');
    expect(levelOf(4, 1)).toBe('unseen');
    expect(levelOf(4, 0)).toBe('unseen');
    expect(levelOf(5, 0.59)).toBe('weak');
    expect(levelOf(5, 0.6)).toBe('ok');
    expect(levelOf(5, 0.849)).toBe('ok');
    expect(levelOf(5, 0.85)).toBe('strong');
  });

  it('groups rows by bucket and reports the total count', () => {
    const row = (over: Partial<BucketAttemptRow>): BucketAttemptRow => ({
      case: 'gen',
      number: 'sg',
      gender: 'n',
      correct: true,
      retry: false,
      total: 40,
      ...over,
    });
    const rows = [
      row({ correct: false }),
      row({}),
      row({ retry: true }),
      row({ case: 'acc', gender: 'f', total: 2 }),
      row({ case: 'acc', gender: 'f', total: 2, correct: false }),
    ];
    const m = masteryFromRows(rows);
    const gen = m.find((x) => x.case === 'gen');
    // (0 + 0.9 + 0.81*0.5) / 2.71
    expect(gen?.mastery).toBeCloseTo(1.305 / 2.71, 12);
    expect(gen?.attempts).toBe(40);
    expect(gen?.level).toBe('weak');
    const acc = m.find((x) => x.case === 'acc');
    expect(acc).toMatchObject({ attempts: 2, level: 'unseen' });
    expect(acc?.mastery).toBeCloseTo(1 / 1.9, 12);

    const all = allBuckets(m);
    expect(all).toHaveLength(56);
    expect(all.find((x) => x.case === 'dat' && x.number === 'pl' && x.gender === 'f')).toEqual({
      case: 'dat',
      number: 'pl',
      gender: 'f',
      attempts: 0,
      mastery: 0,
      level: 'unseen',
    });
  });
});
