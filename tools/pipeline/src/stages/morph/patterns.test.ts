import { loadMini } from '@app/testkit/mini';
import { describe, expect, it } from 'vitest';
import { LEMMA_OVERRIDES } from './overrides';
import { assignAdjPattern, assignNounPattern, choosePattern, testPattern } from './patterns';
import { compareTags, mapSnk } from './snk';

const mini = loadMini();

function slotsOf(lemmaId: number): Map<string, string[]> {
  const slots = new Map<string, string[]>();
  for (const f of mini.formsByLemma.get(lemmaId) ?? [])
    for (const t of f.tags.split(' ')) if (t) slots.set(t, [...(slots.get(t) ?? []), f.form]);
  return slots;
}

const PARADIGM: Record<string, string> = { kuli: 'F', gazdiná: 'F' };

describe('noun patterns', () => {
  const nouns = mini.lemmas.filter((l) => l.pos === 'noun' && !LEMMA_OVERRIDES[l.key]?.noPattern);

  it.each(nouns.map((l) => [l.lemma, l] as const))(
    'gives %s the pattern and flag of the mini dataset',
    (_, l) => {
      const r = assignNounPattern({
        lemma: l.lemma,
        gender: l.gender as NonNullable<typeof l.gender>,
        paradigm: PARADIGM[l.lemma] ?? 'S',
        slots: slotsOf(l.id),
      });
      expect(r.pattern).toBe(l.pattern);
      // človek is irregular by hand (its plural is ľudia); the rules flag deň themselves.
      const handFlag = LEMMA_OVERRIDES[l.key]?.flags?.irregular ?? false;
      expect(r.irregular || handFlag).toBe(l.flags.irregular ?? false);
    },
  );

  it('flags deň: its plural does not follow stroj', () => {
    expect(testPattern('stroj', slotsOf(30))).toEqual(['p1']);
  });

  it('leaves adjectival and indeclinable nouns without a pattern, and flags nouns no rule fits', () => {
    const slots = new Map([['s1', ['vedúci']]]);
    expect(assignNounPattern({ lemma: 'vedúci', gender: 'm_anim', paradigm: 'A', slots })).toEqual({
      irregular: false,
      reason: 'adjectival',
    });
    expect(assignNounPattern({ lemma: 'kupé', gender: 'n', paradigm: 'U', slots })).toMatchObject({
      reason: 'indeclinable',
    });
    expect(
      assignNounPattern({
        lemma: 'pani',
        gender: 'f',
        paradigm: 'S',
        slots: new Map([['s1', ['pani']]]),
      }),
    ).toEqual({ irregular: true, reason: 'no rule' });
  });

  it('decides plural only nouns by the nominative plural', () => {
    const p = (gender: 'f' | 'n' | 'm_inan', p1: string) =>
      choosePattern({ lemma: p1, gender, paradigm: 'S', slots: new Map([['p1', [p1]]]) });
    expect(p('f', 'Atény')).toBe('zena');
    expect(p('f', 'Bohunice')).toBe('ulica');
    expect(p('n', 'ústa')).toBe('mesto');
    expect(p('m_inan', 'Brezany')).toBe('dub');
  });
});

describe('adjective patterns', () => {
  it('follows the nominative ending and the SNK paradigm', () => {
    const none = new Map<string, string[]>();
    expect(assignAdjPattern({ lemma: 'pekný', paradigm: 'A', slots: none }).pattern).toBe('pekny');
    expect(assignAdjPattern({ lemma: 'krásny', paradigm: 'A', slots: none }).pattern).toBe('pekny');
    expect(assignAdjPattern({ lemma: 'cudzí', paradigm: 'A', slots: none }).pattern).toBe('cudzi');
    expect(assignAdjPattern({ lemma: 'pracujúci', paradigm: 'k', slots: none }).pattern).toBe(
      'cudzi',
    );
    expect(
      assignAdjPattern({ lemma: 'otcov', paradigm: 'F', slots: new Map([['s2m', ['otcovho']]]) }),
    ).toEqual({
      pattern: 'otcov',
      irregular: false,
    });
    expect(assignAdjPattern({ lemma: 'rád', paradigm: 'U', slots: none })).toEqual({
      irregular: false,
    });
  });
});

describe('mapSnk', () => {
  it('maps every word class of the tagset', () => {
    expect(mapSnk('mesto', 'mestá', 'SSnp1')).toMatchObject({
      pos: 'noun',
      gender: 'n',
      tag: 'p1',
      paradigm: 'S',
    });
    expect(mapSnk('chlap', 'chlapa', 'SSms2')).toMatchObject({ gender: 'm_anim', tag: 's2' });
    expect(mapSnk('dub', 'duba', 'SSis2')).toMatchObject({ gender: 'm_inan' });
    expect(mapSnk('pekný', 'peknú', 'AAfs4x')).toMatchObject({ pos: 'adj', tag: 's4f' });
    expect(mapSnk('robený', 'robených', 'Gtip2x')).toMatchObject({
      pos: 'adj',
      tag: 'p2i',
      paradigm: 't',
    });
    expect(mapSnk('ja', 'mne', 'PPhs3')).toMatchObject({ pos: 'pron', tag: 'x3', general: true });
    expect(mapSnk('on', 'ho', 'PFms2')).toMatchObject({ pos: 'pron', tag: 's2m' });
    expect(mapSnk('kde', 'kde', 'PD')).toMatchObject({ pos: 'adv', tag: '' });
    expect(mapSnk('päť', 'piatich', 'NUmp2')).toMatchObject({ pos: 'num', tag: 'p2m' });
    expect(mapSnk('prvýkrát', 'prvýkrát', 'ND')).toMatchObject({ pos: 'adv' });
    expect(mapSnk('kúpiť', 'kúpil', 'VLdscm+')).toMatchObject({
      pos: 'verb',
      tag: 'v:Ldscm+',
      aspect: 'pf',
    });
    expect(mapSnk('byť', 'byť', 'VIe+')).toMatchObject({ aspect: 'ipf', verbForm: 'I' });
    expect(mapSnk('veľmi', 'veľmi', 'Dx')).toMatchObject({ pos: 'adv', tag: '' });
    expect(mapSnk('na', 'na', 'Eu6')).toMatchObject({ pos: 'prep', governs: 'loc' });
    expect(mapSnk('a', 'a', 'O')).toMatchObject({ pos: 'conj' });
    expect(mapSnk('aby', 'aby', 'OY')).toMatchObject({ pos: 'conj' });
    expect(mapSnk('nie', 'nie', 'T')).toMatchObject({ pos: 'part' });
    expect(mapSnk('ahoj', 'ahoj', 'J')).toMatchObject({ pos: 'intj' });
    expect(mapSnk('sa', 'sa', 'R')).toMatchObject({ pos: 'other' });
    expect(mapSnk('km', 'km', 'W')).toMatchObject({ pos: 'other' });
  });

  it('drops errors and comparatives, flags proper names, and refuses unknown tags', () => {
    expect(mapSnk('Marek', '*Mareka', 'SSms2')).toEqual({ ok: false, reason: 'misspelling' });
    expect(mapSnk('*blbý', 'blbý', 'AAms1x')).toEqual({ ok: false, reason: 'misspelling' });
    expect(mapSnk('zhrzený', 'zhrzený', 'AAms1x:q')).toEqual({ ok: false, reason: 'misspelling' });
    expect(mapSnk('pekný', 'krajší', 'AAms1y')).toEqual({ ok: false, reason: 'degree' });
    expect(mapSnk('draho', 'drahšie', 'Dy')).toEqual({ ok: false, reason: 'degree' });
    expect(mapSnk('Emil', 'Emil', 'SSms1:r')).toMatchObject({ ok: true, proper: true });
    expect(mapSnk('x', 'x', 'SSzs1')).toEqual({ ok: false, reason: 'unparsed' });
    expect(mapSnk('x', 'x', 'Kx')).toEqual({ ok: false, reason: 'unparsed' });
  });

  it('orders tags by number, case and gender, verbs last', () => {
    expect(['p4', 's5', 'p1', 's1'].sort(compareTags)).toEqual(['s1', 's5', 'p1', 'p4']);
    expect(['s1n', 's1f', 's1m', 's1i'].sort(compareTags)).toEqual(['s1m', 's1i', 's1f', 's1n']);
    expect(['v:Kesc+', 'x1', 's2'].sort(compareTags)).toEqual(['s2', 'x1', 'v:Kesc+']);
  });
});
