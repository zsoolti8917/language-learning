import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { mapSnk } from '../morph/snk';
import { freqOut, freqStage, topFormsCheck } from '.';
import { FreqBuilder, fitTag, isRankable, MorphIndex, parseLemmaPos, topForms } from './rank';
import { FREQ_FIXTURES, seedFreqSample } from './sample';

/** The top 30 of the full run (docs/handoff/C2.md); the sample reproduces it exactly. */
const TOP_30 = [
  'byť|verb||1',
  'a|conj||1',
  'ten|pron||1',
  'sa|other||1',
  'v|prep||1',
  'na|prep||1',
  'že|conj||1',
  'si|other||1',
  's|prep||1',
  'mať|verb||1',
  'ako|conj||1',
  'z|prep||1',
  'ktorý|pron||1',
  'on|pron||1',
  'do|prep||1',
  'o|prep||1',
  'ja|pron||1',
  'čo|pron||1',
  'ale|conj||1',
  'môcť|verb||1',
  'nie|part||1',
  'aj|part||1',
  'pre|prep||1',
  'za|prep||1',
  'svoj|pron||1',
  'všetok|pron||1',
  'k|prep||1',
  'len|part||1',
  'ona|pron||1',
  'už|part||1',
];

interface Ranked {
  id: number;
  freqRank: number;
  topForms: { form: string; tag: string; share: number }[];
}

describe('freq on the sample', () => {
  let t: TempRoot;
  let rows: Ranked[];
  const keyOf = new Map<number, string>();

  beforeAll(async () => {
    t = await tempRoot();
    await seedFreqSample(t.paths);
    await runStage(freqStage, t.ctx());
    rows = [];
    for await (const r of readJsonl<Ranked>(freqOut(t.paths, 'lemmas.jsonl'))) rows.push(r);
    for await (const l of readJsonl<{ id: number; key: string }>(
      join(FREQ_FIXTURES, 'lemmas.jsonl'),
    ))
      keyOf.set(l.id, l.key);
  }, 60_000);
  afterAll(() => t.remove());

  it('ranks common function and core words highest (snapshot of the full run)', () => {
    const top = rows.slice(0, 30).map((r) => keyOf.get(r.id));
    expect(top).toEqual(TOP_30);
    expect(rows.map((r) => r.freqRank)).toEqual(rows.map((_, i) => i + 1));
  });

  it('gives each lemma at most four top forms whose shares sum to at most 1', async () => {
    const forms = new Map<string, string[]>();
    for await (const f of readJsonl<{ lemmaId: number; form: string; tags: string }>(
      join(FREQ_FIXTURES, 'forms.jsonl'),
    ))
      forms.set(`${f.lemmaId}|${f.form}`, f.tags.split(' ').filter(Boolean));
    let checked = 0;
    for (const r of rows) {
      expect(r.topForms.length).toBeLessThanOrEqual(4);
      const sum = r.topForms.reduce((a, f) => a + f.share, 0);
      expect(sum).toBeLessThanOrEqual(1);
      for (const f of r.topForms) {
        const tags = forms.get(`${r.id}|${f.form}`);
        expect(tags, `${keyOf.get(r.id)} ${f.form}`).toBeDefined();
        if (f.tag === '') expect(tags).toEqual([]);
        else expect(tags).toContain(f.tag);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(400);
    const byt = rows.find((r) => keyOf.get(r.id) === 'byť|verb||1');
    expect(byt?.topForms[0]).toMatchObject({ form: 'je', tag: 'v:Kesc+' });
    const mesto = rows.find((r) => keyOf.get(r.id) === 'mesto|noun|n|1');
    expect(mesto?.topForms.map((f) => f.tag)).toContain('s2');
  });

  it('writes a report and skips an unchanged rerun', async () => {
    const report = await readFile(freqOut(t.paths, 'report.md'), 'utf8');
    expect(report).toContain('| 1 | byť | verb |');
    const again = await runStage(freqStage, t.ctx());
    expect(again.skipped).toBe(true);
  });
});

describe('ranking rules', () => {
  const lemma = (id: number, key: string) => {
    const [l, pos] = key.split('|') as [string, string];
    return { id, key, lemma: l, pos: pos as 'verb' };
  };

  it('splits a form two lemmas share in proportion to the lemma list', async () => {
    const index = new MorphIndex();
    index.addLemma(lemma(1, 'byť|verb||1'));
    index.addLemma(lemma(2, 'jesť|verb||1'));
    index.addForm({ lemmaId: 1, form: 'je', tags: 'v:Kesc+' });
    index.addForm({ lemmaId: 2, form: 'je', tags: 'v:Kesc+' });
    index.addForm({ lemmaId: 2, form: 'jesť', tags: 'v:Ie+' });
    const b = new FreqBuilder(index);
    await b.readLemmaPos(['byťV\t900\t90\t0.5', 'jesťV\t100\t10\t0.5']);
    await b.readWordTag([
      'je\tVKesc+\t1000\t100\t0.5',
      'Je\tVKesc+\t10\t10\t0.5',
      'jesť\tVIe+\t5\t5\t0.5',
    ]);
    await b.readSubtitles(['je 1000', 'jesť 50']);
    const r = b.finish();
    const byId = new Map(r.scored.map((x) => [x.id, x]));
    expect(byId.get(1)?.web).toBeCloseTo(99);
    expect(byId.get(2)?.web).toBeCloseTo(11 + 5);
    expect(byId.get(1)?.sub).toBeCloseTo(1000 * (99 / 110));
    expect(r.rows[0]?.id).toBe(1);
    expect(r.stats.ambiguousRows).toBe(2);
  });

  it('blends the ranks as a weighted geometric mean', async () => {
    const index = new MorphIndex();
    for (const [id, w] of [
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ] as const) {
      index.addLemma({ id, key: `${w}|conj||1`, lemma: w, pos: 'conj' });
      index.addForm({ lemmaId: id, form: w, tags: '' });
    }
    const b = new FreqBuilder(index);
    // web: a > b > c; subtitles: c > b, a missing.
    await b.readWordTag(['a\tO\t9\t300\t1', 'b\tO\t9\t200\t1', 'c\tO\t9\t100\t1']);
    await b.readSubtitles(['c 500', 'b 400']);
    const r = b.finish();
    const s = new Map(r.scored.map((x) => [x.id, x]));
    expect(s.get(1)).toMatchObject({ webRank: 1, subRank: 3 });
    expect(s.get(2)).toMatchObject({ webRank: 2, subRank: 2 });
    expect(s.get(3)).toMatchObject({ webRank: 3, subRank: 1 });
    // a: 0.4 ln 3 = 0.44; c: 0.6 ln 3 = 0.66; b: 0.6 ln 2 + 0.4 ln 2 = 0.69.
    expect(r.scored.map((x) => x.id)).toEqual([1, 3, 2]);
    expect(s.get(2)?.score).toBeCloseTo(Math.log(2));
  });

  it('leaves out names, retired lemmas and symbols, but keeps sa and si', () => {
    expect(
      isRankable({
        id: 1,
        key: 'Peter|noun|m_anim|1',
        lemma: 'Peter',
        pos: 'noun',
        flags: { proper: true },
      }),
    ).toBe(false);
    expect(
      isRankable({ id: 2, key: 'x|noun|f|1', lemma: 'x', pos: 'noun', flags: { retired: true } }),
    ).toBe(false);
    expect(isRankable({ id: 3, key: 'AIDS|other||1', lemma: 'AIDS', pos: 'other' })).toBe(false);
    expect(isRankable({ id: 4, key: 'sa|other||1', lemma: 'sa', pos: 'other' })).toBe(true);
  });

  it('fits corpus tags to form tags, with x + case for pronouns without agreement', () => {
    const m = (tag: string) => {
      const r = mapSnk('x', 'x', tag);
      if (!r.ok) throw new Error(tag);
      return r;
    };
    expect(fitTag(m('SSns2'), ['s2'])).toBe('s2');
    expect(fitTag(m('SSns2'), ['s1', 's4'])).toBeNull();
    expect(fitTag(m('PFms1'), ['x1', 'x4'])).toBe('x1');
    expect(fitTag(m('Eu6'), [])).toBe('');
    expect(fitTag(m('VKesc+'), ['v:Kesc+'])).toBe('v:Kesc+');
  });

  it('reads the class letter of the lemma list', () => {
    expect(parseLemmaPos('byťV\t10\t5.5\t0.5')).toEqual({ lemma: 'byť', pos: ['verb'], arf: 5.5 });
    expect(parseLemmaPos('kdeP\t10\t5\t0.5')?.pos).toEqual(['pron', 'adv']);
    expect(parseLemmaPos('broken')).toBeNull();
  });

  it('rounds shares down so they never sum above 1', () => {
    const f = topForms(
      new Map([
        ['a\ts1', 1],
        ['b\ts2', 1],
        ['c\ts3', 1],
      ]),
    );
    expect(f.map((x) => x.share)).toEqual([0.333, 0.333, 0.333]);
    expect(topForms(new Map([['a\ts1', 5]]))).toEqual([{ form: 'a', tag: 's1', share: 1 }]);
  });
});

describe('check freq.top-forms', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  async function check(lemmas: unknown[], forms: unknown[]) {
    const dir = join(t.root, `set-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    await writeJsonl(join(dir, 'lemmas.jsonl'), lemmas);
    await writeJsonl(join(dir, 'forms.jsonl'), forms);
    return validateSet(dir, [topFormsCheck], { registry: null, complete: false });
  }
  const mesto = (topForms: unknown[], freqRank = 1) => ({
    id: 20,
    key: 'mesto|noun|n|1',
    lemma: 'mesto',
    pos: 'noun',
    gender: 'n',
    freqRank,
    topForms,
  });
  const forms = [
    { lemmaId: 20, form: 'mesto', tags: 's1 s4' },
    { lemmaId: 20, form: 'mesta', tags: 's2' },
  ];

  it('passes valid top forms', async () => {
    const r = await check(
      [
        mesto([
          { form: 'mesto', tag: 's1', share: 0.6 },
          { form: 'mesta', tag: 's2', share: 0.4 },
        ]),
      ],
      forms,
    );
    expect(r.issues).toEqual([]);
  });

  it('fails shares above 1, unknown forms, wrong tags and repeated ranks', async () => {
    const r = await check(
      [
        mesto([
          { form: 'mesto', tag: 's1', share: 0.7 },
          { form: 'mesta', tag: 's2', share: 0.4 },
        ]),
        { ...mesto([{ form: 'miest', tag: 'p2', share: 0.5 }]), id: 21, key: 'mesto|noun|n|2' },
        {
          ...mesto([{ form: 'mesta', tag: 'p1', share: 0.5 }]),
          id: 22,
          key: 'mesto|noun|n|3',
          freqRank: 2,
        },
      ],
      [...forms, { lemmaId: 22, form: 'mesta', tags: 's2' }],
    );
    const text = r.issues.map((i) => i.message).join('\n');
    expect(text).toMatch(/sum to 1\.100/u);
    expect(text).toMatch(/"miest" of lemma 21 is not in forms/u);
    expect(text).toMatch(/"mesta" of lemma 22 has no tag "p1"/u);
    expect(text).toMatch(/rank 1 is also held by lemma 20/u);
  });
});
