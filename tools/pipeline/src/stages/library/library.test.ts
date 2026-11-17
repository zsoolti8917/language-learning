import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl, writeJsonl } from '../../lib/files';
import { runStage, type Stage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { freqStage } from '../freq';
import { morphStage } from '../morph';
import { scenarioRulesCheck, scenarioSlovakCheck, scenariosStage } from '../scenarios';
import { validateStage } from '../validate';
import {
  type LibraryOutRow,
  libraryStage,
  libraryTextsCheck,
  libraryVocabularyCheck,
  readReviews,
} from '.';
import { parseAuthoredText } from './authored';
import { reviewTask } from './review';
import { seedLibrarySample } from './sample';
import { A2_MIN_SHARE, FormIndex, type LemmaInfo, profileText, wordsOf } from './vocab';

async function rows<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

interface Profile {
  id: string;
  level: string;
  words: number;
  share: number;
  unknown: string[];
}

/** C4's triggers are not built yet: the mini dataset's stand in for triggers.jsonl. */
const miniTriggers: Stage = {
  name: 'mini-triggers',
  description: 'the mini triggers, standing in for C4',
  inputs: () => [],
  outputs: () => [],
  run: async () => null,
  parts: [{ file: 'triggers.jsonl', path: (p) => join(p.mini, 'triggers.jsonl') }],
};
const SET_STAGES = [
  morphStage,
  freqStage,
  miniTriggers,
  scenariosStage,
  libraryStage,
  validateStage,
];

describe('vocabulary profile', () => {
  const lemmas = new Map<number, LemmaInfo>([
    [1, { lemma: 'byť', rank: 1, proper: false }],
    [2, { lemma: 'v', rank: 5, proper: false }],
    [3, { lemma: 'Bratislava', proper: true }],
    [4, { lemma: 'kaviareň', rank: 2864, proper: false }],
    [5, { lemma: 'ja', rank: 17, proper: false }],
  ]);
  const text = 'Som v Bratislave. V kaviarni som ja.';
  const index = new FormIndex(new Set(['Som', 'som', 'v', 'V', 'Bratislave', 'kaviarni', 'ja']));
  for (const [form, id] of [
    ['som', 1],
    ['v', 2],
    ['V', 99], // an abbreviation whose lemma is not in the set: only the lower case reading counts
    ['Bratislave', 3],
    ['kaviarni', 4],
    ['ja', 5],
  ] as const)
    index.add(form, id);

  it('splits words with the ling tokenizer and finds forms as written and in lower case', () => {
    expect(wordsOf('Ide 5 ľudí, ok?')).toEqual(['Ide', 'ľudí', 'ok']);
    expect(index.candidates('Som')).toEqual([1]);
    expect(index.candidates('V')).toEqual([99, 2]);
  });

  it('counts tokens and lemmas, leaves names out and measures the share within the limit', () => {
    const p = profileText(text, index, lemmas, 2000);
    expect(p.words).toBe(7);
    expect(p.unknown).toEqual([]);
    expect(p.names).toBe(1);
    expect(p.counted).toBe(6);
    expect(p.within).toBe(5);
    expect(p.share).toBeCloseTo(5 / 6);
    expect(p.lemmas).toBe(5);
    expect(p.outside).toEqual([{ word: 'kaviarni', lemma: 'kaviareň', rank: 2864 }]);
    expect(profileText(text, index, lemmas, 3000).share).toBe(1);
  });

  it('reports a word that is no known form', () => {
    const p = profileText('Som v Blablove a blabla.', index, lemmas);
    expect(p.unknown).toEqual(['Blablove', 'a', 'blabla']);
    expect(p.counted).toBe(2);
  });
});

describe('authored texts', () => {
  const ok = '---\nid: lib-020\nord: 20\ntitle: Test\nlevel: A2\n---\nJe to text.\n';
  it('parses the front matter and the body', () => {
    const t = parseAuthoredText('lib-020.md', ok);
    expect(t).toMatchObject({
      id: 'lib-020',
      level: 'A2',
      source: 'authored',
      license: 'CC BY 4.0',
    });
    expect(t.body).toBe('Je to text.');
  });
  it('rejects a missing front matter, a wrong file name, an unknown key and a level beyond B1', () => {
    expect(() => parseAuthoredText('lib-020.md', 'Je to text.')).toThrow(/no front matter/);
    expect(() => parseAuthoredText('lib-021.md', ok)).toThrow(/file name must be the id/);
    expect(() =>
      parseAuthoredText('lib-020.md', ok.replace('level: A2', 'level: A2\nauthor: x')),
    ).toThrow(/author/);
    expect(() => parseAuthoredText('lib-020.md', ok.replace('level: A2', 'level: B2'))).toThrow(
      /level/,
    );
  });
});

describe('content.review', () => {
  const input = { id: 'lib-001', title: 'T', level: 'A2', body: 'Bývam v Bratislave.' };
  it('rejects a quote that is not in the text and a revise verdict without a problem', () => {
    expect(
      reviewTask.check?.(input, {
        verdict: 'revise',
        level: 'A2',
        problems: [{ quote: 'v Bratislave', issue: 'fine', fix: 'v Bratislave' }],
      }),
    ).toEqual([]);
    expect(
      reviewTask.check?.(input, {
        verdict: 'ok',
        level: 'A2',
        problems: [{ quote: 'v Košiciach', issue: 'x', fix: 'y' }],
      }),
    ).toEqual(['quote "v Košiciach" is not in the text']);
    expect(reviewTask.check?.(input, { verdict: 'revise', level: 'A2', problems: [] })).toEqual([
      'verdict "revise" without a problem',
    ]);
  });
});

describe('library on the authored texts', () => {
  let t: TempRoot;
  const libraryOut = () => join(t.paths.build, 'library', 'library.jsonl');
  const reviews = () => join(t.root, 'reviews.jsonl');

  beforeAll(async () => {
    t = await tempRoot();
    await seedLibrarySample(t.paths);
  }, 60_000);
  afterAll(() => t.remove());

  it('writes twelve texts from A2 to B1 of 150 to 400 words, every word a known form', async () => {
    await runStage(libraryStage, t.ctx({ reviews: reviews() }));
    const out = await rows<LibraryOutRow>(libraryOut());
    expect(out.map((r) => r.id)).toEqual(
      Array.from({ length: 12 }, (_, i) => `lib-${String(i + 1).padStart(3, '0')}`),
    );
    expect(new Set(out.map((r) => r.level))).toEqual(new Set(['A2', 'B1']));
    expect(out.every((r) => r.source === 'authored' && r.analysis === undefined)).toBe(true);
    const report = JSON.parse(
      await readFile(join(t.paths.build, 'library', 'report.json'), 'utf8'),
    );
    const profiles = report.profiles as Profile[];
    for (const p of profiles) {
      expect(p.unknown, p.id).toEqual([]);
      expect(p.words, p.id).toBeGreaterThanOrEqual(150);
      expect(p.words, p.id).toBeLessThanOrEqual(400);
    }
  }, 60_000);

  it('keeps at least 90 % of the words of each A2 text within the 2,000 most common lemmas', async () => {
    const report = JSON.parse(
      await readFile(join(t.paths.build, 'library', 'report.json'), 'utf8'),
    );
    const a2 = (report.profiles as Profile[]).filter((p) => p.level === 'A2');
    expect(a2.length).toBeGreaterThanOrEqual(6);
    for (const p of a2) expect(p.share, p.id).toBeGreaterThanOrEqual(A2_MIN_SHARE);
  });

  it('marks every text unreviewed until a review pass ran', async () => {
    const out = await rows<LibraryOutRow>(libraryOut());
    expect(out.every((r) => r.review.status === 'unreviewed')).toBe(true);
  });

  it('a dry run estimates the review pass and sends nothing', async () => {
    const r = (
      await runStage(libraryStage, t.ctx({ reviews: reviews(), fill: 'dry-run' }), { force: true })
    ).result as { fill: { requests: number; sent: number; estimate: { usd: number } } };
    expect(r.fill.requests).toBe(12);
    expect(r.fill.sent).toBe(0);
    expect(r.fill.estimate.usd).toBeGreaterThan(0);
    expect(t.logs.some((l) => l.includes('12 requests for 12 jobs'))).toBe(true);
    expect(await readReviews(reviews())).toEqual([]);
  }, 60_000);

  it('a mock review pass marks every text reviewed, and a rerun asks for nothing', async () => {
    await runStage(libraryStage, t.ctx({ reviews: reviews(), fill: 'mock' }));
    const out = await rows<LibraryOutRow>(libraryOut());
    expect(out.every((r) => r.review.status === 'reviewed' && r.review.mock === true)).toBe(true);
    expect((await readReviews(reviews())).length).toBe(12);
    const again = (
      await runStage(libraryStage, t.ctx({ reviews: reviews(), fill: 'mock' }), { force: true })
    ).result as { fill: { pending: number; requests?: number } };
    expect(again.fill).toEqual({ mode: 'mock', pending: 0 });
  }, 60_000);

  it('an edited text loses its review', async () => {
    const file = join(t.paths.content, 'authored', 'library', 'lib-003.md');
    const before = await readFile(file, 'utf8');
    await writeFile(file, before.replace('Ráno pijem čaj', 'Ráno pijem kávu'));
    try {
      await runStage(libraryStage, t.ctx({ reviews: reviews() }), { force: true });
      const out = await rows<LibraryOutRow>(libraryOut());
      expect(out.find((r) => r.id === 'lib-003')?.review.status).toBe('unreviewed');
      expect(out.filter((r) => r.review.status === 'reviewed')).toHaveLength(11);
    } finally {
      await writeFile(file, before);
    }
  }, 60_000);

  it('fails on a word that is no known form and on an A2 text beyond its vocabulary', async () => {
    const file = join(t.paths.content, 'authored', 'library', 'lib-002.md');
    const before = await readFile(file, 'utf8');
    try {
      await writeFile(
        file,
        before.replace('Najprv si napíšem zoznam', 'Najprv si napíšem zoznamik'),
      );
      await expect(
        runStage(libraryStage, t.ctx({ reviews: reviews() }), { force: true }),
      ).rejects.toThrow(/1 problems/);
      expect(t.logs.at(-1)).toContain('lib-002.md: not a known form: zoznamik');
      // Words ranked beyond 2,000 pushed into an A2 text.
      const rare = ' Syr, chlieb, syr, kila, chlieb a syr.'.repeat(3);
      await writeFile(file, before.trimEnd() + rare);
      await expect(
        runStage(libraryStage, t.ctx({ reviews: reviews() }), { force: true }),
      ).rejects.toThrow(/problems/);
      expect(t.logs.at(-1)).toMatch(
        /lib-002\.md: \d+\.\d % of the words lie within the 2000 most common lemmas; an A2 text needs 90\.0 %/,
      );
    } finally {
      await writeFile(file, before);
    }
  }, 60_000);

  it('assembles with morph, freq and scenarios into a set that validate passes', async () => {
    await runStage(scenariosStage, t.ctx());
    await runStage(libraryStage, t.ctx({ reviews: reviews(), fill: 'mock' }), { force: true });
    const r = await runStage(validateStage, t.ctx({ 'no-registry': true }, SET_STAGES), {
      force: true,
    });
    expect((r.result as { counts: Record<string, number> }).counts).toMatchObject({
      scenarios: 12,
      library: 12,
      triggers: 22,
    });
    const report = await readFile(join(t.paths.build, 'validate', 'report.md'), 'utf8');
    for (const id of ['library.texts', 'library.vocabulary', 'scenarios.rules', 'scenarios.slovak'])
      expect(report).toContain(`| ${id} | 0 |`);
  }, 120_000);

  it('the checks fail a set with an unknown word, a short or unmarked text, and a wrong trigger', async () => {
    const set = join(t.root, 'broken-set');
    await cp(t.paths.set, set, { recursive: true });
    const lib = await rows<Record<string, unknown>>(join(set, 'library.jsonl'));
    lib[0] = { ...lib[0], body: `${String(lib[0]?.body)} Blablabla.` };
    lib[1] = { ...lib[1], body: 'Som doma.' };
    delete lib[2]?.review;
    await writeJsonl(join(set, 'library.jsonl'), lib);
    const scn = await rows<Record<string, unknown>>(join(set, 'scenarios.jsonl'));
    scn[0] = { ...scn[0], targetTriggers: ['prep-s-ins', 'prep_na'], targetCases: ['acc'] };
    await writeJsonl(join(set, 'scenarios.jsonl'), scn);
    const checks = [
      libraryTextsCheck,
      libraryVocabularyCheck,
      scenarioRulesCheck,
      scenarioSlovakCheck,
    ];
    const r = await validateSet(set, checks, { complete: true });
    const messages = r.issues.map((i) => `${i.check}: ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^library\.vocabulary: library\.jsonl:1 \(lib-001\): not a known form: Blablabla$/,
        ),
        expect.stringMatching(
          /^library\.texts: library\.jsonl:2 \(lib-002\): 2 words, not 150 to 400$/,
        ),
        expect.stringMatching(
          /^library\.texts: library\.jsonl:3 \(lib-003\): not marked as reviewed or unreviewed$/,
        ),
        expect.stringMatching(/prep-s-ins" governs the ins, which is not a target case/),
        expect.stringMatching(/"prep_na" does not follow the id convention/),
      ]),
    );
    // The mini dataset is no starter library: outside a complete build these are warnings.
    const partial = await validateSet(set, checks, { complete: false });
    expect(Object.keys(partial.issueCounts)).toEqual(['scenarios.rules']);
  }, 60_000);
});
