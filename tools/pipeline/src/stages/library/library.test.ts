import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TextAnalysis } from '@app/contracts';
import { MINI_DIR } from '@app/testkit/mini';
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
  bodyHash,
  type LibraryOutRow,
  libraryAnalysisCheck,
  libraryStage,
  libraryTextsCheck,
  libraryVocabularyCheck,
  readReviews,
} from '.';
import { type LibraryAnalysis, writeAnalyses } from './analysis';
import { parseAuthoredText, readAuthoredTexts } from './authored';
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

  it('keeps the form tags of a word per lemma when the rows carry them', () => {
    const tagged = new FormIndex(new Set(['Mesta', 'mesta', 'dnes']));
    tagged.add('mesta', 20, 's2');
    tagged.add('mesta', 20, 'p1 p4 p5');
    tagged.add('dnes', 71, '');
    tagged.add('mesto', 20, 's1 s4 s5'); // not a wanted spelling
    expect([...(tagged.tagsOf('Mesta', 20) ?? [])]).toEqual(['s2', 'p1', 'p4', 'p5']);
    expect(tagged.tagsOf('dnes', 71)).toEqual(new Set());
    expect(tagged.tagsOf('mesta', 21)).toBeUndefined();
    expect(tagged.tagsOf('mesto', 20)).toBeUndefined();
    // Rows without tags give candidates but no readings.
    expect(index.tagsOf('som', 1)).toBeUndefined();
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

  it('carries the analysis made for the current body of a text, and no other', async () => {
    const texts = await readAuthoredTexts(join(t.paths.content, 'authored', 'library'));
    const body = (id: string) => texts.find((x) => x.id === id)?.body ?? '';
    const analysis: TextAnalysis = { v: 1, sentences: [], lemmas: {} };
    const row = (id: string, hash: string): LibraryAnalysis => ({
      id,
      bodyHash: hash,
      tokenCount: 180,
      lemmaCounts: { '7': 2 },
      analysis,
      methods: { single: 100, rule: 60, model: 20, guess: 0 },
      route: 'reader.disambiguate',
      promptVersion: 1,
      model: 'tester',
      requestHashes: [],
    });
    const file = join(t.root, 'analysis.jsonl');
    await writeAnalyses(file, [
      row('lib-004', bodyHash(body('lib-004'))),
      row('lib-005', bodyHash(`${body('lib-005')} Zmena.`)), // made for another body
    ]);
    const r = await runStage(libraryStage, t.ctx({ reviews: reviews(), analysis: file }), {
      force: true,
    });
    expect(r.result).toMatchObject({ texts: 12, analysed: 1 });
    const out = await rows<LibraryOutRow>(libraryOut());
    expect(out.find((x) => x.id === 'lib-004')).toMatchObject({
      analysis,
      lemmaCounts: { '7': 2 },
    });
    expect(out.filter((x) => x.analysis !== undefined).map((x) => x.id)).toEqual(['lib-004']);
    expect(out.find((x) => x.id === 'lib-005')?.lemmaCounts).toBeUndefined();
    const report = await readFile(join(t.paths.build, 'library', 'report.md'), 'utf8');
    expect(report).toContain('1 with a word by word analysis of their current body');
    expect(report).toMatch(/\| lib-004 \|.*\| 180 words, 20 chosen by tester \|/u);
    expect(report).toMatch(/\| lib-005 \|.*\| none \|/u);
    // Without the file the rows carry no analysis again.
    await runStage(libraryStage, t.ctx({ reviews: reviews() }), { force: true });
    expect((await rows<LibraryOutRow>(libraryOut())).every((x) => x.analysis === undefined)).toBe(
      true,
    );
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

describe('library.analysis', () => {
  let t: TempRoot;
  type Token = { s: number; e: number; t: string; l?: number; tag?: string; m?: string };
  type Lib = {
    id: string;
    body: string;
    analysis?: { sentences: { s: number; e: number; tokens: Token[] }[]; lemmas: object };
    lemmaCounts?: Record<string, number>;
  };
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  /** The mini set with its one library text changed by `edit`; the messages of the check. */
  async function check(name: string, edit: (row: Lib) => void, complete = false) {
    const set = join(t.root, name);
    await cp(MINI_DIR, set, { recursive: true });
    const lib = await rows<Lib>(join(set, 'library.jsonl'));
    edit(lib[0] as Lib);
    await writeJsonl(join(set, 'library.jsonl'), lib);
    const r = await validateSet(set, [libraryAnalysisCheck], { complete });
    return {
      issues: r.issues.map((i) => i.message),
      warnings: r.warnings.map((i) => i.message),
    };
  }
  /** The token of the first word written `word`. */
  const token = (row: Lib, word: string) => {
    for (const s of row.analysis?.sentences ?? [])
      for (const x of s.tokens) if (row.body.slice(x.s, x.e) === word) return x;
    throw new Error(`no token ${word}`);
  };

  it('passes the analysis of the mini dataset', async () => {
    expect(await check('ok', () => undefined)).toEqual({ issues: [], warnings: [] });
  });

  it('names a reading that is no form of its lemma or has another tag', async () => {
    const r = await check('readings', (row) => {
      token(row, 'práce').tag = 's4'; // do práce: the genitive
      token(row, 'deň').l = 20; // mesto
      delete token(row, 'ulici').tag;
    });
    expect(r.issues).toEqual([
      expect.stringMatching(
        /^library\.jsonl:1 \(lib-001\): "deň" is no form of lemma 20 \(mesto\)$/u,
      ),
      expect.stringMatching(/"práce" as a form of práca is .*s2.*, not s4$/u),
      expect.stringMatching(/"ulici" as a form of ulica is .*s6.*, not without a tag$/u),
      expect.stringMatching(/lemmaCounts does not match the word tokens of the analysis$/u),
    ]);
  });

  it('names spans out of order, a missing word token and a lemma the analysis does not list', async () => {
    const spans = await check('spans', (row) => {
      const s = row.analysis?.sentences[1];
      if (s) s.e = row.body.length + 5;
    });
    expect(spans.issues).toEqual([
      expect.stringMatching(/sentence 2 spans \d+ to \d+, out of order or outside the text$/u),
    ]);
    const tokens = await check('tokens', (row) => {
      const s = row.analysis?.sentences[1];
      if (s) s.tokens = [s.tokens[1] as Token, s.tokens[0] as Token, ...s.tokens.slice(2)];
    });
    expect(tokens.issues).toEqual([
      expect.stringMatching(/a token of sentence 2 spans \d+ to \d+, out of order or outside/u),
    ]);
    const missing = await check('missing', (row) => {
      row.analysis?.sentences[1]?.tokens.shift(); // "Dnes", lemma 71, counted twice in the text
      if (row.analysis) row.analysis.lemmas = { ...row.analysis.lemmas, '30': undefined };
    });
    expect(missing.issues).toEqual([
      expect.stringMatching(/"deň" points at lemma 30, which the analysis does not list$/u),
      expect.stringMatching(/the analysis has \d+ word tokens, the text has \d+ words$/u),
      expect.stringMatching(/lemmaCounts does not match/u),
    ]);
  });

  it('a guessed reading fails a complete build and is a warning elsewhere', async () => {
    const guess = (row: Lib) => {
      token(row, 'deň').m = 'guess';
    };
    const partial = await check('guess', guess);
    expect(partial.issues).toEqual([]);
    expect(partial.warnings).toEqual([
      expect.stringMatching(/1 words carry a guessed reading; run the analysis stage/u),
    ]);
    const complete = await check('guess-complete', guess, true);
    expect(complete.issues).toEqual([expect.stringMatching(/1 words carry a guessed reading/u)]);
  });

  it('warns about a text without an analysis and a lemma without a gloss', async () => {
    const none = await check('none', (row) => {
      delete row.analysis;
      delete row.lemmaCounts;
    });
    expect(none).toEqual({
      issues: [],
      warnings: [
        '1 texts have no analysis of their current body (the app analyses them on first use): lib-001',
      ],
    });
    const bare = await check('bare', (row) => {
      const lemmas = row.analysis?.lemmas as Record<string, { gloss: string[] }>;
      (lemmas['30'] as { gloss: string[] }).gloss = [];
    });
    expect(bare.warnings).toEqual([expect.stringMatching(/1 lemmas have no gloss: deň$/u)]);
  });
});
