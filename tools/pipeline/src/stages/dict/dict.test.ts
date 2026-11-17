import { mkdir, readFile } from 'node:fs/promises';
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
    const { senses, how } = matchEntries(lemmas, entries);
    expect(senses.get(1)?.[0]?.glossEn).toBe('to have');
    expect(senses.get(2)?.[0]?.glossEn).toBe('mother');
    expect(senses.get(3)?.[0]?.glossEn).toBe('piece');
    expect(senses.has(4)).toBe(false);
    expect(senses.get(5)?.[0]?.glossEn).toBe('where');
    expect(how.get(5)).toBe('loose');
    expect(senses.has(6)).toBe(false);
  });
});
