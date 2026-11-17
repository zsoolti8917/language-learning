import { describe, expect, it } from 'vitest';
import { parseResponse } from '../../lib/api/validate';
import { MINI_LEMMAS } from './mockData';
import { mockBands, mockLemmaDetail } from './mocks';

describe('words mocks', () => {
  it('answer inside the contract for every mini lemma', () => {
    expect(MINI_LEMMAS).toHaveLength(72);
    for (const l of MINI_LEMMAS) {
      expect(() => parseResponse('lemmas.get', mockLemmaDetail(l.id))).not.toThrow();
    }
    expect(() => parseResponse('words.bands', { bands: mockBands() })).not.toThrow();
  });

  it('give mesto the forms of the contract example', () => {
    const mesto = mockLemmaDetail(20);
    expect(mesto?.lemma.lemma).toBe('mesto');
    expect(mesto?.forms.map((f) => f.form).sort()).toEqual(
      [
        'mesto',
        'mesta',
        'mestu',
        'meste',
        'mestom',
        'mestá',
        'miest',
        'mestám',
        'mestách',
        'mestami',
      ].sort(),
    );
  });
});
