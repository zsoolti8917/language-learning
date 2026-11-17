import { describe, expect, it } from 'vitest';
import { Lexicon, type LexLemma } from '../stages/sentences/lexicon';
import { grammarHints } from './grammar';

function lexicon(): Lexicon {
  const lex = new Lexicon(3000);
  let id = 0;
  const add = (l: Omit<LexLemma, 'id' | 'key' | 'topForms'>, forms: Record<string, string>) => {
    id++;
    lex.addLemma({ ...l, id, key: `${l.lemma}|${l.pos}`, topForms: [] });
    for (const [form, tags] of Object.entries(forms)) lex.addForm(id, form, tags);
  };
  add({ lemma: 'do', pos: 'prep', freqRank: 10, cases: ['gen'] }, { do: '' });
  add({ lemma: 'v', pos: 'prep', freqRank: 3, cases: ['loc', 'acc'] }, { v: '', vo: '' });
  add(
    { lemma: 'mesto', pos: 'noun', gender: 'n', freqRank: 130 },
    { mesto: 's1 s4 s5', mesta: 's2 p1 p4 p5', meste: 's6' },
  );
  add({ lemma: 'dom', pos: 'noun', gender: 'm_inan', freqRank: 120 }, { dom: 's1 s4', dome: 's6' });
  add(
    { lemma: 'pekný', pos: 'adj', freqRank: 500 },
    {
      pekný: 's1m s1i s4i s5m s5i',
      pekná: 's1f s5f',
      pekného: 's2m s2i s2n s4m',
      peknom: 's6m s6i s6n',
    },
  );
  add({ lemma: 'plný', pos: 'adj', freqRank: 600 }, { plný: 's1m s1i s4i' });
  add({ lemma: 'voda', pos: 'noun', gender: 'f', freqRank: 200 }, { vody: 's2 p1 p4', voda: 's1' });
  add({ lemma: 'niekoľko', pos: 'pron', freqRank: 282 }, { niekoľko: 's1n s4n s5n' });
  add({ lemma: 'vozidlo', pos: 'noun', gender: 'n', freqRank: 900 }, { vozidiel: 'p2' });
  add({ lemma: 'päť', pos: 'num', freqRank: 300 }, { päť: 'p1f p4f p1n p4n' });
  add({ lemma: 'ísť', pos: 'verb', freqRank: 50 }, { idem: 'v:Kesa+' });
  add({ lemma: 'stáť', pos: 'verb', freqRank: 400 }, { stojí: 'v:Kesc+' });
  return lex;
}

describe('grammarHints', () => {
  const lex = lexicon();

  it('names a noun that has no reading in a case of the preposition before it', () => {
    expect(grammarHints('Idem do meste.', lex)).toEqual([
      'after "do" (takes gen) "meste" has no such reading; it can be loc',
    ]);
    expect(grammarHints('Idem do mesta.', lex)).toEqual([]);
    expect(grammarHints('Stojí v meste.', lex)).toEqual([]);
    expect(grammarHints('Idem do dom.', lex)).toEqual([
      'after "do" (takes gen) "dom" has no such reading; it can be nom/acc',
    ]);
    // "mesta" is also the accusative plural, which "v" takes: one fitting reading is enough.
    expect(grammarHints('Idem v mesta.', lex)).toEqual([]);
  });

  it('follows the phrase through its adjectives up to the noun', () => {
    expect(grammarHints('Idem do pekného mesta.', lex)).toEqual([]);
    const hints = grammarHints('Idem do peknom meste.', lex);
    expect(hints).toContain('after "do" (takes gen) "peknom" has no such reading; it can be loc');
    expect(hints).toContain('after "do" (takes gen) "meste" has no such reading; it can be loc');
  });

  it('names an adjective and a noun that agree in no reading', () => {
    expect(grammarHints('Pekná dom stojí.', lex)).toEqual([
      '"Pekná dom" do not agree in case, number and gender in any reading',
    ]);
    expect(grammarHints('Pekný dom stojí.', lex)).toEqual([]);
  });

  it('hints at an adjective that governs its noun, which a reader must judge', () => {
    expect(grammarHints('Dom plný vody stojí.', lex)).toEqual([
      '"plný vody" do not agree in case, number and gender in any reading',
    ]);
  });

  it('gives no hint for a quantity word or a numeral before a genitive', () => {
    expect(grammarHints('Niekoľko vozidiel stojí.', lex)).toEqual([]);
    expect(grammarHints('Päť vozidiel stojí.', lex)).toEqual([]);
  });

  it('skips words the lexicon does not know', () => {
    expect(grammarHints('Idem do Xanadu.', lex)).toEqual([]);
  });
});
