// The pruning rules on hand-built sentences. Every case here is one the treebank showed the
// rules getting wrong on the full dictionary: a rare homograph taken for the common word, a
// phrase carried past its end, a numeral read in the wrong case. Each word lists its readings
// as the dictionary gives them, the most frequent lemma first.
import type { Case, Gender, Pos } from '@app/contracts';
import { readTag } from '@app/ling';
import { describe, expect, it } from 'vitest';
import type { TriggerFacts } from './repo';
import { applyRules, assignTriggers, indexTriggers, type Option, type WorkSentence } from './rules';

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
const verb = (lemma: string, c: Case, id = lemma): TriggerFacts => ({
  id: `verb-${id}`,
  kind: 'verb',
  lemma,
  lemmaId: idOf(lemma, 'verb'),
  case: c,
});
const TRIGGERS = indexTriggers([
  ...prep('s', 'ins'),
  ...prep('na', 'acc', 'loc'),
  verb('byť', 'nom', 'byt-nom'),
  verb('byť', 'ins', 'byt-ins'),
  verb('mať', 'acc'),
  verb('chcieť', 'acc'),
  verb('vidieť', 'acc'),
  verb('čítať', 'acc'),
  verb('robiť', 'acc'),
  verb('piť', 'acc'),
  verb('jesť', 'acc'),
  verb('čakať', 'acc'),
  verb('platiť', 'acc'),
  verb('písať', 'acc'),
  verb('pomáhať', 'dat'),
  verb('zúčastniť', 'gen'),
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

  it('jej after a preposition is possessive also where the personal pronoun has no such case', () => {
    // The most frequent lemma of jej is ona, which has no locative jej: after a preposition
    // the personal pronoun would be nej.
    const s = sentence(
      ['v', r('v', 'prep')],
      ['jej', r('ona', 'pron', 's2f s3f'), r('jej', 'pron', 's1f s2f s3f s4f s6f s1n')],
      ['kuchyni', r('kuchyňa', 'noun', 's3 s6', 'f')],
    );
    expect(after(s, 'jej')).toEqual(['jej s6f']);
    expect(after(s, 'kuchyni')).toEqual(['kuchyňa s6']);

    // Later in the phrase it can be the object: po ktorej ich viedol.
    const led = sentence(
      ['po', r('po', 'prep')],
      ['ktorej', r('ktorý', 'pron', 's2f s3f s6f')],
      ['ich', r('on', 'pron', 'p2m p4m'), r('ich', 'pron', 's1f s4f s6f p4m')],
      ['viedol', r('viesť', 'verb', 'v:Lescm+')],
    );
    expect(after(led, 'ich')).toHaveLength(6);
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

// The verb named as the reason for a case. Every word has its one reading here, as it has
// when the triggers are assigned. Each case is one the library texts or the treebank showed
// the nearest listed verb getting wrong.
describe('the verb that asks for a case', () => {
  const v = (lemma: string, tag: string) => r(lemma, 'verb', `v:${tag}`);
  const n = (lemma: string, tag: string, gender: Gender = 'm_inan') =>
    r(lemma, 'noun', tag, gender);
  const pron = (lemma: string, tag: string) => r(lemma, 'pron', tag);
  const CONJ = (lemma: string) => r(lemma, 'conj');
  const ADV = (lemma: string) => r(lemma, 'adv');

  /** The reason of each word that has one, as `word<trigger word:rule`. */
  function reasons(s: WorkSentence): string[] {
    assignTriggers(s, applyRules(s, TRIGGERS), TRIGGERS);
    return s.words.flatMap((w, i) =>
      w?.trig ? [`${s.texts[i]}<${s.texts[w.trig.i ?? -1]}:${w.trig.id}`] : [],
    );
  }

  it('a conjunction between two verbs ends the clause, one between two nouns does not', () => {
    const s = sentence(
      ['Čítam', v('čítať', 'Kesa+')],
      ['knihu', n('kniha', 's4', 'f')],
      ['a', CONJ('a')],
      ['potom', ADV('potom')],
      ['mám', v('mať', 'Kesa+')],
      ['stretnutie', n('stretnutie', 's4', 'n')],
    );
    expect(reasons(s)).toEqual(['knihu<Čítam:verb-čítať', 'stretnutie<mám:verb-mať']);

    const drinks = sentence(
      ['pijú', v('piť', 'Kepc+')],
      ['víno', n('víno', 's4', 'n')],
      ['alebo', CONJ('alebo')],
      ['punč', n('punč', 's4')],
      ['a', CONJ('a')],
      ['jedia', v('jesť', 'Kepc+')],
      ['jedlá', n('jedlo', 'p4', 'n')],
    );
    expect(reasons(drinks)).toEqual([
      'víno<pijú:verb-piť',
      'punč<pijú:verb-piť',
      'jedlá<jedia:verb-jesť',
    ]);

    // The subject of a verb without a rule is no nominative of the next clause's byť.
    const sun = sentence(
      ['Svietilo', v('svietiť', 'Lescn+')],
      ['slnko', n('slnko', 's1', 'n')],
      ['a', CONJ('a')],
      ['bolo', v('byť', 'Lescn+')],
      ['teplo', n('teplo', 's1', 'n')],
    );
    expect(reasons(sun)).toEqual(['teplo<bolo:verb-byt-nom']);
  });

  it('a hyphen inside a word ends no clause', () => {
    const s = sentence(
      ['čítam', v('čítať', 'Kesa+')],
      ['e', r('e', 'noun', 's1 s4', 'n')],
      '-',
      ['maily', n('mail', 'p4')],
      ['a', CONJ('a')],
      ['mám', v('mať', 'Kesa+')],
      ['stretnutie', n('stretnutie', 's4', 'n')],
    );
    // e-maily: the three tokens touch.
    const [e, hyphen, maily] = [s.tokens[1], s.tokens[2], s.tokens[3]];
    if (!e || !hyphen || !maily) throw new Error('no tokens');
    hyphen.s = e.e;
    hyphen.e = hyphen.s + 1;
    maily.s = hyphen.e;
    s.words[1] = {
      options: r('e', 'noun', 's4', 'n').map((o) => ({ ...o, form: 'e' })),
      initial: 1,
    };
    expect(reasons(s)).toContain('maily<čítam:verb-čítať');
  });

  it('som and sme beside a past form, and budem before an infinitive, are no byť', () => {
    const talked = sentence(
      ['my', pron('my', 'x1')],
      ['sme', v('byť', 'Kepa+')],
      ['mali', v('mať', 'Lepah+')],
      ['problém', n('problém', 's4')],
    );
    expect(reasons(talked)).toEqual(['problém<mali:verb-mať']);

    const students = sentence(
      ['my', pron('my', 'x1')],
      ['sme', v('byť', 'Kepa+')],
      ['študenti', n('študent', 'p1', 'm_anim')],
    );
    expect(reasons(students)).toEqual(['my<sme:verb-byt-nom', 'študenti<sme:verb-byt-nom']);

    const will = sentence(
      ['ja', pron('ja', 'x1')],
      ['budem', v('byť', 'Besa+')],
      ['čítať', v('čítať', 'Ie+')],
      ['knihu', n('kniha', 's4', 'f')],
    );
    expect(reasons(will)).toEqual(['knihu<čítať:verb-čítať']);

    // The past form after the next conjunction belongs to another clause.
    const made = sentence(
      ['Čítala', v('čítať', 'Lesaf+')],
      ['som', v('byť', 'Kesa+')],
      ['knihu', n('kniha', 's4', 'f')],
      ['a', CONJ('a')],
      ['zaspala', v('zaspať', 'Ldsaf+')],
    );
    expect(reasons(made)).toEqual(['knihu<Čítala:verb-čítať']);
  });

  it('a negated verb has the rules of its verb', () => {
    const s = sentence(['Nemám', v('nemať', 'Kesa-')], ['čas', n('čas', 's4')]);
    expect(reasons(s)).toEqual(['čas<Nemám:verb-mať']);
    const was = sentence(
      ['Nebolo', v('nebyť', 'Lescn-')],
      ['to', pron('ten', 's1n')],
      ['ľahké', adj('ľahký', 's1n')],
    );
    expect(reasons(was)).toEqual(['to<Nebolo:verb-byt-nom', 'ľahké<Nebolo:verb-byt-nom']);
  });

  it('a verb with an infinitive after it leaves the object to that verb', () => {
    // ako ich mám brať: brať has no rule, and mám is not the reason.
    const take = sentence(
      ['ako', ADV('ako')],
      ['ich', pron('on', 'p4m')],
      ['mám', v('mať', 'Kesa+')],
      ['brať', v('brať', 'Ie+')],
    );
    expect(reasons(take)).toEqual([]);

    const learn = sentence(
      ['že', CONJ('že')],
      ['ich', pron('on', 'p4m')],
      ['chcem', v('chcieť', 'Kesa+')],
      ['naučiť', v('naučiť', 'Id+')],
      ['robiť', v('robiť', 'Ie+')],
    );
    expect(reasons(learn)).toEqual(['ich<robiť:verb-robiť']);

    // A noun that takes the infinitive is the object of the first verb.
    const time = sentence(
      ['Mám', v('mať', 'Kesa+')],
      ['čas', n('čas', 's4')],
      ['čítať', v('čítať', 'Ie+')],
      ['knihy', n('kniha', 'p4', 'f')],
    );
    expect(reasons(time)).toEqual(['čas<Mám:verb-mať', 'knihy<čítať:verb-čítať']);

    const book = sentence(
      ['Knihu', n('kniha', 's4', 'f')],
      ['chcem', v('chcieť', 'Kesa+')],
      ['čítať', v('čítať', 'Ie+')],
    );
    expect(reasons(book)).toEqual(['Knihu<čítať:verb-čítať']);
  });

  it('a nearer verb without a rule for the case is the likelier reason', () => {
    const s = sentence(
      ['túžba', n('túžba', 's1', 'f')],
      ['robiť', v('robiť', 'Ie+')],
      ['hlúposti', n('hlúposť', 'p4', 'f')],
      ['ma', pron('ja', 'x4')],
      ['neopustila', v('neopustiť', 'Ldscf-')],
    );
    expect(reasons(s)).toEqual(['hlúposti<robiť:verb-robiť']);

    // musím only carries the infinitive.
    const must = sentence(
      ['Musím', v('musieť', 'Kesa+')],
      ['ho', pron('on', 's4m')],
      ['vidieť', v('vidieť', 'Ie+')],
    );
    expect(reasons(must)).toEqual(['ho<vidieť:verb-vidieť']);
  });

  it('the words after ako stand in the case of what they are compared with', () => {
    const s = sentence(
      ['Je', v('byť', 'Kesc+')],
      ['to', pron('ten', 's1n')],
      ['lepšie', ADV('lepšie')],
      ['ako', CONJ('ako')],
      ['hodina', n('hodina', 's1', 'f')],
    );
    expect(reasons(s)).toEqual(['to<Je:verb-byt-nom']);

    const child = sentence(
      ['Ako', CONJ('ako')],
      ['dieťa', n('dieťa', 's1', 'n')],
      ['mal', v('mať', 'Lescm+')],
      ['psa', n('pes', 's4', 'm_anim')],
    );
    expect(reasons(child)).toEqual(['psa<mal:verb-mať']);
  });

  it('an accusative of time is no object', () => {
    const month = sentence(
      ['platím', v('platiť', 'Kesa+')],
      ['každý', pron('každý', 's4i')],
      ['mesiac', n('mesiac', 's4')],
    );
    expect(reasons(month)).toEqual([]);

    const hour = sentence(
      ['čakať', v('čakať', 'Ie+')],
      ['skoro', ADV('skoro')],
      ['hodinu', n('hodina', 's4', 'f')],
    );
    expect(reasons(hour)).toEqual([]);

    // mať takes a unit of time as its object: mal som desať rokov, mám hodinu.
    const lesson = sentence(['Mám', v('mať', 'Kesa+')], ['hodinu', n('hodina', 's4', 'f')]);
    expect(reasons(lesson)).toEqual(['hodinu<Mám:verb-mať']);

    // The pronoun before a time is the object: čakal ho hodinu.
    const him = sentence(
      ['čakal', v('čakať', 'Lescm+')],
      ['ho', pron('on', 's4m')],
      ['hodinu', n('hodina', 's4', 'f')],
    );
    expect(reasons(him)).toEqual(['ho<čakal:verb-čakať']);
  });

  it('a genitive right after a noun belongs to that noun', () => {
    const s = sentence(
      ['Zúčastnili', v('zúčastniť', 'Ldpcm+')],
      ['sa', r('sa', 'other')],
      ['stretnutia', n('stretnutie', 's2', 'n')],
      ['chovanci', n('chovanec', 'p1', 'm_anim')],
      ['ústavu', n('ústav', 's2')],
    );
    expect(reasons(s)).toEqual(['stretnutia<Zúčastnili:verb-zúčastniť']);
  });

  it('an instrumental with byť is a job or a role only where it is said of the subject', () => {
    const doctor = sentence(
      ['Otec', n('otec', 's1', 'm_anim')],
      ['je', v('byť', 'Kesc+')],
      ['dobrým', adj('dobrý', 's7m')],
      ['lekárom', n('lekár', 's7', 'm_anim')],
    );
    expect(reasons(doctor)).toEqual([
      'Otec<je:verb-byt-nom',
      'dobrým<je:verb-byt-ins',
      'lekárom<je:verb-byt-ins',
    ]);

    const snow = sentence(
      ['Hory', n('hora', 'p1', 'f')],
      ['sú', v('byť', 'Kepc+')],
      ['pokryté', adj('pokrytý', 'p1f')],
      ['snehom', n('sneh', 's7')],
    );
    expect(reasons(snow)).toEqual(['Hory<sú:verb-byt-nom', 'pokryté<sú:verb-byt-nom']);

    const car = sentence(
      ['Je', v('byť', 'Kesc+')],
      ['to', pron('ten', 's1n')],
      ['autom', n('auto', 's7', 'n')],
      ['hodina', n('hodina', 's1', 'f')],
    );
    expect(reasons(car)).toEqual(['to<Je:verb-byt-nom', 'hodina<Je:verb-byt-nom']);

    // The subject between the verb and what is said of it: je Malta členom.
    const member = sentence(
      ['je', v('byť', 'Kesc+')],
      ['Malta', n('Malta', 's1', 'f')],
      ['členom', n('člen', 's7', 'm_anim')],
    );
    expect(reasons(member)).toEqual(['Malta<je:verb-byt-nom', 'členom<je:verb-byt-ins']);
  });

  it('a noun joined to the phrase after a preposition has the reason of that phrase', () => {
    const bread = sentence(
      ['Je', v('byť', 'Kesc+')],
      ['s', r('s', 'prep')],
      ['chlebom', n('chlieb', 's7')],
      ['a', CONJ('a')],
      ['čerstvým', adj('čerstvý', 's7n')],
      ['maslom', n('maslo', 's7', 'n')],
    );
    expect(reasons(bread)).toEqual([
      'chlebom<s:prep-s-ins',
      'čerstvým<s:prep-s-ins',
      'maslom<s:prep-s-ins',
    ]);

    // In the accusative the joined noun can be a second object: it gets no reason at all.
    const gift = sentence(
      ['Mám', v('mať', 'Kesa+')],
      ['darček', n('darček', 's4')],
      ['pre', r('pre', 'prep')],
      ['mamu', n('mama', 's4', 'f')],
      ['a', CONJ('a')],
      ['sestru', n('sestra', 's4', 'f')],
    );
    expect(reasons(gift)).toEqual(['darček<Mám:verb-mať', 'mamu<pre:prep-pre-acc']);

    // A pronoun that opens a clause after a comma joins nothing: na to, čo vidím.
    const what = sentence(
      ['na', r('na', 'prep')],
      ['to', pron('ten', 's4n')],
      ',',
      ['čo', pron('čo', 'x4')],
      ['vidím', v('vidieť', 'Kesa+')],
    );
    expect(reasons(what)).toEqual(['to<na:prep-na-acc', 'čo<vidím:verb-vidieť']);
  });

  it('a name after the noun it names keeps the nominative', () => {
    const s = sentence(
      ['bol', v('byť', 'Lescm+')],
      ['šéfom', n('šéf', 's7', 'm_anim')],
      ['týždenníka', n('týždenník', 's2')],
      ['Október', n('október', 's1')],
    );
    expect(reasons(s)).toEqual(['šéfom<bol:verb-byt-ins']);
  });
});
