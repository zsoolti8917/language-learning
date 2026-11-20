// The pruning rules on hand-built sentences. Every case here is one the treebank showed the
// rules getting wrong on the full dictionary: a rare homograph taken for the common word, a
// phrase carried past its end, a numeral read in the wrong case. Each word lists its readings
// as the dictionary gives them, the most frequent lemma first.
import type { Case, Gender, Pos } from '@app/contracts';
import { readTag } from '@app/ling';
import { describe, expect, it } from 'vitest';
import type { TriggerFacts } from './repo';
import { applyRules, indexTriggers, type Option, type WorkSentence } from './rules';

const ids = new Map<string, number>();
function idOf(lemma: string, pos: Pos): number {
  const key = `${lemma}|${pos}`;
  const id = ids.get(key) ?? ids.size + 1;
  ids.set(key, id);
  return id;
}

/** The readings of one lemma: `r('žena', 'noun', 's2 p1 p4', 'f')`; no tags for a word without. */
function r(lemma: string, pos: Pos, tags = '', gender?: Gender): Option[] {
  const lemmaId = idOf(lemma, pos);
  return (tags === '' ? [''] : tags.split(' ')).map((tag) => {
    const reading = tag === '' ? undefined : readTag(tag, pos === 'noun' ? gender : undefined);
    const o: Option = {
      lemmaId,
      lemma,
      pos,
      form: lemma,
      agrees: pos !== 'noun' && reading?.gender !== undefined && reading.case !== undefined,
    };
    if (tag !== '') o.tag = tag;
    if (reading?.case) o.case = reading.case;
    if (reading?.number) o.number = reading.number;
    if (reading?.gender) o.gender = reading.gender;
    return o;
  });
}

type Item = string | [string, ...Option[][]];

/** A sentence: a string is punctuation or a number in digits, a list is a word and its readings. */
function sentence(...items: Item[]): WorkSentence {
  const s: WorkSentence = { s: 0, e: 0, tokens: [], texts: [], words: [] };
  let at = 0;
  for (const item of items) {
    const text = typeof item === 'string' ? item : item[0];
    const t = typeof item !== 'string' ? 'word' : /^\d+$/u.test(item) ? 'num' : 'punct';
    s.tokens.push({ s: at, e: at + text.length, t });
    s.texts.push(text);
    if (typeof item === 'string') s.words.push(null);
    else {
      const options = item.slice(1).flat() as Option[];
      s.words.push({
        options: options.map((o) => ({ ...o, form: text })),
        initial: options.length,
      });
    }
    at += text.length + 1;
  }
  s.e = at;
  return s;
}

const prep = (lemma: string, ...cases: Case[]): TriggerFacts[] =>
  cases.map((c) => ({
    id: `prep-${lemma}-${c}`,
    kind: 'preposition',
    lemma,
    lemmaId: idOf(lemma, 'prep'),
    case: c,
  }));
const TRIGGERS = indexTriggers([
  ...prep('v', 'loc', 'acc'),
  ...prep('o', 'loc', 'acc'),
  ...prep('po', 'loc', 'acc'),
  ...prep('pre', 'acc'),
  ...prep('za', 'gen', 'acc', 'ins'),
  ...prep('vedľa', 'gen'),
  ...prep('pod', 'ins', 'acc'),
  ...prep('pomocou', 'gen'),
  { id: 'num-pat', kind: 'numeral', lemma: 'päť', lemmaId: idOf('päť', 'num'), case: 'gen' },
  {
    id: 'quant-viac',
    kind: 'quantifier',
    lemma: 'viac',
    lemmaId: idOf('viac', 'num'),
    case: 'gen',
  },
]);

const applied = new WeakSet<WorkSentence>();
/** The readings a word has after the rules, as `lemma tag`. The rules run once per sentence. */
function after(s: WorkSentence, text: string, nth = 0): string[] {
  if (!applied.has(s)) {
    applyRules(s, TRIGGERS);
    applied.add(s);
  }
  const at = s.texts.flatMap((t, i) => (t === text ? [i] : []))[nth];
  const w = at === undefined ? undefined : s.words[at];
  if (!w) throw new Error(`no word ${text}`);
  return w.options.map((o) => (o.tag ? `${o.lemma} ${o.tag}` : `${o.lemma} ${o.pos}`));
}

// Readings of words the cases share.
const A = () => [r('a', 'conj'), r('a', 'noun', 's1 s2 s4 s6 s7 p1 p2 p4 p6 p7', 'n')];
const ALL_CASES = 's1 s2 s3 s4 s6 s7';
const adj = (lemma: string, tags: string) => r(lemma, 'adj', tags);
const PL_GEN_LOC = 'p2m p2i p2f p2n p4m p6m p6i p6f p6n';
const PAT = () => r('päť', 'num', 's4n s1n p1f p4f p1i p4i p2f p2i p6f p6i p7f p7i');

describe('a rule decides only for the most frequent lemma of a word', () => {
  it('the conjunction a is never the letter a after an adjective, a number or a phrase', () => {
    const dlhe = () => adj('dlhý', 's1n s4n p1i p1f p1n p4i p4f p4n');
    const s = sentence(
      ['dni', r('deň', 'noun', 'p1 p4', 'm_inan')],
      ['sú', r('byť', 'verb', 'v:Kepc+')],
      ['dlhé', dlhe()],
      ['a', ...A()],
      ['príroda', r('príroda', 'noun', 's1', 'f')],
    );
    expect(after(s, 'a')).toHaveLength(11);
    expect(after(s, 'a')[0]).toBe('a conj');
    expect(after(s, 'dlhé')).toHaveLength(8);

    const years = sentence(
      ['pod', r('pod', 'prep')],
      ['nulou', r('nula', 'num', 's7f')],
      ['a', ...A()],
      '1098',
      ['a', ...A()],
      '1103',
    );
    expect(after(years, 'nulou')).toEqual(['nula s7f']);
    expect(after(years, 'a')[0]).toBe('a conj');
    expect(after(years, 'a', 1)).toHaveLength(11);
  });

  it('bol after a year and bola after ktorá stay the verb', () => {
    const s = sentence(
      ['v', r('v', 'prep')],
      ['roku', r('rok', 'noun', 's2 s3 s6', 'm_inan')],
      '1930',
      ['bol', r('byť', 'verb', 'v:Lescm+'), r('bola', 'noun', 'p2', 'f')],
      ['hosťom', r('hosť', 'noun', 's7', 'm_anim')],
    );
    expect(after(s, 'bol')).toEqual(['byť v:Lescm+', 'bola p2']);
    expect(after(s, 'roku')).toEqual(['rok s6']);

    const which = sentence(
      ['zásteru', r('zástera', 'noun', 's4', 'f')],
      ',',
      ['ktorá', r('ktorý', 'pron', 's1f')],
      ['bola', r('byť', 'verb', 'v:Lescf+'), r('bola', 'noun', 's1', 'f')],
      ['veľká', adj('veľký', 's1f')],
    );
    expect(after(which, 'bola')).toEqual(['byť v:Lescf+', 'bola s1']);
  });

  it('an adjective is no head, and a verb no modifier', () => {
    // dobré is also a noun (the good); the head of the phrase is halušky.
    const s = sentence(
      ['také', r('taký', 'pron', 's1n s4n p1f p4f p1i p4i')],
      ['dobré', adj('dobrý', 's1n s4n p1f p4f p1i p4i'), r('dobré', 'noun', 's1 s4', 'n')],
      ['halušky', r('haluška', 'noun', 's2 p1 p4', 'f')],
    );
    expect(after(s, 'také')).toEqual(['taký p1f', 'taký p4f']);
    expect(after(s, 'dobré')).toEqual(['dobrý p1f', 'dobrý p4f']);
    expect(after(s, 'halušky')).toEqual(['haluška p1', 'haluška p4']);

    // má is the verb before all else, not "my".
    const has = sentence(
      ['Kde', r('kde', 'adv')],
      ['má', r('mať', 'verb', 'v:Kesc+'), r('môj', 'pron', 's1f')],
      ['mama', r('mama', 'noun', 's1', 'f')],
    );
    expect(after(has, 'má')).toEqual(['mať v:Kesc+', 'môj s1f']);
  });

  it('a noun that is first of all a preposition, and a preposition that is first of all a noun', () => {
    // v jednom z nich: z is the preposition, not the letter after jednom.
    const s = sentence(
      ['v', r('v', 'prep')],
      ['jednom', r('jeden', 'num', 's6m s6i s6n')],
      ['z', r('z', 'prep'), r('z', 'noun', 's6 s2', 'n')],
    );
    expect(after(s, 'z')).toEqual(['z prep', 'z s6', 'z s2']);
    // s pomocou priateľov: pomocou is the noun pomoc first.
    const help = sentence(
      ['pomocou', r('pomoc', 'noun', 's7', 'f'), r('pomocou', 'prep')],
      ['priateľov', r('priateľ', 'noun', 'p2 p4', 'm_anim')],
    );
    expect(after(help, 'priateľov')).toEqual(['priateľ p2', 'priateľ p4']);
    expect(after(help, 'pomocou')).toHaveLength(2);
  });
});

describe('adverb readings are left for the model', () => {
  it('stále chladno, po taliansky, každé ráno', () => {
    const cold = sentence(
      ['bolo', r('byť', 'verb', 'v:Lescn+')],
      ['stále', r('stále', 'adv'), adj('stály', 's1n s4n p1f p4f')],
      ['chladno', r('chladno', 'noun', 's1 s4', 'n'), r('chladno', 'adv')],
    );
    expect(after(cold, 'stále')).toHaveLength(5);
    expect(after(cold, 'chladno')).toHaveLength(3);

    const italian = sentence(
      ['po', r('po', 'prep')],
      ['taliansky', adj('taliansky', 's1m s1i s4i'), r('taliansky', 'adv')],
    );
    expect(after(italian, 'taliansky')).toEqual(['taliansky s4i', 'taliansky adv']);

    const morning = sentence(
      ['každé', r('každý', 'pron', 's1n s4n p1f p4f')],
      ['ráno', r('ráno', 'noun', 's1 s4', 'n'), r('ráno', 'adv')],
    );
    expect(after(morning, 'každé')).toEqual(['každý s1n', 'každý s4n']);
    expect(after(morning, 'ráno')).toEqual(['ráno s1', 'ráno s4', 'ráno adv']);
  });
});

describe('pronouns', () => {
  const NEHO = () => [r('on', 'pron', 's2m s4m'), r('ono', 'pron', 's2n s4n')];
  it('a personal pronoun ends the phrase of its preposition', () => {
    const s = sentence(
      ['vedľa', r('vedľa', 'prep')],
      ['neho', ...NEHO()],
      ['pani', r('pani', 'noun', ALL_CASES, 'f')],
      ['Mária', r('Mária', 'noun', 's1', 'f')],
    );
    expect(after(s, 'neho')).toEqual(['on s2m', 'ono s2n']);
    expect(after(s, 'pani')).toHaveLength(6);
  });

  it('a phrase goes on after a pronoun only with a word that agrees with it', () => {
    const s = sentence(
      ['o', r('o', 'prep')],
      ['tom', r('ten', 'pron', 's6m s6i s6n')],
      ['nič', r('nič', 'pron', 'x1 x4'), r('nič', 'noun', ALL_CASES, 'n')],
      ['nevedel', r('nevedieť', 'verb', 'v:Lescm-')],
    );
    expect(after(s, 'tom')).toHaveLength(3);
    expect(after(s, 'nič')).toHaveLength(8);

    const shows = sentence(
      ['o', r('o', 'prep')],
      ['tom', r('ten', 'pron', 's6m s6i s6n')],
      ['podobnosť', r('podobnosť', 'noun', 's1 s4', 'f')],
    );
    expect(after(shows, 'podobnosť')).toEqual(['podobnosť s1', 'podobnosť s4']);

    const man = sentence(
      ['o', r('o', 'prep')],
      ['tom', r('ten', 'pron', 's6m s6i s6n')],
      ['človeku', r('človek', 'noun', 's3 s6', 'm_anim')],
    );
    expect(after(man, 'tom')).toEqual(['ten s6m']);
    expect(after(man, 'človeku')).toEqual(['človek s6']);
  });

  it('jeho after a preposition is possessive, before a bare noun it stays open', () => {
    const JEHO = () => [...NEHO(), r('jeho', 'pron', 's1m s2m s4m s6m s1f s4f')];
    const s = sentence(
      ['pre', r('pre', 'prep')],
      ['jeho', ...JEHO()],
      ['brata', r('brat', 'noun', 's2 s4', 'm_anim')],
    );
    expect(after(s, 'jeho')).toEqual(['jeho s4m']);
    expect(after(s, 'brata')).toEqual(['brat s4']);

    const gave = sentence(
      ['dal', r('dať', 'verb', 'v:Ldscm+')],
      ['jej', r('ona', 'pron', 's2f s3f'), r('jej', 'pron', 's1f s4f s2f')],
      ['knihu', r('kniha', 'noun', 's4', 'f')],
    );
    expect(after(gave, 'jej')).toHaveLength(5);

    // ho pocit: the object pronoun does not describe the subject.
    const feeling = sentence(
      ['Opantal', r('opantať', 'verb', 'v:Ldscm+')],
      ['ho', r('on', 'pron', 's4m s4i'), r('ono', 'pron', 's4n')],
      ['pocit', r('pocit', 'noun', 's1 s4', 'm_inan')],
    );
    expect(after(feeling, 'pocit')).toEqual(['pocit s1', 'pocit s4']);
  });

  it('ktorý after a comma opens a clause and describes no noun', () => {
    const s = sentence(
      ['model', r('model', 'noun', 's1 s4', 'm_inan')],
      ',',
      ['ktorý', r('ktorý', 'pron', 's1m s1i s4i')],
      ['učiteľ', r('učiteľ', 'noun', 's1', 'm_anim')],
      ['vytiahol', r('vytiahnuť', 'verb', 'v:Ldscm+')],
    );
    expect(after(s, 'ktorý')).toHaveLength(3);
    // At the start of a question it does.
    const q = sentence(
      ['Ktorý', r('ktorý', 'pron', 's1m s1i s4i')],
      ['učiteľ', r('učiteľ', 'noun', 's1', 'm_anim')],
    );
    expect(after(q, 'Ktorý')).toEqual(['ktorý s1m']);
  });
});

describe('numerals', () => {
  it('a quantity word in its dictionary form is the neuter singular and counts in the genitive', () => {
    const s = sentence(
      ['mám', r('mať', 'verb', 'v:Kesa+')],
      ['viac', r('viac', 'num', 's1n s4n p1f p4f p2f'), r('viac', 'adv')],
      ['energie', r('energia', 'noun', 's2 p1 p4', 'f')],
    );
    expect(after(s, 'viac')).toEqual(['viac s1n', 'viac s4n']);
    expect(after(s, 'energie')).toEqual(['energia s2']);

    const five = sentence(['päť', PAT()], ['žien', r('žena', 'noun', 'p2', 'f')]);
    expect(after(five, 'päť')).toEqual(['päť s4n', 'päť s1n']);
  });

  it('an ordinal or adjectival numeral is an adjective before its noun, not a quantity', () => {
    const s = sentence(
      ['jediné', r('jediný', 'num', 's1n s4n p1f p4f')],
      ['knihy', r('kniha', 'noun', 's2 p1 p4', 'f')],
    );
    expect(after(s, 'knihy')).toEqual(['kniha p1', 'kniha p4']);
    expect(after(s, 'jediné')).toEqual(['jediný p1f', 'jediný p4f']);
  });

  it('a declined numeral agrees with the counted noun in case', () => {
    const PIATICH = () => r('päť', 'num', PL_GEN_LOC);
    const period = sentence(
      ['obdobie', r('obdobie', 'noun', 's1 s4', 'n')],
      ['piatich', PIATICH()],
      ['rokov', r('rok', 'noun', 'p2', 'm_inan')],
    );
    expect(after(period, 'piatich')).toEqual(['päť p2i']);
    const days = sentence(
      ['po', r('po', 'prep')],
      ['piatich', PIATICH()],
      ['dňoch', r('deň', 'noun', 'p6', 'm_inan')],
    );
    expect(after(days, 'piatich')).toEqual(['päť p6i']);
    expect(after(days, 'dňoch')).toEqual(['deň p6']);
  });

  it('after a preposition with the accusative, the words after a number are genitive', () => {
    const states = sentence(
      ['pre', r('pre', 'prep')],
      '10',
      ['európskych', adj('európsky', PL_GEN_LOC)],
      ['štátov', r('štát', 'noun', 'p2', 'm_inan')],
    );
    expect(after(states, 'európskych')).toEqual(['európsky p2i']);

    const years = sentence(
      ['za', r('za', 'prep')],
      ['posledných', adj('posledný', PL_GEN_LOC)],
      ['päť', PAT()],
      ['rokov', r('rok', 'noun', 'p2', 'm_inan')],
    );
    expect(after(years, 'päť')).toEqual(['päť s4n']);
    expect(after(years, 'rokov')).toEqual(['rok p2']);
  });

  it('a number decides nothing when the phrase can stand in the case of its preposition', () => {
    const towns = sentence(
      ['v', r('v', 'prep')],
      '10',
      ['veľkých', adj('veľký', PL_GEN_LOC)],
      ['mestách', r('mesto', 'noun', 'p6', 'n')],
    );
    expect(after(towns, 'veľkých')).toEqual(['veľký p6n']);
    // v 11 storočí, written without the dot of the ordinal: locative singular or genitive plural.
    const century = sentence(['v', r('v', 'prep')], '11', [
      'storočí',
      r('storočie', 'noun', 's6 p2', 'n'),
    ]);
    expect(after(century, 'storočí')).toEqual(['storočie s6', 'storočie p2']);
  });

  it('a number counts no pronoun and no verb', () => {
    const s = sentence(
      ['roku', r('rok', 'noun', 's2 s6', 'm_inan')],
      '1939',
      ['ich', r('on', 'pron', 'p2m p4m'), r('ich', 'pron', 's1m p2m')],
      ['porazili', r('poraziť', 'verb', 'v:Ldpcm+')],
    );
    expect(after(s, 'ich')).toHaveLength(4);
  });
});
