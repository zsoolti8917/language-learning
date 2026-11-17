import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../../lib/files';
import { LemmaRegistry } from '../../lib/registry';
import { runStage, type Stage } from '../../lib/runner';
import { FIXED_NOW, type TempRoot, tempRoot } from '../../lib/testing';
import { type Check, CORE_CHECKS, validateSet } from '../../lib/validate';
import { STAGES } from '..';
import { morphStage } from '../morph';
import { allChecks, validateStage } from '.';

// The stages whose checks the mini dataset is held to: later stages (scenarios, library, …)
// check content targets the mini dataset does not aim at.
const MINI_STAGES = STAGES.filter((s) =>
  ['fetch', 'morph', 'freq', 'dict', 'validate', 'load'].includes(s.name),
);

const SAMPLE = fileURLToPath(new URL('../morph/fixtures/snk-sample.txt', import.meta.url));

async function miniRegistry(): Promise<LemmaRegistry> {
  const entries: [number, string][] = [];
  for await (const l of readJsonl<{ id: number; key: string }>(join(MINI_DIR, 'lemmas.jsonl')))
    entries.push([l.id, l.key]);
  return new LemmaRegistry(entries);
}

type Row = Record<string, unknown>;
async function rewrite(dir: string, file: string, fn: (rows: Row[]) => Row[]): Promise<void> {
  const rows: Row[] = [];
  for await (const r of readJsonl<Row>(join(dir, file))) rows.push(r);
  await writeJsonl(join(dir, file), fn(rows));
}

describe('validate on a set folder', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  it('passes the mini dataset, with every core check and the morph checks', async () => {
    const r = await validateSet(MINI_DIR, allChecks(MINI_STAGES), {
      registry: await miniRegistry(),
    });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    // The mini prepositions carry no flags.cases: a warning here, an issue in a full build.
    expect(r.warnings.filter((w) => w.check === 'morph.prep-cases')).toHaveLength(12);
    const full = await validateSet(MINI_DIR, allChecks(MINI_STAGES), {
      registry: await miniRegistry(),
      complete: true,
    });
    // MINI_STAGES stops at dict, so sentences.coverage is not checked here (see sentences.test.ts).
    expect(Object.keys(full.issueCounts)).toEqual(['morph.prep-cases']);
  });

  it('reports broken links, duplicates, bad tags and registry mismatches', async () => {
    const dir = join(t.root, 'broken');
    await cp(MINI_DIR, dir, { recursive: true });
    await rewrite(dir, 'forms.jsonl', (rows) => [
      ...rows,
      { lemmaId: 9999, form: 'nikde', tags: 's1' },
      rows[0] as Row,
      { lemmaId: 20, form: 'mestoo', tags: 's1m' },
    ]);
    await rewrite(dir, 'exercises.jsonl', (rows) =>
      rows.map((r, i) => (i === 0 ? { ...r, triggerId: 'prep-nowhere' } : r)),
    );
    await rewrite(dir, 'lemmas.jsonl', (rows) =>
      rows.map((r) => (r.id === 20 ? { ...r, pattern: 'nothing' } : r)),
    );
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    manifest.counts.forms += 3;
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const reg = await miniRegistry();
    const r = await validateSet(dir, CORE_CHECKS, {
      registry: new LemmaRegistry([
        ...reg.entries().filter(([id]) => id !== 21),
        [21, 'kino|noun|m_inan|1'],
        [100, 'x|noun|f|1'],
      ]),
      complete: true,
    });
    expect(r.ok).toBe(false);
    const text = r.issues.map((i) => `${i.check}: ${i.message}`).join('\n');
    expect(text).toMatch(/links: forms\.jsonl:\d+: lemma 9999 is not in lemmas\.jsonl/u);
    expect(text).toMatch(/unique: forms\.jsonl:\d+: duplicate form 1 chlap/u);
    expect(text).toMatch(/tags: forms\.jsonl:\d+: tag "s1m" does not fit a noun/u);
    expect(text).toMatch(/links: exercises\.jsonl:1 .*trigger "prep-nowhere" does not exist/u);
    expect(text).toMatch(/links: lemmas\.jsonl:20: pattern "nothing" does not exist/u);
    expect(text).toMatch(
      /registry: lemmas\.jsonl:21: id 21 has key "kino\|noun\|n\|1", the registry says "kino\|noun\|m_inan\|1"/u,
    );
    expect(text).toMatch(
      /registry: registry id 100 \(x\|noun\|f\|1\) is missing from lemmas\.jsonl/u,
    );
    expect(r.issueCounts.schema).toBeUndefined();
  });

  it('lets a stage add a check, and reports a check that throws', async () => {
    const custom: Check = {
      id: 'demo.no-kino',
      description: 'no lemma kino',
      async run(ctx) {
        for await (const { n, row } of ctx.rows('lemmas.jsonl'))
          if (row.lemma === 'kino') ctx.issue(`lemmas.jsonl:${n}: kino`);
      },
    };
    const broken: Check = {
      id: 'demo.throws',
      description: 'throws',
      run: async () => Promise.reject(new Error('boom')),
    };
    const r = await validateSet(MINI_DIR, [custom, broken]);
    expect(r.issues).toEqual([
      { check: 'demo.no-kino', message: 'lemmas.jsonl:21: kino' },
      { check: 'demo.throws', message: 'check failed to run: boom' },
    ]);
  });
});

describe('the validate stage', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  it('assembles the set from the stages, writes its manifest, passes, and keeps it on a rerun', async () => {
    await runStage(morphStage, t.ctx({ input: SAMPLE, mini: MINI_DIR, measure: 'off' }));
    // Only morph has run: later stages (freq, dict, …) would ask for parts that do not exist.
    const upToMorph = [STAGES[0] as Stage, morphStage, validateStage];
    const first = await runStage(validateStage, t.ctx({}, upToMorph));
    expect(first.result).toMatchObject({ version: '2026-11-17.1' });
    const manifestPath = join(t.paths.set, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    expect(manifest.counts.lemmas).toBeGreaterThan(30);
    expect(manifest.sources).toEqual([
      expect.objectContaining({
        name: 'SNK morphological database 2015-02-05: ma-2015-02-05.txt.xz',
        checksum: 'sha256:1367796465abb0262019fb2c112d33ed45584efd3e8fc989a93dbd4efb388753',
      }),
    ]);
    const before = await readFile(manifestPath, 'utf8');
    await runStage(validateStage, t.ctx({}, upToMorph), { force: true });
    expect(await readFile(manifestPath, 'utf8')).toBe(before);
    expect(await readFile(join(t.paths.build, 'validate', 'report.md'), 'utf8')).toContain(
      'Result: **pass**',
    );
  });

  it('merges partial rows from a later stage and gives the new build the next version', async () => {
    const ranks = join(t.paths.build, 'demo', 'ranks.jsonl');
    await writeJsonl(ranks, [{ id: 20, freqRank: 7, flags: { proper: false } }]);
    const demo: Stage = {
      name: 'demo',
      description: 'adds a rank',
      inputs: () => [],
      outputs: () => [],
      run: async () => null,
      parts: [{ file: 'lemmas.jsonl', path: () => ranks, mode: 'merge' }],
      checks: [
        {
          id: 'demo.ranked',
          description: 'mesto has a rank',
          async run(ctx) {
            for await (const { row } of ctx.rows('lemmas.jsonl'))
              if (row.id === 20 && row.freqRank !== 7) ctx.issue('no rank');
          },
        },
      ],
    };
    const stages = [STAGES[0] as Stage, morphStage, demo, validateStage];
    const later = new Date(FIXED_NOW.getTime() + 1000);
    await runStage(validateStage, { ...t.ctx({}, stages), now: () => later });
    const mesto: Row[] = [];
    for await (const r of readJsonl<Row>(join(t.paths.set, 'lemmas.jsonl')))
      if (r.id === 20) mesto.push(r);
    expect(mesto).toEqual([
      expect.objectContaining({
        lemma: 'mesto',
        pattern: 'mesto',
        freqRank: 7,
        flags: { proper: false },
      }),
    ]);
    const manifest = JSON.parse(await readFile(join(t.paths.set, 'manifest.json'), 'utf8'));
    expect(manifest.version).toBe('2026-11-17.2');
  });

  it('fails the stage when a check fails', async () => {
    const bad: Stage = {
      name: 'bad',
      description: 'always fails',
      inputs: () => [],
      outputs: () => [],
      run: async () => null,
      checks: [{ id: 'bad.always', description: 'fails', run: async (ctx) => ctx.issue('nope') }],
    };
    await expect(
      runStage(validateStage, t.ctx({}, [morphStage, bad, validateStage]), { force: true }),
    ).rejects.toThrow(/validate: 1 issues/u);
  });
});
