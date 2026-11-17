import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMorphologySuite } from '@app/api/testing/suites/morphology';
import { MINI_DIR } from '@app/testkit/mini';
import { describe, expect, it } from 'vitest';
import { Lexicon, sourceFromBuild } from './lexicon';
import { miniLexicon } from './testing/fixtures';

// The in-memory port passes the same suite as the lexicon module's real port, so the evals'
// verification step and analyzer read the data as production does.
runMorphologySuite('evals in memory (mini dataset)', () => miniLexicon().morphology());

describe('Lexicon', () => {
  const lexicon = miniLexicon();

  it('keeps the trigger rows of the content folder as they are', () => {
    const ids = lexicon.triggers.map((t) => t.id);
    expect(ids).toContain('prep-do');
    expect(ids).toContain('verb-vidiet');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads the full trigger list of the triggers stage (C4) from a pipeline build', () => {
    const build = mkdtempSync(join(tmpdir(), 'evals-build-'));
    try {
      mkdirSync(join(build, 'morph'));
      for (const f of ['lemmas.jsonl', 'forms.jsonl'])
        copyFileSync(join(MINI_DIR, f), join(build, 'morph', f));
      expect(() => sourceFromBuild(build)).toThrow(/pipeline triggers/u);
      mkdirSync(join(build, 'triggers'));
      const rows = [
        {
          id: 'prep-do',
          kind: 'preposition',
          lemma: 'do',
          lemmaId: 45,
          case: 'gen',
          meaningEn: 'to',
        },
        { id: 'quant-vela', kind: 'quantifier', lemma: 'veľa', case: 'gen', meaningEn: 'a lot of' },
      ];
      writeFileSync(
        join(build, 'triggers', 'triggers.jsonl'),
        `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`,
      );
      const source = sourceFromBuild(build);
      // Exactly the stage's rows: nothing from the mini dataset, nothing derived.
      expect(source.triggers.map((t) => t.id)).toEqual(['prep-do', 'quant-vela']);
      expect(source.label).toMatch(/2 triggers/u);
      expect(new Lexicon(source).triggerInfos()[1]).toEqual({
        id: 'quant-vela',
        kind: 'quantifier',
        lemma: 'veľa',
        case: 'gen',
        meaningEn: 'a lot of',
      });
    } finally {
      rmSync(build, { recursive: true, force: true });
    }
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
