import { runMorphologySuite } from '@app/api/testing/suites/morphology';
import { describe, expect, it } from 'vitest';
import { prepositionTriggers } from './lexicon';
import { miniLexicon } from './testing/fixtures';

// The in-memory port passes the same suite as the lexicon module's real port, so the evals'
// verification step and analyzer read the data as production does.
runMorphologySuite('evals in memory (mini dataset)', () => miniLexicon().morphology());

describe('Lexicon', () => {
  const lexicon = miniLexicon();

  it('keeps the authored triggers and adds the preposition triggers of the data', () => {
    const ids = lexicon.triggers.map((t) => t.id);
    expect(ids).toContain('prep-do');
    expect(ids).toContain('verb-vidiet');
    // The mini prepositions carry no flags.cases, so nothing is added there.
    expect(ids.filter((id) => id === 'prep-do')).toHaveLength(1);
  });

  it('names derived triggers as the mini dataset does and never repeats a known one', () => {
    const lemmas = [
      {
        id: 45,
        key: 'do|prep||1',
        lemma: 'do',
        pos: 'prep' as const,
        flags: { cases: ['gen' as const] },
      },
      {
        id: 50,
        key: 'v|prep||1',
        lemma: 'v',
        pos: 'prep' as const,
        flags: { cases: ['acc' as const, 'loc' as const] },
      },
      {
        id: 90,
        key: 'medzi|prep||1',
        lemma: 'medzi',
        pos: 'prep' as const,
        flags: { cases: ['acc' as const, 'ins' as const] },
      },
    ];
    const known = [
      { id: 'prep-v-loc', kind: 'preposition' as const, lemma: 'v', case: 'loc' as const },
    ];
    expect(prepositionTriggers(lemmas, known).map((t) => `${t.id}:${t.case}`)).toEqual([
      'prep-do:gen',
      'prep-v-acc:acc',
      'prep-medzi-acc:acc',
      'prep-medzi-ins:ins',
    ]);
  });

  it('serves lemma facts and triggers in the shapes the analyzer reads from ling', () => {
    expect(lexicon.lemmaFacts([20, 99999])).toEqual([
      expect.objectContaining({
        id: 20,
        lemma: 'mesto',
        pos: 'noun',
        gender: 'n',
        freqRank: expect.any(Number),
      }),
    ]);
    expect(lexicon.triggerFacts().find((t) => t.id === 'prep-s-ins')).toEqual({
      id: 'prep-s-ins',
      kind: 'preposition',
      lemma: 's',
      lemmaId: 55,
      case: 'ins',
    });
  });
});
