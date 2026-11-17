import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINI_DIR, MINI_LEMMA_IDS } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl } from '../../lib/files';
import { readLines } from '../../lib/lines';
import { LemmaRegistry } from '../../lib/registry';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { morphStage } from '.';
import { buildMorphology, type FormOut, type LemmaOut, type MorphResult } from './build';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const SAMPLE = join(FIXTURES, 'snk-sample.txt');

/** Tables checked by hand against a Slovak grammar (form → tags). */
const GOLDEN: Record<string, Record<string, string>> = {
  mesto: {
    mesto: 's1 s4 s5',
    mesta: 's2',
    mestu: 's3',
    meste: 's6',
    mestom: 's7',
    mestá: 'p1 p4 p5',
    miest: 'p2',
    mestám: 'p3',
    mestách: 'p6',
    mestami: 'p7',
  },
  žena: {
    žena: 's1 s5',
    ženy: 's2 p1 p4 p5',
    žene: 's3 s6',
    ženu: 's4',
    ženou: 's7',
    žien: 'p2',
    ženám: 'p3',
    ženách: 'p6',
    ženami: 'p7',
  },
  chlap: {
    chlap: 's1 s5',
    chlapa: 's2 s4',
    chlapovi: 's3 s6',
    chlape: 's5',
    chlapom: 's7 p3',
    chlapi: 'p1 p5',
    chlapov: 'p2 p4',
    chlapoch: 'p6',
    chlapmi: 'p7',
  },
  stroj: {
    stroj: 's1 s4 s5',
    stroja: 's2',
    stroju: 's3',
    stroji: 's6',
    strojom: 's7 p3',
    stroje: 'p1 p4 p5',
    strojov: 'p2',
    strojoch: 'p6',
    strojmi: 'p7',
  },
  ulica: {
    ulica: 's1 s5',
    ulice: 's2 p1 p4 p5',
    ulici: 's3 s6',
    ulicu: 's4',
    ulicou: 's7',
    ulíc: 'p2',
    uliciam: 'p3',
    uliciach: 'p6',
    ulicami: 'p7',
  },
  dievča: {
    dievča: 's1 s4 s5',
    dievčaťa: 's2',
    dievčaťu: 's3',
    dievčati: 's6',
    dievčaťom: 's7',
    dievčatá: 'p1 p4 p5',
    dievčence: 'p1 p4 p5',
    dievčat: 'p2',
    dievčeniec: 'p2',
    dievčatám: 'p3',
    dievčencom: 'p3',
    dievčatách: 'p6',
    dievčencoch: 'p6',
    dievčatami: 'p7',
    dievčencami: 'p7',
  },
  ľudia: {
    ľudia: 'p1 p5',
    ľudí: 'p2 p4',
    ľuďom: 'p3',
    ľuďoch: 'p6',
    ľuďmi: 'p7',
  },
  múzeum: {
    múzeum: 's1 s4 s5',
    múzea: 's2',
    múzeu: 's3 s6',
    múzeom: 's7',
    múzeá: 'p1 p4 p5',
    múzeí: 'p2',
    múzeám: 'p3',
    múzeách: 'p6',
    múzeami: 'p7',
  },
  pekný: {
    pekný: 's1m s1i s4i s5m s5i',
    pekného: 's2m s2i s2n s4m',
    peknému: 's3m s3i s3n',
    peknom: 's6m s6i s6n',
    pekným: 's7m s7i s7n p3m p3i p3f p3n',
    pekná: 's1f s5f',
    peknej: 's2f s3f s6f',
    peknú: 's4f',
    peknou: 's7f',
    pekné: 's1n s4n s5n p1i p1f p1n p4i p4f p4n p5i p5f p5n',
    pekní: 'p1m p5m',
    pekných: 'p2m p2i p2f p2n p4m p6m p6i p6f p6n',
    peknými: 'p7m p7i p7f p7n',
  },
  ja: {
    ja: 'x1 x5',
    mňa: 'x2 x4',
    ma: 'x2 x4',
    mne: 'x3 x6',
    mi: 'x3',
    mnou: 'x7',
  },
};

function miniRegistry(): LemmaRegistry {
  return new LemmaRegistry(
    Object.entries(MINI_LEMMA_IDS)
      .map(([, id]) => id)
      .sort((a, b) => a - b)
      .map((id) => [id, MINI_KEYS.get(id) as string] as const),
  );
}

const MINI_KEYS = new Map<number, string>();

describe('buildMorphology on the SNK sample', () => {
  let result: MorphResult;
  let byLemma: Map<string, LemmaOut>;
  const formsOf = (lemma: string, pos = 'noun') => {
    const l = [...byLemma.values()].find((x) => x.lemma === lemma && x.pos === pos);
    if (!l) throw new Error(`no ${pos} ${lemma}`);
    return Object.fromEntries(
      result.forms.filter((f) => f.lemmaId === l.id).map((f) => [f.form, f.tags]),
    );
  };
  const lemmaOf = (key: string) => byLemma.get(key) as LemmaOut;

  beforeAll(async () => {
    for await (const l of readJsonl<{ id: number; key: string }>(join(MINI_DIR, 'lemmas.jsonl')))
      MINI_KEYS.set(l.id, l.key);
    result = await buildMorphology(readLines(SAMPLE), miniRegistry());
    byLemma = new Map(result.lemmas.map((l) => [l.key, l]));
  });

  it.each(Object.keys(GOLDEN))('matches the hand checked table of %s', (word) => {
    const pos = word === 'pekný' ? 'adj' : word === 'ja' ? 'pron' : 'noun';
    expect(formsOf(word, pos)).toEqual(GOLDEN[word]);
  });

  it('keeps the ids of the mini dataset', () => {
    for (const [word, id] of [
      ['mesto|noun|n|1', 20],
      ['žena|noun|f|1', 11],
      ['ľudia|noun|m_anim|1', 28],
      ['ten|pron||1', 42],
      ['kde|adv||1', 72],
      ['Bratislava|noun|f|1', 31],
    ] as const)
      expect(lemmaOf(word).id).toBe(id);
    // Lemmas outside the mini dataset get new numbers after the highest one.
    expect(lemmaOf('Marek|noun|m_anim|1').id).toBeGreaterThan(72);
  });

  it('maps parts of speech, genders, aspects and flags', () => {
    expect(lemmaOf('mesto|noun|n|1')).toMatchObject({
      pos: 'noun',
      gender: 'n',
      pattern: 'mesto',
      flags: {},
    });
    expect(lemmaOf('kúpiť|verb||1')).toMatchObject({ aspect: 'pf' });
    expect(lemmaOf('ísť|verb||1')).toMatchObject({ aspect: 'ipf' });
    expect(lemmaOf('Bratislava|noun|f|1').flags).toEqual({ proper: true });
    expect(lemmaOf('ľudia|noun|m_anim|1')).toMatchObject({
      flags: { irregular: true, pluralOnly: true },
    });
    expect(lemmaOf('ľudia|noun|m_anim|1').pattern).toBeUndefined();
    expect(lemmaOf('človek|noun|m_anim|1')).toMatchObject({
      pattern: 'chlap',
      flags: { irregular: true },
    });
    expect(lemmaOf('deň|noun|m_inan|1')).toMatchObject({
      pattern: 'stroj',
      flags: { irregular: true },
    });
    expect(lemmaOf('jeho|pron||1').flags).toEqual({ indeclinable: true });
    expect(lemmaOf('AIDS|other||1').flags).toEqual({});
    expect(lemmaOf('Bohunice|noun|f|1')).toMatchObject({
      pattern: 'ulica',
      flags: { proper: true, pluralOnly: true },
    });
  });

  it('keeps the cases a preposition governs in its flags', () => {
    expect(lemmaOf('do|prep||1').flags).toEqual({ cases: ['gen'] });
    expect(lemmaOf('na|prep||1').flags).toEqual({ cases: ['acc', 'loc'] });
    expect(lemmaOf('v|prep||1').flags).toEqual({ cases: ['acc', 'loc'] });
    expect(lemmaOf('s|prep||1').flags.cases).toEqual(['ins']);
    expect(formsOf('v', 'prep')).toEqual({ v: '', vo: '' });
  });

  it('files tá and to under ten, and gives kto and čo case only tags', () => {
    const ten = formsOf('ten', 'pron');
    expect(ten.tá).toBe('s1f s5f');
    expect(ten.to).toBe('s1n s4n s5n');
    expect(ten.ten).toBe('s1m s1i s4i s5m s5i');
    expect(byLemma.has('tá|pron||1')).toBe(false);
    expect(byLemma.has('to|part||1')).toBe(true);
    expect(formsOf('kto', 'pron')).toMatchObject({ kto: 'x1 x5', koho: 'x2 x4', kým: 'x7' });
    expect(formsOf('čo', 'pron')).toMatchObject({ čo: 'x1 x4 x5', čím: 'x7' });
  });

  it('assigns noun and adjective patterns by rule', () => {
    const pattern = (k: string) => lemmaOf(k).pattern;
    expect(pattern('chlap|noun|m_anim|1')).toBe('chlap');
    expect(pattern('hrdina|noun|m_anim|1')).toBe('hrdina');
    expect(pattern('kuli|noun|m_anim|1')).toBe('kuli');
    expect(pattern('dub|noun|m_inan|1')).toBe('dub');
    expect(pattern('stroj|noun|m_inan|1')).toBe('stroj');
    expect(pattern('žena|noun|f|1')).toBe('zena');
    expect(pattern('ulica|noun|f|1')).toBe('ulica');
    expect(pattern('dlaň|noun|f|1')).toBe('dlan');
    expect(pattern('kosť|noun|f|1')).toBe('kost');
    expect(pattern('gazdiná|noun|f|1')).toBe('gazdina');
    expect(pattern('srdce|noun|n|1')).toBe('srdce');
    expect(pattern('vysvedčenie|noun|n|1')).toBe('vysvedcenie');
    expect(pattern('dievča|noun|n|1')).toBe('dievca');
    expect(pattern('múzeum|noun|n|1')).toBe('mesto');
    expect(pattern('pekný|adj||1')).toBe('pekny');
    expect(pattern('cudzí|adj||1')).toBe('cudzi');
    expect(pattern('otcov|adj||1')).toBe('otcov');
  });

  it('drops errors and comparatives, and counts tags it cannot parse', () => {
    const s = result.stats;
    expect(s.dropped.misspelling).toBeGreaterThan(0); // *Mareka and the :q line
    expect(s.dropped.degree).toBeGreaterThan(0); // krajší, najkrajší
    expect(s.unparsedTags).toEqual({ XYZ: 1 });
    expect(s.malformedLines).toBe(1);
    expect(result.forms.some((f) => f.form.startsWith('*'))).toBe(false);
    expect(Object.keys(formsOf('pekný', 'adj'))).not.toContain('krajší');
    expect(byLemma.get('Testr|noun|f|1')?.flags.proper).toBe(true);
    expect(byLemma.has('Testq|noun|f|1')).toBe(false);
  });

  it('writes forms sorted by lemma id and form, with sorted tags', () => {
    const keys = result.forms.map((f: FormOut) => [f.lemmaId, f.form] as const);
    const sorted = [...keys].sort(
      (a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0),
    );
    expect(keys).toEqual(sorted);
  });
});

describe('the morph stage', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  it('runs from the file, starts the registry from the mini ids, and a second run changes nothing', async () => {
    const ctx = t.ctx({ input: SAMPLE, mini: MINI_DIR, measure: 'off' });
    const first = await runStage(morphStage, ctx);
    expect(first.skipped).toBe(false);
    const files = ['lemmas.jsonl', 'forms.jsonl', 'report.md', 'report.json'].map((f) =>
      join(t.paths.build, 'morph', f),
    );
    const snapshot = async () =>
      Promise.all([...files, t.paths.registry].map((f) => readFile(f, 'utf8')));
    const before = await snapshot();
    const registry = LemmaRegistry.parse(before[4] as string);
    expect(registry.idOf('mesto|noun|n|1')).toBe(20);
    expect(registry.keyOf(1)).toBe('chlap|noun|m_anim|1');

    // Unchanged inputs: the runner skips the stage.
    expect((await runStage(morphStage, ctx)).skipped).toBe(true);
    // Forced: the stage runs again and writes identical files.
    expect((await runStage(morphStage, ctx, { force: true })).skipped).toBe(false);
    expect(await snapshot()).toEqual(before);

    const report = await readFile(files[2] as string, 'utf8');
    expect(report).toContain('## 50 random nouns');
    expect(report).toContain('| `XYZ` | 1 |');
    // The sample holds only some mini lemmas: the others show up as retired, their forms as missing.
    expect(report).toContain('2 kamarát|noun|m_anim|1 → kamarát|noun|m_anim|1 (retired)');
    expect(report).toContain('| 2 | kamarát | s1 s5 | (missing) |');
    expect(report).not.toMatch(/^\| 20 \| .*\(missing\)/mu);
  });

  it.skipIf(!hasXz())('reads the SNK file compressed with xz', async () => {
    const result = await buildMorphology(
      readLines(join(FIXTURES, 'snk-mesto.txt.xz')),
      new LemmaRegistry(),
    );
    expect(result.forms.map((f) => f.form)).toContain('miest');
  });
});

function hasXz(): boolean {
  try {
    execFileSync('xz', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
