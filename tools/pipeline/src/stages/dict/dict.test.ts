import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SenseRow } from '@app/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readJsonl, writeJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { freqOut, freqStage } from '../freq';
import { seedFreqSample } from '../freq/sample';
import { dictStage, type GeneratedGloss, glossCoverageCheck, readGlosses } from '.';
import { applyOverride, overridesPath, readOverrides } from './overrides';
import {
  genderOf,
  type KaikkiEntry,
  matchEntries,
  parseEntry,
  sensesOf,
  shortGloss,
} from './wiktionary';

interface Ranked {
  id: number;
  freqRank: number;
}

async function rows<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

describe('dict on the sample', () => {
  let t: TempRoot;
  let ranked: Ranked[];
  const sensesPath = () => join(t.paths.build, 'dict', 'senses.jsonl');
  const glosses = () => join(t.root, 'glosses.jsonl');

  beforeAll(async () => {
    t = await tempRoot();
    await seedFreqSample(t.paths);
    await runStage(freqStage, t.ctx());
    ranked = await rows<Ranked>(freqOut(t.paths, 'lemmas.jsonl'));
  }, 60_000);
  afterAll(() => t.remove());

  it('takes Wiktionary senses, at most three per lemma, and leaves gaps without a fill', async () => {
    const r = (await runStage(dictStage, t.ctx({ glosses: glosses() }))).result as {
      coverage: { band: number; ranked: number; wiktionary: number; missing: number }[];
    };
    const senses = await rows<SenseRow>(sensesPath());
    expect(senses.every((s) => s.source === 'wiktionary' && s.verified === false)).toBe(true);
    const perLemma = new Map<number, number>();
    for (const s of senses) perLemma.set(s.lemmaId, (perLemma.get(s.lemmaId) ?? 0) + 1);
    expect(Math.max(...perLemma.values())).toBeLessThanOrEqual(3);
    expect(r.coverage[0]?.ranked).toBe(ranked.length);
    expect(r.coverage[0]?.missing).toBeGreaterThan(0);
    expect(existsSync(glosses())).toBe(false);
    const report = await readFile(join(t.paths.build, 'dict', 'report.md'), 'utf8');
    expect(report).toContain('Without a gloss');
  });

  it('prints the request count and cost on a dry run and sends nothing', async () => {
    const logs: string[] = [];
    const ctx = {
      ...t.ctx({ glosses: glosses(), fill: 'dry-run' }),
      log: (m: string) => logs.push(m),
    };
    const r = (await runStage(dictStage, ctx)).result as {
      fill: { gaps: number; requests: number; sent: number; estimate: { usd: number } };
    };
    expect(r.fill.sent).toBe(0);
    expect(r.fill.requests).toBe(Math.ceil(r.fill.gaps / 25));
    expect(r.fill.estimate.usd).toBeGreaterThan(0);
    expect(logs.join('\n')).toMatch(/content\.glosses: \d+ requests .* at batch prices/u);
    expect(existsSync(glosses())).toBe(false);
    expect(existsSync(join(t.paths.build, 'model-cache', 'content.glosses'))).toBe(false);
  });

  it('fills a sample in mock mode: every lemma of the sample has a gloss, generated ones flagged', async () => {
    const r = (await runStage(dictStage, t.ctx({ glosses: glosses(), fill: 'mock', sample: '10' })))
      .result as { fill: { gaps: number; answered: number; failed: number } };
    expect(r.fill).toMatchObject({ gaps: 10, answered: 1, failed: 0 });
    const generated = await readGlosses(glosses());
    expect(generated).toHaveLength(10);
    expect(generated.every((g) => g.source === 'generated' && g.route === 'content.glosses')).toBe(
      true,
    );

    // Now the whole sample.
    await runStage(dictStage, t.ctx({ glosses: glosses(), fill: 'mock' }));
    const senses = await rows<SenseRow>(sensesPath());
    const glossed = new Set(senses.map((s) => s.lemmaId));
    for (const x of ranked) expect(glossed.has(x.id), `lemma ${x.id}`).toBe(true);
    const all = await readGlosses(glosses());
    const genIds = new Set(all.map((g: GeneratedGloss) => g.lemmaId));
    for (const s of senses) {
      if (genIds.has(s.lemmaId)) expect(s).toMatchObject({ source: 'generated', verified: false });
      else expect(s.source).toBe('wiktionary');
    }
    expect(senses.some((s) => s.source === 'generated' && s.glossEn.startsWith('[mock]'))).toBe(
      true,
    );
  });

  it('reuses the glosses file: a rerun sends nothing', async () => {
    const r = (
      await runStage(dictStage, t.ctx({ glosses: glosses(), fill: 'dry-run' }), { force: true })
    ).result as { fill: { gaps: number } };
    expect(r.fill.gaps).toBe(0);
  });

  it('assembles with morph and freq into a set that validate passes', async () => {
    const stages = t
      .ctx()
      .stages.filter((s) => ['morph', 'freq', 'dict', 'validate'].includes(s.name));
    const validate = stages.find((s) => s.name === 'validate');
    if (!validate) throw new Error('no validate stage');
    const r = await runStage(validate, t.ctx({ 'no-registry': true }, stages));
    expect((r.result as { counts: Record<string, number> }).counts).toMatchObject({
      lemmas: 444,
      senses: expect.any(Number),
    });
    const set = await rows<{ id: number; freqRank?: number; topForms: unknown[] }>(
      join(t.paths.set, 'lemmas.jsonl'),
    );
    expect(set.filter((l) => l.freqRank !== undefined)).toHaveLength(ranked.length);
    const report = await readFile(join(t.paths.build, 'validate', 'report.md'), 'utf8');
    expect(report).toMatch(/\| freq\.top-forms \| 0 \|/u);
    expect(report).toMatch(/\| dict\.glosses \| 0 \|/u);
  }, 60_000);

  it('passes the check dict.glosses, which fails unglossed ranked lemmas in a complete build', async () => {
    const dir = join(t.root, 'set');
    await mkdir(dir, { recursive: true });
    const lemmas = [
      { id: 20, key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n', freqRank: 1 },
      { id: 21, key: 'žena|noun|f|1', lemma: 'žena', pos: 'noun', gender: 'f', freqRank: 2 },
    ];
    await writeJsonl(join(dir, 'lemmas.jsonl'), lemmas);
    await writeJsonl(join(dir, 'senses.jsonl'), [
      { lemmaId: 20, ord: 0, glossEn: 'town', source: 'wiktionary' },
      { lemmaId: 20, ord: 1, glossEn: 'city', source: 'generated', verified: true },
    ]);
    const partial = await validateSet(dir, [glossCoverageCheck], { complete: false });
    expect(partial.issues.map((i) => i.message)).toEqual([
      'senses.jsonl:2: a generated gloss of lemma 20 is marked verified',
    ]);
    expect(partial.warnings.map((i) => i.message)).toEqual([
      '1 ranked lemmas have no gloss, e.g. žena (2)',
    ]);
    const complete = await validateSet(dir, [glossCoverageCheck], { complete: true });
    expect(complete.issues).toHaveLength(2);
    expect(complete.issues[1]?.message).toMatch(/žena \(2\); run dict --fill/u);
  });
});

describe("the editor's list", () => {
  let t: TempRoot;
  const sensesPath = () => join(t.paths.build, 'dict', 'senses.jsonl');
  const glosses = () => join(t.root, 'glosses.jsonl');
  const write = async (yaml: string) => {
    await mkdir(join(t.paths.content, 'authored', 'glosses'), { recursive: true });
    await writeFile(overridesPath(t.paths), yaml);
  };

  beforeAll(async () => {
    t = await tempRoot();
    await seedFreqSample(t.paths);
    await runStage(freqStage, t.ctx());
  }, 60_000);
  afterAll(() => t.remove());

  it('reads glosses with and without a note and refuses a list that contradicts itself', async () => {
    await write(
      [
        '- key: sobota|noun|f|1',
        '  glosses:',
        '    - Saturday',
        '    - gloss: Sabbath',
        '      note: in Judaism',
        '  why: The day of the week comes first.',
        '',
      ].join('\n'),
    );
    const list = await readOverrides(overridesPath(t.paths));
    expect(list.get('sobota|noun|f|1')).toEqual({
      key: 'sobota|noun|f|1',
      glosses: [{ glossEn: 'Saturday' }, { glossEn: 'Sabbath', note: 'in Judaism' }],
      why: 'The day of the week comes first.',
    });
    expect((await readOverrides(join(t.root, 'none.yaml'))).size).toBe(0);

    const bad: [string, RegExp][] = [
      [
        '- key: a|conj||1\n  glosses: [and]\n  why: x\n- key: a|conj||1\n  glosses: [and]\n  why: x\n',
        /stands twice/u,
      ],
      ['- key: a|conj||1\n  glosses: [and, And]\n  why: x\n', /lists the gloss "And" twice/u],
      ['- key: a|conj||1\n  glosses: []\n  why: x\n', /glosses/u],
      ['- key: a|conj||1\n  glosses: [a, b, c, d]\n  why: x\n', /glosses/u],
      [`- key: a|conj||1\n  glosses: [${'x'.repeat(61)}]\n  why: x\n`, /glosses\.0/u],
      ['- key: a|conj||1\n  glosses: [and]\n', /why/u],
      ['- key: a|conj||1\n  glosses: [and]\n  why: x\n  source: me\n', /source|Unrecognized/u],
    ];
    for (const [yaml, message] of bad) {
      await write(yaml);
      await expect(readOverrides(overridesPath(t.paths))).rejects.toThrow(message);
    }
  });

  it('keeps the source of a gloss the entry had and marks a new one manual', () => {
    const current = [
      { glossEn: 'Sabbath', note: 'Judaism', source: 'wiktionary' as const },
      { glossEn: 'Saturday', source: 'wiktionary' as const },
    ];
    expect(
      applyOverride(
        {
          key: 'sobota|noun|f|1',
          glosses: [{ glossEn: 'Saturday' }, { glossEn: 'Sabbath' }, { glossEn: 'weekend day' }],
          why: 'x',
        },
        current,
      ),
    ).toEqual([
      { glossEn: 'Saturday', source: 'wiktionary' },
      // The list gives no note, so the entry shows none.
      { glossEn: 'Sabbath', source: 'wiktionary' },
      { glossEn: 'weekend day', source: 'manual' },
    ]);
    // A sense of the Wiktionary entry that the stage had cut is still Wiktionary's.
    expect(
      applyOverride(
        {
          key: 'obchod|noun|m_inan|1',
          glosses: [{ glossEn: 'store' }, { glossEn: 'shop' }],
          why: 'x',
        },
        [{ glossEn: 'shop', source: 'generated' }],
        [{ glossEn: 'trade' }, { glossEn: 'store', note: 'a place' }],
      ),
    ).toEqual([
      { glossEn: 'store', source: 'wiktionary' },
      { glossEn: 'shop', source: 'generated' },
    ]);
  });

  it('writes the entries of the list, also for a lemma without a gloss, and reports a key it does not know', async () => {
    await writeFile(overridesPath(t.paths), '[]\n');
    const first = (await runStage(dictStage, t.ctx({ glosses: glosses() }))).result as {
      overrides: { listed: number; applied: number };
    };
    expect(first.overrides).toMatchObject({ listed: 0, applied: 0 });
    const before = await rows<SenseRow>(sensesPath());
    const lemmas = await rows<{ id: number; key: string }>(
      join(t.paths.build, 'morph', 'lemmas.jsonl'),
    );
    const keyOf = new Map(lemmas.map((l) => [l.id, l.key]));
    const ranked = await rows<Ranked>(freqOut(t.paths, 'lemmas.jsonl'));
    const count = new Map<number, number>();
    for (const s of before) count.set(s.lemmaId, (count.get(s.lemmaId) ?? 0) + 1);
    const two = [...count].find(([, n]) => n >= 2)?.[0];
    const gap = ranked.find((r) => !count.has(r.id))?.id;
    if (two === undefined || gap === undefined) throw new Error('the sample lacks a case');
    const had = before.filter((s) => s.lemmaId === two);

    await write(
      [
        `- key: ${JSON.stringify(keyOf.get(two))}`,
        '  glosses:',
        `    - ${JSON.stringify(had[1]?.glossEn)}`,
        '    - gloss: a new gloss',
        '      note: with a note',
        '  why: The second sense is the common one.',
        `- key: ${JSON.stringify(keyOf.get(gap))}`,
        '  glosses: [only in the list]',
        '  why: Neither source has the word.',
        '- key: nikto|noun|x|9',
        '  glosses: [nobody]',
        '  why: Not a lemma of the sample.',
        '',
      ].join('\n'),
    );
    const logs: string[] = [];
    // The list is an input of the stage: the run is not skipped.
    const run = await runStage(dictStage, {
      ...t.ctx({ glosses: glosses() }),
      log: (m: string) => logs.push(m),
    });
    const r = run.result as {
      overrides: Record<string, unknown>;
      coverage: { manual: number; edited: number; missing: number }[];
    };
    expect(r.overrides).toEqual({
      listed: 3,
      applied: 2,
      sensesKept: 1,
      sensesAdded: 2,
      unknownKeys: ['nikto|noun|x|9'],
    });
    expect(logs.join('\n')).toMatch(/1 keys of .*overrides\.yaml name no lemma of this build/u);
    const after = await rows<SenseRow>(sensesPath());
    expect(after.filter((s) => s.lemmaId === two)).toEqual([
      { lemmaId: two, ord: 0, glossEn: had[1]?.glossEn, source: 'wiktionary', verified: false },
      {
        lemmaId: two,
        ord: 1,
        glossEn: 'a new gloss',
        source: 'manual',
        verified: false,
        note: 'with a note',
      },
    ]);
    expect(after.filter((s) => s.lemmaId === gap)).toEqual([
      { lemmaId: gap, ord: 0, glossEn: 'only in the list', source: 'manual', verified: false },
    ]);
    // Every other entry is as it was.
    const others = (list: SenseRow[]) => list.filter((s) => s.lemmaId !== two && s.lemmaId !== gap);
    expect(others(after)).toEqual(others(before));
    expect(r.coverage[0]).toMatchObject({ manual: 1, edited: 2 });
    const report = await readFile(join(t.paths.build, 'dict', 'report.md'), 'utf8');
    expect(report).toContain('names 3 lemmas; 2 entries follow it');
    expect(report).toContain('nikto|noun|x|9');

    // A lemma of the list is no gap for the model fill.
    const dry = (
      await runStage(dictStage, t.ctx({ glosses: glosses(), fill: 'dry-run' }), { force: true })
    ).result as { fill: { gaps: number } };
    expect(dry.fill.gaps).toBe(ranked.filter((x) => !count.has(x.id)).length - 1);
  }, 60_000);
});

describe('Wiktionary entries', () => {
  const entry = (e: Partial<KaikkiEntry>): KaikkiEntry => ({
    word: 'x',
    pos: 'noun',
    lang_code: 'sk',
    ...e,
  });

  it('shortens glosses and keeps the explanation and the qualifier as a note', () => {
    expect(shortGloss('to make (to create from a certain material)')).toEqual({
      gloss: 'to make',
      explanation: 'to create from a certain material',
    });
    expect(shortGloss('on, to [with accusative]')).toEqual({ gloss: 'on, to' });
    expect(shortGloss('(Christianity) Easter')).toEqual({
      gloss: 'Easter',
      explanation: 'Christianity',
    });
    expect(shortGloss('the; this; that.')).toEqual({ gloss: 'the; this; that' });
    const long = `${'a'.repeat(30)}; ${'b'.repeat(40)}`;
    expect(shortGloss(long).gloss).toBe('a'.repeat(30));
    const senses = sensesOf(
      entry({
        pos: 'prep',
        senses: [
          {
            glosses: ['on (touching from above)'],
            raw_glosses: ['(with locative) on (touching from above)'],
          },
        ],
      }),
    );
    expect(senses).toEqual([{ glossEn: 'on', note: 'with locative' }]);
  });

  it('skips forms of other words, puts archaic senses last, keeps three', () => {
    const senses = sensesOf(
      entry({
        senses: [
          {
            glosses: ['genitive singular of mesto'],
            tags: ['form-of'],
            form_of: [{ word: 'mesto' }],
          },
          { glosses: ['castle'], tags: ['archaic'] },
          { glosses: ['town'] },
          { glosses: ['town'] },
          { glosses: ['city'] },
          { glosses: ['borough'] },
          { tags: ['no-gloss'] },
        ],
      }),
    );
    expect(senses.map((s) => s.glossEn)).toEqual(['town', 'city', 'borough', 'castle']);
    expect(parseEntry(entry({ senses: [{ glosses: ['x of y'], tags: ['form-of'] }] }))).toBeNull();
    expect(parseEntry(entry({ pos: 'character', senses: [{ glosses: ['letter'] }] }))).toBeNull();
  });

  it('reads the noun gender of the head template', () => {
    expect(genderOf(entry({ head_templates: [{ args: { '1': 'm-in' } }] }))).toBe('m_inan');
    expect(genderOf(entry({ head_templates: [{ args: { '1': 'm-an' } }] }))).toBe('m_anim');
    expect(genderOf(entry({ head_templates: [{ args: { '1': 'f' } }] }))).toBe('f');
    expect(genderOf(entry({}))).toBeUndefined();
  });

  it('matches by spelling and class, by gender for noun homographs, loosely for function words', () => {
    const lemmas = [
      { id: 1, lemma: 'mať', pos: 'verb' as const },
      { id: 2, lemma: 'mať', pos: 'noun' as const, gender: 'f' },
      { id: 3, lemma: 'kus', pos: 'noun' as const, gender: 'm_inan' },
      { id: 4, lemma: 'kus', pos: 'noun' as const, gender: 'm_anim' },
      { id: 5, lemma: 'kde', pos: 'adv' as const },
      { id: 6, lemma: 'dom', pos: 'verb' as const },
    ];
    const entries = [
      parseEntry(entry({ word: 'mať', pos: 'verb', senses: [{ glosses: ['to have'] }] })),
      parseEntry(
        entry({
          word: 'mať',
          pos: 'noun',
          head_templates: [{ args: { '1': 'f' } }],
          senses: [{ glosses: ['mother'] }],
        }),
      ),
      parseEntry(
        entry({
          word: 'kus',
          pos: 'noun',
          head_templates: [{ args: { '1': 'm-in' } }],
          senses: [{ glosses: ['piece'] }],
        }),
      ),
      parseEntry(entry({ word: 'kde', pos: 'pron', senses: [{ glosses: ['where'] }] })),
      parseEntry(entry({ word: 'dom', pos: 'noun', senses: [{ glosses: ['house'] }] })),
    ].filter((e) => e !== null);
    const { senses, all, how } = matchEntries(lemmas, entries);
    expect(all.get(1)).toEqual(senses.get(1));
    expect(senses.get(1)?.[0]?.glossEn).toBe('to have');
    expect(senses.get(2)?.[0]?.glossEn).toBe('mother');
    expect(senses.get(3)?.[0]?.glossEn).toBe('piece');
    expect(senses.has(4)).toBe(false);
    expect(senses.get(5)?.[0]?.glossEn).toBe('where');
    expect(how.get(5)).toBe('loose');
    expect(senses.has(6)).toBe(false);
  });
  it('shows three senses of a lemma and keeps the others for the editor', () => {
    const e = parseEntry(
      entry({
        word: 'obchod',
        senses: ['trade', 'deal', 'shop', 'store', 'Shop'].map((g) => ({ glosses: [g] })),
      }),
    );
    if (!e) throw new Error('no entry');
    const { senses, all } = matchEntries([{ id: 7, lemma: 'obchod', pos: 'noun' }], [e]);
    expect(senses.get(7)?.map((s) => s.glossEn)).toEqual(['trade', 'deal', 'shop']);
    expect(all.get(7)?.map((s) => s.glossEn)).toEqual(['trade', 'deal', 'shop', 'store']);
  });
});
