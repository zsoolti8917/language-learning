import { examples, type PlacementItem, type PlacementResult, type Profile } from '@app/contracts';
import { describe, expect, it } from 'vitest';
import { apiKey } from '../../lib/api';
import { parseResponse } from '../../lib/api/validate';
import { PROFILE_KV_KEY } from '../../lib/auth/profile';
import { kvGet } from '../../lib/db';
import { createQueryClient } from '../../lib/query';
import { roundOf, VOCAB_ROUNDS } from './mocks';
import { markPlacementDone, progressOf, ROUND_COUNT, roundAnswers } from './run';

const PROFILE = examples['profile.get'].ok[0]?.response.body as Profile;
const RESULT: PlacementResult = {
  knownUpToRank: 1000,
  lessonsTestedOut: ['acc-sg'],
  startLessonId: 'loc-sg',
  buckets: [],
};

describe('placement run helpers', () => {
  it('measures progress across the four rounds', () => {
    expect(ROUND_COUNT).toBe(4);
    expect(progressOf(1, 0, 12)).toBe(0);
    expect(progressOf(1, 6, 12)).toBe(0.125);
    expect(progressOf(3, 0, 12)).toBe(0.5);
    expect(progressOf(4, 16, 16)).toBe(1);
  });

  it('sends every item, unanswered ones as "I don\'t know" or an empty answer', () => {
    const items: PlacementItem[] = [
      { itemId: 'v1', kind: 'vocab', lemmaId: 20, lemma: 'mesto', options: ['a', 'b', 'c', '?'] },
      { itemId: 'v2', kind: 'vocab', lemmaId: 6, lemma: 'dom', options: ['a', 'b', '?'] },
      {
        itemId: 'c1',
        kind: 'case',
        sentenceSk: 'Idem do ___.',
        sentenceEn: '',
        blank: { start: 8, end: 11 },
        cue: 'mesto',
      },
    ];
    expect(roundAnswers(items, { v1: { choice: 0 } })).toEqual([
      { itemId: 'v1', choice: 0 },
      { itemId: 'v2', choice: 2 },
      { itemId: 'c1', typed: '' },
    ]);
  });

  it('sets placementDoneAt on the cached profile when the result arrives', async () => {
    const queryClient = createQueryClient({ retry: false });
    queryClient.setQueryData(apiKey('profile.get'), { ...PROFILE, placementDoneAt: null });
    const now = new Date('2026-11-17T10:00:00.000Z');
    const next = await markPlacementDone(queryClient, RESULT, () => now);
    expect(next?.placementDoneAt).toBe(now.toISOString());
    expect(next?.currentLessonId).toBe('loc-sg');
    const cached = queryClient.getQueryData<Profile>(apiKey('profile.get'));
    expect(cached?.placementDoneAt).toBe(now.toISOString());
    expect((await kvGet<Profile>(PROFILE_KV_KEY))?.placementDoneAt).toBe(now.toISOString());
    // The server's own date wins when it is already there.
    const again = await markPlacementDone(queryClient, RESULT, () => new Date(0));
    expect(again?.placementDoneAt).toBe(now.toISOString());
  });

  it('mock rounds fit the contract', () => {
    for (let r = 1; r <= VOCAB_ROUNDS + 1; r++) {
      expect(() =>
        parseResponse('placement.answer', { status: 'active', round: roundOf(r) }),
      ).not.toThrow();
    }
    const vocab = roundOf(1).items[0];
    expect(vocab?.kind === 'vocab' && vocab.options.at(-1)).toBe("I don't know");
    expect(roundOf(4).items.every((i) => i.kind === 'case' && i.sentenceSk.includes('___'))).toBe(
      true,
    );
  });
});
