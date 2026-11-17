import type { BucketMastery } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { type Candidate, seededRandom, selectSession, WEAK_BUCKETS } from './select';

const BUCKETS = ['acc.sg.f', 'acc.sg.m_anim', 'acc.sg.m_inan', 'acc.sg.n', 'loc.sg.f', 'loc.sg.n'];

function candidates(perBucket: number): Candidate[] {
  return BUCKETS.flatMap((bucket) =>
    Array.from({ length: perBucket }, (_, i) => ({
      exerciseId: `${bucket}#${i}`,
      bucket,
      lastSeenAt: null,
    })),
  );
}

function m(key: string, mastery: number, attempts = 20): BucketMastery {
  const [c, number, gender] = key.split('.');
  const level =
    attempts < 5 ? 'unseen' : mastery < 0.6 ? 'weak' : mastery >= 0.85 ? 'strong' : 'ok';
  return { case: c, number, gender, attempts, mastery, level } as BucketMastery;
}

const shares = new Map(BUCKETS.map((b) => [b, 0.2]));
const bucketOfId = (id: string) => id.split('#')[0] as string;

describe('seeded random source', () => {
  it('repeats for a seed and differs between seeds', () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const c = seededRandom(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect([c(), c(), c()]).not.toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});

describe('session builder', () => {
  const mastery = [
    m('acc.sg.f', 0.95),
    m('acc.sg.m_anim', 0.92),
    m('acc.sg.m_inan', 0.7),
    m('acc.sg.n', 0.75),
    m('loc.sg.f', 0.1),
    m('loc.sg.n', 0.2),
  ];

  it('gives the same session for the same seed and history, whatever the input order', () => {
    const input = { mode: 'mixed' as const, size: 12, seed: 42, shares, mastery };
    const a = selectSession({ ...input, candidates: candidates(6) });
    const b = selectSession({ ...input, candidates: [...candidates(6)].reverse() });
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect(new Set(a).size).toBe(12);
    const c = selectSession({ ...input, seed: 43, candidates: candidates(6) });
    expect(c).not.toEqual(a);
  });

  it('weak mode: most items from the weakest buckets, at least 30% from strong ones', () => {
    for (let seed = 0; seed < 20; seed++) {
      const ids = selectSession({
        mode: 'weak',
        size: 10,
        seed,
        shares,
        mastery,
        candidates: candidates(8),
      });
      const buckets = ids.map(bucketOfId);
      const strong = buckets.filter((b) => b === 'acc.sg.f' || b === 'acc.sg.m_anim').length;
      // The three weakest buckets: loc.sg.f 0.1, loc.sg.n 0.2, acc.sg.m_inan 0.7.
      const weakest = buckets.filter(
        (b) => b === 'loc.sg.f' || b === 'loc.sg.n' || b === 'acc.sg.m_inan',
      ).length;
      expect(ids).toHaveLength(10);
      expect(strong).toBeGreaterThanOrEqual(3);
      expect(weakest).toBeGreaterThan(10 / 2);
      expect(buckets).not.toContain('acc.sg.n');
    }
  });

  it('weak mode draws the weak part from at most the weakest buckets', () => {
    const ids = selectSession({
      mode: 'weak',
      size: 10,
      seed: 1,
      shares,
      mastery,
      candidates: candidates(8),
    });
    const notStrong = new Set(
      ids.map(bucketOfId).filter((b) => b !== 'acc.sg.f' && b !== 'acc.sg.m_anim'),
    );
    expect(notStrong.size).toBeLessThanOrEqual(WEAK_BUCKETS);
    expect(notStrong.has('acc.sg.n')).toBe(false); // 0.75: the fourth weakest
  });

  it('mixed mode keeps 30% for strong buckets and weighs the rest by share and mastery', () => {
    let weak = 0;
    let ok = 0;
    for (let seed = 0; seed < 50; seed++) {
      const ids = selectSession({
        mode: 'mixed',
        size: 10,
        seed,
        shares,
        mastery,
        candidates: candidates(10),
      });
      const b = ids.map(bucketOfId);
      expect(
        b.filter((x) => x === 'acc.sg.f' || x === 'acc.sg.m_anim').length,
      ).toBeGreaterThanOrEqual(3);
      weak += b.filter((x) => x.startsWith('loc')).length;
      ok += b.filter((x) => x === 'acc.sg.m_inan' || x === 'acc.sg.n').length;
    }
    expect(weak).toBeGreaterThan(ok * 2);
  });

  it('takes no strong share when no bucket is strong, and treats unseen buckets as middling', () => {
    const ids = selectSession({
      mode: 'weak',
      size: 6,
      seed: 3,
      shares,
      mastery: [m('loc.sg.f', 0.3), m('acc.sg.f', 0, 2)],
      candidates: candidates(4),
    });
    const b = ids.map(bucketOfId);
    // loc.sg.f (0.3) is the weakest; unseen buckets count as 0.5.
    expect(b.filter((x) => x === 'loc.sg.f').length).toBeGreaterThanOrEqual(2);
    expect(ids).toHaveLength(6);
  });

  it('prefers exercises the learner has not seen lately', () => {
    const list: Candidate[] = [
      { exerciseId: 'a', bucket: 'loc.sg.f', lastSeenAt: 3000 },
      { exerciseId: 'b', bucket: 'loc.sg.f', lastSeenAt: 1000 },
      { exerciseId: 'c', bucket: 'loc.sg.f', lastSeenAt: null },
      { exerciseId: 'd', bucket: 'loc.sg.f', lastSeenAt: 2000 },
    ];
    for (let seed = 0; seed < 10; seed++) {
      const ids = selectSession({
        mode: 'mixed',
        size: 2,
        seed,
        shares,
        mastery: [],
        candidates: list,
      });
      expect([...ids].sort()).toEqual(['b', 'c']);
    }
  });

  it('fills from other buckets when the chosen ones run out, and stops at the pool size', () => {
    const few = candidates(1);
    const ids = selectSession({
      mode: 'weak',
      size: 50,
      seed: 9,
      shares,
      mastery,
      candidates: few,
    });
    expect([...ids].sort()).toEqual(few.map((c) => c.exerciseId).sort());
  });
});
