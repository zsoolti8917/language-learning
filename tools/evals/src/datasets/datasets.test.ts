import { readFileSync } from 'node:fs';
import { readTags } from '@app/ling';
import { describe, expect, it } from 'vitest';
import { FIXTURE_CONLLU, fixtureSentences, miniLexicon } from '../testing/fixtures';
import { parseConllu } from '../ud/conllu';
import { buildDatasets, eligible } from './build';
import { formsFor, injectError, phraseOf, resolveWord, triggerOf } from './inject';
import { createRng } from './rng';

const CONLLU = [
  '# sent_id = s1',
  '# text = Idem do mesta.',
  '1\tIdem\tísť\tVERB\t_\t_\t0\troot\t_\t_',
  '2\tdo\tdo\tADP\t_\tAdpType=Prep|Case=Gen\t3\tcase\t_\t_',
  '3\tmesta\tmesto\tNOUN\t_\tCase=Gen|Gender=Neut|Number=Sing\t1\tobl\t_\tSpaceAfter=No',
  '4\t.\t.\tPUNCT\t_\t_\t1\tpunct\t_\t_',
  '',
  '# sent_id = s2',
  '1-2\tdoňho\t_\t_\t_\t_\t_\t_\t_\t_',
  '1\tdo\tdo\tADP\t_\t_\t2\tcase\t_\t_',
  '2\tňho\ton\tPRON\t_\tCase=Gen\t0\troot\t_\t_',
  '',
].join('\n');

describe('CoNLL-U reader', () => {
  it('rebuilds the text with offsets from SpaceAfter and marks multiword tokens', () => {
    const [a, b] = parseConllu(CONLLU, 'test');
    expect(a?.text).toBe('Idem do mesta.');
    expect(a?.sentId).toBe('s1');
    const mesta = a?.tokens[2];
    expect(mesta && a?.text.slice(mesta.s, mesta.e)).toBe('mesta');
    expect(mesta?.feats).toEqual({ Case: 'Gen', Gender: 'Neut', Number: 'Sing' });
    expect(a?.multiword).toBe(false);
    expect(b?.multiword).toBe(true);
  });

  it('reads the fixture: 14 sentences, each word at its offsets', () => {
    const sentences = fixtureSentences();
    expect(sentences).toHaveLength(14);
    for (const s of sentences)
      for (const t of s.tokens) expect(s.text.slice(t.s, t.e)).toBe(t.form);
  });
});

describe('error injection', () => {
  const lexicon = miniLexicon();
  const sentences = fixtureSentences();
  const byId = (id: string) => sentences.find((s) => s.sentId === id) as (typeof sentences)[0];

  it('resolves treebank words to their lemma and reading', () => {
    const s = byId('fx-3');
    const novom = resolveWord(lexicon, s.tokens[4] as never);
    expect(novom).toMatchObject({ case: 'loc', number: 'sg', gender: 'n' });
    expect(novom?.lemma.lemma).toBe('nový');
  });

  it('reads the trigger of a phrase from the tree', () => {
    const s = byId('fx-1');
    expect(triggerOf(s, s.tokens[3] as never)).toEqual({
      triggerClass: 'preposition',
      trigger: 'do',
    });
    const v = byId('fx-3');
    expect(triggerOf(v, v.tokens[2] as never)).toEqual({ triggerClass: 'verb', trigger: 'vidieť' });
    const n = byId('fx-9');
    expect(triggerOf(n, n.tokens[3] as never).triggerClass).toBe('numeral');
    expect(triggerOf(n, n.tokens[0] as never).triggerClass).toBe('subject');
  });

  it('takes an agreeing modifier into the phrase', () => {
    const s = byId('fx-6');
    expect(phraseOf(s, s.tokens[5] as never)?.map((t) => t.form)).toEqual(['dobrým', 'kamarátom']);
  });

  it('swaps a phrase into another case and keeps number and gender', () => {
    for (const s of sentences) {
      for (let seed = 1; seed <= 5; seed++) {
        const inj = injectError(s, lexicon, createRng(seed));
        if (!inj) continue;
        const l = inj.label;
        expect(inj.text.slice(l.start, l.end), s.sentId).toBe(l.given);
        expect(s.text.includes(l.expected)).toBe(true);
        expect(l.caseGiven).not.toBe(l.caseExpected);
        // The sentence with the expected words back is the original.
        expect(inj.text.slice(0, l.start) + l.expected + inj.text.slice(l.end)).toBe(s.text);
        for (const w of l.words) {
          expect(inj.text.slice(w.start, w.end)).toBe(w.given);
          // Each given word is a form of the new case in the original number.
          const rows = lexicon
            .rowsOf(w.given)
            .filter((r) => r.form.toLowerCase() === w.given.toLowerCase());
          const readings = rows.flatMap((r) => readTags(r.tags));
          expect(
            readings.some((r) => r.case === l.caseGiven && r.number === l.number),
            w.given,
          ).toBe(true);
        }
        // The head's new form is no form of the expected case, in either number.
        const head = l.words.at(-1)?.given ?? '';
        const headRows = lexicon
          .rowsOf(head)
          .filter((r) => r.lemma === l.lemma && r.form.toLowerCase() === head.toLowerCase());
        expect(
          headRows.flatMap((r) => readTags(r.tags)).some((r) => r.case === l.caseExpected),
          `${s.sentId} ${l.given}`,
        ).toBe(false);
      }
    }
  });

  it('finds the forms of a case for agreeing words by gender', () => {
    const id = lexicon.lemmasNamed('dobrý')[0]?.id as number;
    expect(formsFor(lexicon, id, { case: 'ins', number: 'sg', gender: 'f' })).toEqual(['dobrou']);
  });
});

describe('dataset build', () => {
  const lexicon = miniLexicon();
  const sentences = fixtureSentences();

  it('keeps only sentences whose words the data knows', () => {
    for (const s of sentences) expect(eligible(s, lexicon), s.sentId).toBe(true);
    const changed = parseConllu(
      readFileSync(FIXTURE_CONLLU, 'utf8').replaceAll('kamarátom', 'kamarátomx'),
      'x',
    );
    expect(changed.filter((s) => !eligible(s, lexicon)).map((s) => s.sentId)).toEqual([
      'fx-1',
      'fx-6',
    ]);
    // Too short.
    expect(eligible(parseConllu(CONLLU, 'x')[0] as never, lexicon)).toBe(false);
  });

  it('builds three disjoint sets, the same on every build', () => {
    const sizes = { correct: 4, injected: 4, analyzer: 4 };
    const a = buildDatasets(sentences, lexicon, { seed: 7, sizes });
    const b = buildDatasets(sentences, lexicon, { seed: 7, sizes });
    expect(a).toEqual(b);
    expect(a.manifest.counts).toEqual(sizes);
    const ids = [...a.correct, ...a.injected, ...a.analyzer].map((c) => c.sentId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of a.analyzer) {
      for (const w of c.words) expect(c.text.slice(w.s, w.e)).toBe(w.form);
      expect(c.words.find((w) => w.upos === 'NOUN')?.case).toBeDefined();
    }
    const other = buildDatasets(sentences, lexicon, { seed: 8, sizes });
    expect(other.correct.map((c) => c.sentId)).not.toEqual(a.correct.map((c) => c.sentId));
  });
});
