import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from '../lib/files';
import { type Paths, pathsFor } from '../lib/paths';
import { offlineAnswersDir, offlineRequestsDir } from '../model/options';
import type { OfflineRequest } from '../model/runner';
import { analyse } from '../stages/sentences/analyze';
import { lexiconFiles, loadLexicon } from '../stages/sentences/lexicon';
import {
  answerPath,
  describeForms,
  describeWords,
  lintRequests,
  OFFLINE_ROUTES,
  openRequests,
  pick,
  putItems,
  type RequestReport,
  renderLint,
  SKIP,
  sentenceErrors,
  showRequest,
  skipRequests,
  specOf,
  tally,
} from './lint';

let root: string;
let paths: Paths;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'offline-'));
  paths = pathsFor(root);
});
afterEach(() => rm(root, { recursive: true, force: true }));

async function write(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
const jsonl = (rows: unknown[]) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

/** A request file as offline mode writes it; the hash only names the file here. */
async function request(stage: string, route: string, hash: string, jobs: string[], user: unknown) {
  const r: OfflineRequest = {
    hash,
    route,
    promptVersion: 1,
    effort: 'low',
    jobs,
    system: 'system prompt',
    user: JSON.stringify(user),
    schema: {},
  };
  await write(join(offlineRequestsDir(paths, stage), route, `${hash}.json`), JSON.stringify(r));
  return r;
}
const answer = (stage: string, route: string, hash: string, value: unknown) =>
  write(
    join(offlineAnswersDir(paths, stage), route, `${hash}.json`),
    typeof value === 'string' ? value : JSON.stringify(value),
  );

/** A morphology of a few words: mesto and the words around it; hrad is not ranked. */
async function morphology(): Promise<void> {
  const lemmas = [
    { id: 1, key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n' },
    { id: 2, key: 'do|prep||1', lemma: 'do', pos: 'prep', flags: { cases: ['gen'] } },
    { id: 3, key: 'ísť|verb||1', lemma: 'ísť', pos: 'verb' },
    { id: 4, key: 'veľký|adj||1', lemma: 'veľký', pos: 'adj' },
    { id: 5, key: 'dnes|adv||1', lemma: 'dnes', pos: 'adv' },
    { id: 6, key: 'hrad|noun|m_inan|1', lemma: 'hrad', pos: 'noun', gender: 'm_inan' },
    { id: 7, key: 'Eva|noun|f|1', lemma: 'Eva', pos: 'noun', gender: 'f' },
  ];
  const forms = [
    { lemmaId: 1, form: 'mesto', tags: 's1 s4 s5' },
    { lemmaId: 1, form: 'mesta', tags: 's2 p1 p4 p5' },
    { lemmaId: 1, form: 'meste', tags: 's6' },
    { lemmaId: 2, form: 'do', tags: '' },
    { lemmaId: 3, form: 'idem', tags: 'v:Kesa+' },
    { lemmaId: 4, form: 'veľkého', tags: 's2m s2i s2n s4m' },
    { lemmaId: 4, form: 'veľké', tags: 's1n s4n' },
    { lemmaId: 5, form: 'dnes', tags: '' },
    { lemmaId: 6, form: 'hradu', tags: 's2 s3' },
    { lemmaId: 7, form: 'Eva', tags: 's1' },
  ];
  const ranks = [
    {
      id: 1,
      freqRank: 130,
      topForms: [
        { form: 'mesta', tag: 's2', share: 0.3 },
        { form: 'meste', tag: 's6', share: 0.3 },
      ],
    },
    { id: 2, freqRank: 10 },
    { id: 3, freqRank: 50 },
    { id: 4, freqRank: 90 },
    { id: 5, freqRank: 200 },
  ];
  await write(join(paths.build, 'morph', 'lemmas.jsonl'), jsonl(lemmas));
  await write(join(paths.build, 'morph', 'forms.jsonl'), jsonl(forms));
  await write(join(paths.build, 'freq', 'lemmas.jsonl'), jsonl(ranks));
}

describe('pick', () => {
  const r = (hash: string, ...jobs: string[]) => ({ hash, jobs }) as OfflineRequest;
  const all = [r('aa11', 'g0'), r('ab22', 'acc.sg.f#0'), r('cc33', 'acc.sg.f#1'), r('dd44', 'g10')];

  it('takes every request when no name is given', () => {
    expect(pick(all, [])).toHaveLength(4);
  });

  it('finds a request by the start of its hash, by a job id, or all of a bucket', () => {
    expect(pick(all, ['cc']).map((x) => x.hash)).toEqual(['cc33']);
    expect(pick(all, ['g0']).map((x) => x.hash)).toEqual(['aa11']);
    expect(pick(all, ['acc.sg.f']).map((x) => x.hash)).toEqual(['ab22', 'cc33']);
    expect(pick(all, ['g10', 'aa1', 'g0']).map((x) => x.hash)).toEqual(['aa11', 'dd44']);
  });

  it('refuses a name that fits no request or several hashes', () => {
    expect(() => pick(all, ['a'])).toThrow(/names 2 open requests/u);
    expect(() => pick(all, ['zz'])).toThrow(/names 0 open requests/u);
  });
});

describe('renderLint and tally', () => {
  const reports: RequestReport[] = [
    { hash: 'aa', state: 'missing', items: [] },
    { hash: 'bb', state: 'invalid', problem: 'schema: items: Required', items: [] },
    {
      hash: 'cc',
      state: 'checked',
      items: [
        { id: '0', errors: [], hints: [] },
        { id: '1', errors: ['rare word "hradu"'], hints: ['look again'] },
        { id: '2', errors: [], hints: [], skipped: true },
      ],
    },
  ];

  it('prints one line per request and one per problem or hint', () => {
    expect(renderLint(reports).split('\n')).toEqual([
      'aa: NO ANSWER FILE',
      'bb: REFUSED WHOLE: schema: items: Required',
      'cc: 1 items REJECTED, 1 with hints, 1 left out (SKIP)',
      '  1  ERROR  rare word "hradu"',
      '  1  hint   look again',
    ]);
  });

  it('counts what passes, what fails and what the writer left out', () => {
    expect(tally(reports)).toEqual({ pass: 1, rejected: 1, skipped: 1 });
  });
});

describe('glosses', () => {
  const words = [
    { key: 'robiť|verb||1', lemma: 'robiť', pos: 'verb', aspect: 'ipf', forms: ['robí'] },
    { key: 'mesto|noun|n|1', lemma: 'mesto', pos: 'noun', gender: 'n' },
  ];

  it('shows a request with the path of its answer', async () => {
    const r = await request('dict', 'content.glosses', 'aa11', ['g0'], words);
    expect(showRequest(paths, 'dict', r).split('\n')).toEqual([
      '# request aa11',
      `# answer file: ${answerPath(paths, 'dict', 'content.glosses', 'aa11')}`,
      'key\taspect\tmost used forms',
      'robiť|verb||1\tipf\trobí',
      'mesto|noun|n|1\t\t',
    ]);
  });

  it('tells a missing answer, one the runner would refuse and a checked one', async () => {
    await request('dict', 'content.glosses', 'aa11', ['g0'], words);
    await request('dict', 'content.glosses', 'bb22', ['g1'], words);
    await request('dict', 'content.glosses', 'cc33', ['g2'], words);
    await request('dict', 'content.glosses', 'dd44', ['g3'], words);
    await answer('dict', 'content.glosses', 'bb22', '{ not json');
    await answer('dict', 'content.glosses', 'cc33', {
      items: [{ key: 'robiť|verb||1', glosses: ['to do'] }],
    });
    await answer('dict', 'content.glosses', 'dd44', {
      items: [
        { key: 'robiť|verb||1', glosses: ['do', 'to make.'] },
        { key: 'mesto|noun|n|1', glosses: ['town', 'the city'] },
      ],
    });
    const open = await openRequests(paths, 'dict', 'content.glosses');
    expect(open.map((r) => r.hash)).toEqual(['aa11', 'bb22', 'cc33', 'dd44']);
    const reports = await lintRequests(paths, 'dict', 'content.glosses', open);
    expect(reports.map((r) => r.state)).toEqual(['missing', 'invalid', 'invalid', 'checked']);
    expect(reports[1]?.problem).toMatch(/^not JSON/u);
    expect(reports[2]?.problem).toBe('check: key "mesto|noun|n|1" not answered');
    expect(reports[3]?.items).toEqual([
      {
        id: 'robiť|verb||1',
        errors: [],
        hints: [
          'verb gloss "do" does not start with "to"',
          'gloss "to make." ends with punctuation',
        ],
      },
      { id: 'mesto|noun|n|1', errors: [], hints: ['noun gloss "the city" has an article'] },
    ]);
  });

  it('knows its stages and routes', () => {
    expect(() => specOf('dict', 'content.sentences')).toThrow(/no offline route/u);
    expect(specOf('sentences', 'content.review')).toBe(
      OFFLINE_ROUTES.sentences?.['content.review'],
    );
    expect(Object.keys(OFFLINE_ROUTES.analysis ?? {})).toEqual([
      'reader.disambiguate',
      'reader.gloss',
    ]);
  });
});

describe('analysis', () => {
  const readings = {
    contexts: ['Vidím ženy v meste.', 'Je to dobré.'],
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
      {
        w: 1,
        context: 1,
        word: 'Je',
        readings: [
          { i: 0, lemma: 'byť', pos: 'verb', verbTag: 'Kesc+' },
          { i: 1, lemma: 'jesť', pos: 'verb', verbTag: 'Kesc+' },
        ],
      },
    ],
  };
  const glosses = {
    lemmas: [
      { lemmaId: 21, lemma: 'kino', pos: 'noun', gender: 'n' },
      { lemmaId: 67, lemma: 'kúpiť', pos: 'verb', aspect: 'pf' },
    ],
  };

  it('shows the open words of a text under their sentences, each reading by its index', async () => {
    const r = await request('analysis', 'reader.disambiguate', 'aa11', ['lib-001'], readings);
    expect(showRequest(paths, 'analysis', r).split('\n')).toEqual([
      '# request aa11',
      `# answer file: ${answerPath(paths, 'analysis', 'reader.disambiguate', 'aa11')}`,
      '[0] Vidím ženy v meste.',
      '0\tženy\t0: žena noun gen sg f | 1: žena noun acc pl f',
      '[1] Je to dobré.',
      '1\tJe\t0: byť verb Kesc+ | 1: jesť verb Kesc+',
    ]);
    const g = await request('analysis', 'reader.gloss', 'bb22', ['glosses'], glosses);
    expect(showRequest(paths, 'analysis', g).split('\n').slice(2)).toEqual([
      'lemmaId\tlemma\tpos\tgender\taspect',
      '21\tkino\tnoun\tn\t',
      '67\tkúpiť\tverb\t\tpf',
    ]);
  });

  it('checks picks and glosses as the offline gateway will', async () => {
    await request('analysis', 'reader.disambiguate', 'aa11', ['lib-001'], readings);
    await request('analysis', 'reader.disambiguate', 'bb22', ['lib-002'], readings);
    await request('analysis', 'reader.disambiguate', 'cc33', ['lib-003'], readings);
    await answer('analysis', 'reader.disambiguate', 'bb22', { picks: [{ w: 0, c: 2 }] });
    await answer('analysis', 'reader.disambiguate', 'cc33', {
      picks: [
        { w: 0, c: 1 },
        { w: 1, c: 0 },
      ],
    });
    const open = await openRequests(paths, 'analysis', 'reader.disambiguate');
    expect(pick(open, ['lib-002']).map((r) => r.hash)).toEqual(['bb22']);
    const reports = await lintRequests(paths, 'analysis', 'reader.disambiguate', open);
    expect(reports.map((r) => r.state)).toEqual(['missing', 'invalid', 'checked']);
    expect(reports[1]?.problem).toBe(
      'check: word 0 ("ženy") has no reading 2; no pick for word 1 ("Je")',
    );
    expect(renderLint(reports).split('\n')).toEqual([
      'aa11: NO ANSWER FILE',
      'bb22: REFUSED WHOLE: check: word 0 ("ženy") has no reading 2; no pick for word 1 ("Je")',
      'cc33: ok',
    ]);

    const g = await request('analysis', 'reader.gloss', 'dd44', ['glosses'], glosses);
    await answer('analysis', 'reader.gloss', 'dd44', {
      glosses: [{ lemmaId: 21, glosses: ['cinema'] }],
    });
    const refused = await lintRequests(paths, 'analysis', 'reader.gloss', [g]);
    expect(refused[0]).toMatchObject({
      state: 'invalid',
      problem: 'check: no glosses for lemma 67 (kúpiť)',
    });
    await answer('analysis', 'reader.gloss', 'dd44', {
      glosses: [
        { lemmaId: 21, glosses: ['cinema'] },
        { lemmaId: 67, glosses: ['to buy'] },
      ],
    });
    expect((await lintRequests(paths, 'analysis', 'reader.gloss', [g]))[0]?.state).toBe('checked');
  });
});

describe('sentences', () => {
  const item = (n: number, form: string, tag: string, formIs: string) => ({
    n,
    lemma: 'mesto',
    pos: 'noun',
    gender: 'n',
    form,
    tag,
    formIs,
  });

  it('names every reason the rules refuse a sentence', async () => {
    await morphology();
    const texts = ['dnes idem do 2 Mesta (hradu) xyz', 'Dnes idem do veľkého mesta.'];
    const lex = await loadLexicon(
      lexiconFiles(paths.build),
      3000,
      new Set(texts.flatMap((t) => t.toLowerCase().split(/[^\p{L}]+/u))),
    );
    expect(sentenceErrors(analyse(texts[1] as string, lex), lex)).toEqual([]);
    expect(sentenceErrors(analyse(texts[0] as string, lex), lex)).toEqual([
      'a number in digits',
      'no capital letter at the start',
      'no . ? ! or … at the end',
      'punctuation not allowed: ( )',
      'unknown word "Mesta" (a capital inside a sentence is read as a name; names are not in the vocabulary)',
      'rare word "hradu" (hrad noun, not ranked): outside the 3000 most common',
      'unknown word "xyz"',
    ]);
    expect(sentenceErrors(analyse('Idem do mesta.', lex), lex)).toEqual(['3 words, not 4 to 12']);
  });

  it('checks answers as the stage will, with hints and SKIPs', async () => {
    await morphology();
    const r = await request(
      'sentences',
      'content.sentences',
      'aa11',
      ['s0'],
      [
        item(0, 'mesta', 's2', 'genitive singular'),
        item(1, 'meste', 's6', 'locative singular'),
        item(2, 'mesta', 's2', 'genitive singular'),
        item(3, 'mesta', 's2', 'genitive singular'),
        item(4, 'meste', 's6', 'locative singular'),
      ],
    );
    await answer('sentences', 'content.sentences', 'aa11', {
      items: [
        { n: 0, sk: 'Dnes idem do veľkého mesta.', en: 'I am going to a big town today.' },
        { n: 1, sk: 'Dnes idem do veľkého meste.', en: 'I am going to a big town today.' },
        { n: 2, sk: 'Dnes idem do hradu mesta.', en: "I am going to the town's castle today." },
        { n: 3, sk: 'Dnes idem do veľkého mesta.', en: 'Today I am going to a big town.' },
        { n: 4, sk: SKIP, en: SKIP },
      ],
    });
    const [report] = await lintRequests(paths, 'sentences', 'content.sentences', [r]);
    expect(report?.state).toBe('checked');
    expect(report?.items).toEqual([
      { id: '0', errors: [], hints: [] },
      {
        id: '1',
        errors: [],
        hints: [
          'after "do" (takes gen) "meste" has no such reading; it can be loc',
          '"veľkého meste" do not agree in case, number and gender in any reading',
        ],
      },
      {
        id: '2',
        errors: ['rare word "hradu" (hrad noun, not ranked): outside the 3000 most common'],
        hints: [],
      },
      { id: '3', errors: [], hints: ['the same sentence as aa11 n=0'] },
      { id: '4', errors: [], hints: [], skipped: true },
    ]);
    expect(tally([report as RequestReport])).toEqual({ pass: 3, rejected: 1, skipped: 1 });
  });

  it('says why the asked form is not shown', async () => {
    await morphology();
    const r = await request(
      'sentences',
      'content.sentences',
      'aa11',
      ['s0'],
      [
        item(0, 'mesta', 's2', 'genitive singular'),
        { ...item(1, 'mesta', 's2', 'genitive singular'), lemma: 'mestečko' },
      ],
    );
    await answer('sentences', 'content.sentences', 'aa11', {
      items: [
        { n: 0, sk: 'Dnes idem do veľkého meste.', en: 'I am going to a big town today.' },
        { n: 1, sk: 'Dnes idem do veľkého mesta.', en: 'I am going to a big town today.' },
      ],
    });
    const [report] = await lintRequests(paths, 'sentences', 'content.sentences', [r]);
    expect(report?.items[0]?.errors).toEqual(['the form "mesta" is not in the sentence']);
    expect(report?.items[1]?.errors).toEqual(['no ranked lemma "mestečko" (noun) has this form']);
  });
});

describe('put and skip', () => {
  const exercise = (bucket: string, from: number) => ({
    bucket: 'accusative singular, feminine nouns',
    vocabularyLimit: 3000,
    names: ['Eva'],
    triggers: [{ id: 'verb-mat', kind: 'verb', word: 'mám', meaning: 'to have' }],
    items: [from, from + 1].map((i) => ({
      slot: `${bucket}/00${i}`,
      trigger: 'verb-mat',
      gap: `gap${i}`,
      words: [{ form: `gap${i}`, lemma: 'x' }],
    })),
  });
  const read = async (hash: string) =>
    JSON.parse(
      await readFile(answerPath(paths, 'exercises', 'content.exercises', hash), 'utf8'),
    ) as { items: { slot: string; sentenceSk: string }[] };

  beforeEach(async () => {
    await request(
      'exercises',
      'content.exercises',
      'aa11',
      ['acc.sg.f#0'],
      exercise('acc.sg.f', 0),
    );
    await request(
      'exercises',
      'content.exercises',
      'bb22',
      ['acc.sg.f#1'],
      exercise('acc.sg.f', 2),
    );
    await request(
      'exercises',
      'content.exercises',
      'cc33',
      ['gen.sg.f#0'],
      exercise('gen.sg.f', 0),
    );
  });

  it('writes the answers of a whole bucket from a list, with SKIP for what the list leaves out', async () => {
    const list = join(root, 'acc.sg.f.jsonl');
    await write(
      list,
      jsonl([
        { slot: 'acc.sg.f/001', sentenceSk: 'Mám gap1.', sentenceEn: 'I have it.', gap: 'gap1' },
      ]),
    );
    expect(await putItems(paths, 'exercises', 'content.exercises', list)).toEqual(['aa11', 'bb22']);
    expect((await read('aa11')).items.map((i) => i.sentenceSk)).toEqual([SKIP, 'Mám gap1.']);
    expect((await read('bb22')).items.map((i) => i.sentenceSk)).toEqual([SKIP, SKIP]);
    expect(existsSync(answerPath(paths, 'exercises', 'content.exercises', 'cc33'))).toBe(false);

    // A second put of a shorter list takes back what the first one wrote.
    await write(
      list,
      jsonl([
        { slot: 'acc.sg.f/002', sentenceSk: 'Mám gap2.', sentenceEn: 'I have it.', gap: 'gap2' },
      ]),
    );
    await putItems(paths, 'exercises', 'content.exercises', list);
    expect((await read('aa11')).items.map((i) => i.sentenceSk)).toEqual([SKIP, SKIP]);
    expect((await read('bb22')).items.map((i) => i.sentenceSk)).toEqual(['Mám gap2.', SKIP]);
  });

  it('refuses a list with an item no open request asks for, and writes nothing', async () => {
    const list = join(root, 'list.jsonl');
    await write(
      list,
      jsonl([
        { slot: 'acc.sg.f/000', sentenceSk: 'Mám gap0.', sentenceEn: 'I have it.', gap: 'gap0' },
        { slot: 'acc.sg.f/009', sentenceSk: 'Mám gap9.', sentenceEn: 'I have it.', gap: 'gap9' },
      ]),
    );
    await expect(putItems(paths, 'exercises', 'content.exercises', list)).rejects.toThrow(
      /1 items .* asked by no open request/u,
    );
    expect(existsSync(answerPath(paths, 'exercises', 'content.exercises', 'aa11'))).toBe(false);
    await write(list, '{"slot":\n');
    await expect(putItems(paths, 'exercises', 'content.exercises', list)).rejects.toThrow(
      /list\.jsonl:1: not JSON/u,
    );
  });

  it('answers the requests nobody wrote with SKIPs, and leaves written answers alone', async () => {
    await answer('exercises', 'content.exercises', 'aa11', { items: [] });
    const open = await openRequests(paths, 'exercises', 'content.exercises');
    expect(await skipRequests(paths, 'exercises', 'content.exercises', open)).toEqual([
      'bb22',
      'cc33',
    ]);
    expect((await read('cc33')).items).toEqual([
      { slot: 'gen.sg.f/000', sentenceSk: SKIP, sentenceEn: SKIP, gap: 'gap0' },
      { slot: 'gen.sg.f/001', sentenceSk: SKIP, sentenceEn: SKIP, gap: 'gap1' },
    ]);
    expect((await read('aa11')).items).toEqual([]);
  });

  it('is only for routes with items a writer may leave out', async () => {
    await expect(putItems(paths, 'dict', 'content.glosses', 'x')).rejects.toThrow(
      /"put" does not know/u,
    );
  });
});

describe('word and forms', () => {
  it('tells what the morphology knows of a written form', async () => {
    await morphology();
    expect(await describeWords(paths, ['mesta', 'hradu', 'xyz'])).toEqual([
      'mesta: allowed',
      '  mesto (noun n), rank 130: s2 p1 p4 p5',
      'hradu: NOT within the 3000 most common',
      '  hrad (noun m_inan), not ranked: s2 s3',
      'xyz: not a known form',
    ]);
  });

  it('lists every form of a common lemma by tag', async () => {
    await morphology();
    expect(await describeForms(paths, ['mesto', 'hrad'])).toEqual([
      'mesto (noun n), rank 130',
      '  p1\tmesta',
      '  p4\tmesta',
      '  p5\tmesta',
      '  s1\tmesto',
      '  s2\tmesta',
      '  s4\tmesto',
      '  s5\tmesto',
      '  s6\tmeste',
      'hrad: no lemma within the 3000 most common is written this way',
    ]);
  });
});
