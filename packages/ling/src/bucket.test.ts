import { BucketMasterySchema } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { ALL_BUCKETS, bucketKey, bucketOf, bucketOfTag, parseBucketKey } from './bucket';

describe('buckets', () => {
  it('combine case, number and gender, with animate and inanimate masculine apart', () => {
    expect(bucketOf({ case: 'acc', number: 'sg', gender: 'm_anim' })).toEqual({
      case: 'acc',
      number: 'sg',
      gender: 'm_anim',
    });
    expect(bucketKey({ case: 'acc', number: 'sg', gender: 'm_anim' })).not.toBe(
      bucketKey({ case: 'acc', number: 'sg', gender: 'm_inan' }),
    );
  });

  it('take the noun gender when the features have none', () => {
    expect(bucketOf({ case: 'gen', number: 'pl' }, 'f')).toEqual({
      case: 'gen',
      number: 'pl',
      gender: 'f',
    });
    expect(bucketOf({ case: 'gen', number: 'pl' })).toBeNull();
  });

  it('come from tags', () => {
    expect(bucketOfTag('s2', 'n')).toEqual({ case: 'gen', number: 'sg', gender: 'n' });
    expect(bucketOfTag('p4i')).toEqual({ case: 'acc', number: 'pl', gender: 'm_inan' });
    expect(bucketOfTag('s2')).toBeNull();
    expect(bucketOfTag('x3', 'f')).toBeNull();
    expect(bucketOfTag('v:Kesc+')).toBeNull();
  });

  it('are 56, each with a key that reads back, and fit the mastery shape', () => {
    expect(ALL_BUCKETS).toHaveLength(56);
    const keys = new Set(ALL_BUCKETS.map(bucketKey));
    expect(keys.size).toBe(56);
    for (const b of ALL_BUCKETS) {
      expect(parseBucketKey(bucketKey(b))).toEqual(b);
      expect(() =>
        BucketMasterySchema.parse({ ...b, attempts: 0, mastery: 0, level: 'unseen' }),
      ).not.toThrow();
    }
    expect(bucketKey({ case: 'gen', number: 'sg', gender: 'f' })).toBe('gen.sg.f');
    expect(parseBucketKey('gen.sg')).toBeNull();
    expect(parseBucketKey('gen.sg.x')).toBeNull();
    expect(parseBucketKey('gen.sg.f.x')).toBeNull();
  });
});
