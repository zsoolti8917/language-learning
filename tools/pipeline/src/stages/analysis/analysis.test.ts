import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createDb } from '@app/db';
import { MINI_DIR, MINI_LEMMA_IDS } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readJsonl, writeJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { offlineAnswersDir, offlineRequestsDir } from '../../model/options';
import type { OfflineRequest } from '../../model/runner';
import { type GeneratedGloss, readGlosses } from '../dict';
import { bodyHash } from '../library';
import { type LibraryAnalysis, readAnalyses } from '../library/analysis';
import { loadSet } from '../load';
import { analysisStage } from '.';
import {
  DISAMBIGUATE_ROUTE,
  type DisambiguationInput,
  disambiguationProblems,
  GLOSS_ROUTE,
  type GlossInput,
  glossProblems,
} from './answers';

type Row = Record<string, unknown>;

const KINO = MINI_LEMMA_IDS.kino;
// The model is asked about "ženy" (genitive singular, or nominative or accusative plural);
// "kina" has no gloss in the database of this test.
const TEXT_1 = 'Vidím ženy v meste. Idem do kina.';
// Every word of this text has one reading or is decided by a rule.
const TEXT_2 = 'Bývam v meste. Idem do mesta.';

let t: TempRoot;
let pglite: string;
const generated = (f: string) => join(t.paths.content, 'generated', f);
const text = (id: string) => join(t.paths.content, 'authored', 'library', `${id}.md`);
const requests = (route: string) => join(offlineRequestsDir(t.paths, 'analysis'), route);
const answers = (route: string) => join(offlineAnswersDir(t.paths, 'analysis'), route);

async function writeText(id: string, ord: number, body: string) {
  await mkdir(dirname(text(id)), { recursive: true });
  await writeFile(
    text(id),
    `---\nid: ${id}\nord: ${ord}\ntitle: Test ${ord}\nlevel: A2\n---\n${body}\n`,
  );
}
async function open(route: string): Promise<OfflineRequest[]> {
  if (!existsSync(requests(route))) return [];
  const out: OfflineRequest[] = [];
  for (const f of (await readdir(requests(route))).sort())
    out.push(JSON.parse(await readFile(join(requests(route), f), 'utf8')) as OfflineRequest);
  return out;
}
async function answer(route: string, hash: string, value: unknown) {
  const path = join(answers(route), `${hash}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}
const run = (args: Record<string, string | boolean> = {}) =>
  runStage(analysisStage, t.ctx({ pglite, fill: 'offline', 'answered-by': 'tester', ...args }));
type Report = {
  written?: string[];
  waiting?: string[];
  pending: string[];
  analysed: number;
  requests?: Record<string, number>;
  glossesKept?: number;
  perText?: ({ id: string; open: number; withoutGloss: number } & Record<string, number>)[];
};
const reportOf = async (args?: Record<string, string | boolean>) =>
  (await run(args)).result as Report;

/** The plural accusative for "ženy", the first reading for every other word. */
function picksFor(input: DisambiguationInput) {
  return {
    picks: input.words.map((w) => ({
      w: w.w,
      c:
        w.word === 'ženy'
          ? (w.readings.find((r) => r.case === 'acc' && r.number === 'pl')?.i ?? 0)
          : 0,
    })),
  };
}

beforeAll(async () => {
  t = await tempRoot();
  // The mini dataset without the meanings of "kino", loaded into a database on disk.
  const set = join(t.root, 'set');
  await cp(MINI_DIR, set, { recursive: true });
  const senses: Row[] = [];
  for await (const s of readJsonl<Row>(join(set, 'senses.jsonl')))
    if (s.lemmaId !== KINO) senses.push(s);
  await writeJsonl(join(set, 'senses.jsonl'), senses);
  const manifest = JSON.parse(await readFile(join(set, 'manifest.json'), 'utf8'));
  manifest.counts.senses = senses.length;
  await writeFile(join(set, 'manifest.json'), JSON.stringify(manifest));
  pglite = join(t.root, 'pgdata');
  const database = createDb({ mode: 'pglite', dataDir: pglite });
  try {
    await loadSet(database, set, { workDir: join(t.root, 'work') });
  } finally {
    await database.close();
  }
  // The lemma list of the build names the lemmas of kept glosses.
  await mkdir(join(t.paths.build, 'morph'), { recursive: true });
  await cp(join(set, 'lemmas.jsonl'), join(t.paths.build, 'morph', 'lemmas.jsonl'));
  await writeText('lib-001', 1, TEXT_1);
  await writeText('lib-002', 2, TEXT_2);
}, 120_000);
afterAll(() => t.remove());

describe('the checks of the answers', () => {
  const input: DisambiguationInput = {
    contexts: ['Vidím ženy.'],
    words: [
      {
        w: 0,
        context: 0,
        word: 'ženy',
        readings: [
          { i: 0, lemma: 'žena', pos: 'noun', case: 'gen', number: 'sg', gender: 'f' },
          { i: 1, lemma: 'žena', pos: 'noun', case: 'acc', number: 'pl', gender: 'f' },
        ],
      },
    ],
  };
  it('a disambiguation needs exactly one pick of a listed reading for every word', () => {
    expect(disambiguationProblems(input, { picks: [{ w: 0, c: 1 }] })).toEqual([]);
    expect(disambiguationProblems(input, { picks: [] })).toEqual(['no pick for word 0 ("ženy")']);
    expect(disambiguationProblems(input, { picks: [{ w: 0, c: 2 }] })).toEqual([
      'word 0 ("ženy") has no reading 2',
    ]);
    expect(
      disambiguationProblems(input, {
        picks: [
          { w: 0, c: 1 },
          { w: 0, c: 0 },
          { w: 4, c: 0 },
        ],
      }),
    ).toEqual([
      'word 0 ("ženy") is picked twice',
      'a pick for word 4, which the request does not ask',
    ]);
  });
  it('glosses need one entry of one to three different glosses for every lemma', () => {
    const asked: GlossInput = { lemmas: [{ lemmaId: 21, lemma: 'kino', pos: 'noun' }] };
    const of = (glosses: string[], lemmaId = 21) => ({ glosses: [{ lemmaId, glosses }] });
    expect(glossProblems(asked, of(['cinema']))).toEqual([]);
    expect(glossProblems(asked, { glosses: [] })).toEqual(['no glosses for lemma 21 (kino)']);
    expect(glossProblems(asked, of(['cinema', 'Cinema']))).toEqual([
      'lemma 21 (kino) has the same gloss twice',
    ]);
    expect(glossProblems(asked, of(['a', 'b', 'c', 'd']))).toEqual([
      'lemma 21 (kino) has more than 3 glosses',
    ]);
    expect(glossProblems(asked, of(['cinema'], 22))).toEqual([
      'glosses for lemma 22, which the request does not ask',
      'no glosses for lemma 21 (kino)',
    ]);
  });
});

describe('analysis of the library texts, offline', () => {
  it('without a fill it names the texts that have no analysis', async () => {
    const r = (await runStage(analysisStage, t.ctx({ pglite }))).result as Report;
    expect(r).toMatchObject({ texts: 2, analysed: 0, pending: ['lib-001', 'lib-002'] });
    expect(t.logs.at(-1)).toContain('2 texts have no analysis of their current text');
  });

  it('a dry run counts the requests and writes nothing', async () => {
    const r = await reportOf({ fill: 'dry-run' });
    expect(r.requests).toMatchObject({ [DISAMBIGUATE_ROUTE]: 1, open: 1 });
    expect(r.written).toEqual([]);
    expect(existsSync(offlineRequestsDir(t.paths, 'analysis'))).toBe(false);
    expect(existsSync(generated('library-analysis.jsonl'))).toBe(false);
  }, 60_000);

  it('the first run keeps the text the rules decide and leaves a request for the other', async () => {
    const r = await reportOf();
    expect(r.written).toEqual(['lib-002']);
    expect(r.waiting).toEqual(['lib-001']);
    expect(r.requests).toMatchObject({ [DISAMBIGUATE_ROUTE]: 1, [GLOSS_ROUTE]: 0, open: 1 });
    const first = r.perText?.find((p) => p.id === 'lib-001');
    expect(first).toMatchObject({ open: 1, model: 0, withoutGloss: 1 });
    expect(first?.guess).toBeGreaterThan(0);

    const [req] = await open(DISAMBIGUATE_ROUTE);
    expect(req?.jobs).toEqual(['lib-001']);
    const input = JSON.parse(req?.user ?? '{}') as DisambiguationInput;
    expect(input.contexts).toEqual(['Vidím ženy v meste.']);
    expect(input.words.map((w) => w.word)).toContain('ženy');
    // No gloss is asked while a word is still a guess.
    expect(await open(GLOSS_ROUTE)).toEqual([]);

    const rows = await readAnalyses(generated('library-analysis.jsonl'));
    expect(rows.map((x) => x.id)).toEqual(['lib-002']);
    expect(rows[0]).toMatchObject({
      bodyHash: bodyHash(TEXT_2),
      tokenCount: 6,
      model: 'tester',
      requestHashes: [],
      route: DISAMBIGUATE_ROUTE,
    });
    expect(rows[0]?.methods).toMatchObject({ model: 0, guess: 0 });
    expect(rows[0]?.mock).toBeUndefined();
    const report = await readFile(join(t.paths.build, 'analysis', 'report.md'), 'utf8');
    expect(report).toContain('1 analyses written, 1 texts waiting for answers');
  }, 60_000);

  it('with the readings answered it asks for the gloss the dictionary lacks', async () => {
    const [req] = await open(DISAMBIGUATE_ROUTE);
    await answer(
      DISAMBIGUATE_ROUTE,
      req?.hash ?? '',
      picksFor(JSON.parse(req?.user ?? '{}') as DisambiguationInput),
    );
    const r = await reportOf();
    expect(r.pending).toEqual(['lib-001']);
    expect(r.written).toEqual([]);
    expect(r.waiting).toEqual(['lib-001']);
    expect(r.perText?.[0]).toMatchObject({ id: 'lib-001', guess: 0, withoutGloss: 1, open: 0 });
    expect(r.perText?.[0]?.model).toBeGreaterThan(0);
    // The answered request is gone; the gloss request names the lemma.
    expect(await open(DISAMBIGUATE_ROUTE)).toEqual([]);
    const [gloss] = await open(GLOSS_ROUTE);
    expect(gloss?.jobs).toEqual(['glosses']);
    const asked = JSON.parse(gloss?.user ?? '{}') as GlossInput;
    expect(asked.lemmas).toEqual([{ lemmaId: KINO, lemma: 'kino', pos: 'noun', gender: 'n' }]);
    expect(t.logs.at(-1)).toContain('1 requests are open');
  }, 60_000);

  it('with the gloss answered it writes the analysis and keeps the gloss', async () => {
    const [gloss] = await open(GLOSS_ROUTE);
    await answer(GLOSS_ROUTE, gloss?.hash ?? '', {
      glosses: [{ lemmaId: KINO, glosses: ['cinema', ' movie  theater '] }],
    });
    const r = await reportOf();
    expect(r.written).toEqual(['lib-001']);
    expect(r.waiting).toEqual([]);
    expect(r.requests?.open).toBe(0);
    expect(r.glossesKept).toBe(1);
    expect(await open(GLOSS_ROUTE)).toEqual([]);

    const rows = await readAnalyses(generated('library-analysis.jsonl'));
    expect(rows.map((x) => x.id)).toEqual(['lib-001', 'lib-002']);
    const row = rows[0] as LibraryAnalysis;
    expect(row).toMatchObject({ bodyHash: bodyHash(TEXT_1), tokenCount: 7, model: 'tester' });
    expect(row.requestHashes).toHaveLength(1);
    expect(row.methods.guess).toBe(0);
    // "ženy" is the plural accusative the answer chose, "kina" carries the new gloss.
    const tokens = row.analysis.sentences.flatMap((s) => s.tokens);
    const zeny = tokens.find((x) => TEXT_1.slice(x.s, x.e) === 'ženy');
    expect(zeny).toMatchObject({ l: MINI_LEMMA_IDS.žena, tag: 'p4', m: 'model' });
    expect(row.analysis.lemmas[String(KINO)]?.gloss).toEqual(['cinema', 'movie theater']);
    expect(row.lemmaCounts[String(KINO)]).toBe(1);

    const kept = await readGlosses(generated('glosses.jsonl'));
    expect(kept).toEqual([
      expect.objectContaining<Partial<GeneratedGloss>>({
        key: 'kino|noun|n|1',
        lemmaId: KINO,
        lemma: 'kino',
        pos: 'noun',
        glosses: ['cinema', 'movie theater'],
        source: 'generated',
        route: GLOSS_ROUTE,
        model: 'tester',
        requestHash: gloss?.hash,
      }),
    ]);
  }, 60_000);

  it('a rerun has nothing to do, and --all analyses again from the answers', async () => {
    const r = await reportOf();
    expect(r).toMatchObject({ analysed: 2, pending: [] });
    expect(t.logs.at(-1)).toContain('all 2 texts have an analysis of their current text');
    const before = await readFile(generated('library-analysis.jsonl'), 'utf8');
    const again = await reportOf({ all: true });
    expect(again.written).toEqual(['lib-001', 'lib-002']);
    expect(again.requests?.open).toBe(0);
    expect(await readFile(generated('library-analysis.jsonl'), 'utf8')).toBe(before);
  }, 60_000);

  it('an edited text is analysed again; the same open words use the same answer', async () => {
    const edited = `${TEXT_1} Idem do mesta.`;
    await writeText('lib-001', 1, edited);
    try {
      expect((await runStage(analysisStage, t.ctx({ pglite }))).result).toMatchObject({
        analysed: 1,
        pending: ['lib-001'],
      });
      const r = await reportOf();
      expect(r.written).toEqual(['lib-001']);
      const rows = await readAnalyses(generated('library-analysis.jsonl'));
      expect(rows[0]).toMatchObject({ id: 'lib-001', bodyHash: bodyHash(edited), tokenCount: 10 });
    } finally {
      await writeText('lib-001', 1, TEXT_1);
      await reportOf();
    }
  }, 60_000);

  it('a wrong answer file stops the run and names the file', async () => {
    const dir = answers(DISAMBIGUATE_ROUTE);
    const [file] = await readdir(dir);
    const path = join(dir, file ?? '');
    const good = await readFile(path, 'utf8');
    await writeFile(path, '{"picks":[{"w":0,"c":99}]}');
    try {
      await expect(reportOf({ all: true })).rejects.toThrow(/has no reading 99/u);
    } finally {
      await writeFile(path, good);
    }
  }, 60_000);

  it('a mock run writes first readings to the build folder, marked as mock', async () => {
    const before = await readFile(generated('library-analysis.jsonl'), 'utf8');
    const r = await reportOf({ fill: 'mock' });
    expect(r.written).toEqual(['lib-001', 'lib-002']);
    const rows = await readAnalyses(join(t.paths.build, 'analysis', 'analysis.mock.jsonl'));
    expect(rows.map((x) => [x.id, x.mock, x.model])).toEqual([
      ['lib-001', true, 'mock'],
      ['lib-002', true, 'mock'],
    ]);
    expect(await readFile(generated('library-analysis.jsonl'), 'utf8')).toBe(before);
  }, 60_000);

  it('fails on a database without content', async () => {
    const empty = join(t.root, 'empty-pg');
    await expect(
      runStage(analysisStage, t.ctx({ pglite: empty, fill: 'offline', all: true })),
    ).rejects.toThrow(/holds no content; run `load` on it first/u);
  }, 60_000);
});
