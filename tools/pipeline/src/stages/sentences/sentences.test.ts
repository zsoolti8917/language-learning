import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SentenceRow } from '@app/contracts';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readJsonl, writeJsonl } from '../../lib/files';
import { LemmaRegistry } from '../../lib/registry';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { STAGES } from '..';
import { allChecks } from '../validate';
import {
  type GeneratedRow,
  readGenerated,
  sentenceCoverageCheck,
  sentenceRulesCheck,
  sentencesStage,
} from '.';
import { analyse } from './analyze';
import { excludedPath, readExcluded } from './excluded';
import {
  type HarvestedSentence,
  parseConllu,
  readTatoeba,
  TATOEBA_SOURCE,
  withoutRepeats,
} from './harvest';
import { addAnimateAccusatives, Lexicon, lexiconFiles, loadLexicon } from './lexicon';
import { describeTag } from './prompts';
import {
  type Candidate,
  checkGenerated,
  choose,
  difficulty,
  sentenceProblem,
  targetsOf,
} from './rules';
import { seedSentencesSample } from './sample';

async function rows<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

async function miniRegistry(): Promise<LemmaRegistry> {
  const entries: [number, string][] = [];
  for await (const l of readJsonl<{ id: number; key: string }>(join(MINI_DIR, 'lemmas.jsonl')))
    entries.push([l.id, l.key]);
  return new LemmaRegistry(entries);
}

const ID = { mesto: 20, kniha: 12, ten: 42, ja: 37, byt: 60, praca: 15, zena: 11, dom: 6 };

describe('tokens, rules and choice on the mini lexicon', () => {
  let lex: Lexicon;
  beforeAll(async () => {
    lex = await loadLexicon(lexiconFiles('', MINI_DIR), 3000);
  });

  it('gives each word its readings and narrows them by rule', () => {
    const a = analyse('Bol som v práci.', lex);
    expect(a.words).toBe(4);
    const praci = a.tokens[3];
    // práci is s3 or s6; after v only the locative is left.
    expect(praci?.readings.map((r) => r.tag)).toEqual(['s6']);
    // A capital inside a sentence is a name: Tom is not tom, a form of ten.
    expect(analyse('Ja som Tom.', lex).tokens[2]?.readings).toEqual([]);
    // Tatoeba's stock name is a name at the start of a sentence too.
    expect(analyse('Tom je môj brat.', lex).tokens[0]?.readings).toEqual([]);
    // Agreement: tá kniha leaves the nominative (the vocative needs a comma or "!").
    const b = analyse('Tá kniha bola nová.', lex);
    expect(b.tokens[1]?.readings.map((r) => r.tag)).toEqual(['s1']);
  });

  it('takes the treebank reading when the treebank has one', () => {
    const s = parseConllu(
      [
        '# sent_id = demo-1',
        '# text = Aby to bolo nové mesto.',
        '1-2\tAby\t_\t_\t_\t_\t_\t_\t_\t_',
        '1\tAby\taby\tSCONJ\tO\t_\t0\troot\t_\t_',
        '2\tby\tby\tAUX\tY\t_\t0\troot\t_\t_',
        '3\tto\tto\tPRON\tPFns1\t_\t0\troot\t_\t_',
        '4\tbolo\tbyť\tAUX\tVLescn+\t_\t0\troot\t_\t_',
        '5\tnové\tnový\tADJ\tAAns4x\t_\t0\troot\t_\t_',
        '6\tmesto\tmesto\tNOUN\tSSns4\t_\t0\troot\t_\tSpaceAfter=No',
        '7\t.\t.\tPUNCT\tZ\t_\t0\troot\t_\t_',
      ].join('\n'),
    );
    expect(s?.words.map((w) => [w.form, w.s, w.e])).toEqual([
      ['to', 4, 6],
      ['bolo', 7, 11],
      ['nové', 12, 16],
      ['mesto', 17, 22],
      ['.', 22, 23],
    ]);
    const a = analyse(s?.text ?? '', lex, s?.words);
    expect(a.tokens[1]?.readings).toEqual([{ lemmaId: ID.ten, tag: 's1n', form: 'to' }]);
    expect(a.tokens[4]?.readings).toEqual([{ lemmaId: ID.mesto, tag: 's4', form: 'mesto' }]);
    expect(a.tokens[4]?.by).toBe('treebank');
    // The multiword token Aby has no single analysis; the lexicon does not know it.
    expect(a.tokens[0]?.readings).toEqual([]);
  });

  it('reads the plural in -ov of an animal noun as an accusative too', () => {
    const small = new Lexicon(3000);
    const add = (
      id: number,
      lemma: string,
      pos: 'noun' | 'verb' | 'num' | 'prep' | 'adv',
      forms: [string, string][],
      more: object = {},
    ) => {
      small.addLemma({
        id,
        key: `${lemma}|${pos}|${id}`,
        lemma,
        pos,
        freqRank: id,
        topForms: [],
        ...more,
      });
      for (const [form, tags] of forms) small.addForm(id, form, tags);
    };
    // The morphology files the singular and the plural of an animal under two lemmas.
    add(
      1,
      'pes',
      'noun',
      [
        ['pes', 's1'],
        ['psa', 's2 s4'],
      ],
      { gender: 'm_anim' },
    );
    add(
      2,
      'pes',
      'noun',
      [
        ['psy', 'p1 p4'],
        ['psov', 'p2'],
      ],
      { gender: 'm_inan', pluralOnly: true },
    );
    add(3, 'kôň', 'noun', [['kôň', 's1']], { gender: 'm_anim' });
    add(
      4,
      'kôň',
      'noun',
      [
        ['kone', 'p1 p4'],
        ['koní', 'p2'],
      ],
      { gender: 'm_inan', pluralOnly: true },
    );
    add(5, 'mať', 'verb', [['mám', 'v:Kesa+']]);
    add(6, 'dva', 'num', [['dvoch', 'p2m p2i p4m']]);
    add(7, 'bez', 'prep', [['bez', '']], { cases: ['gen'] });
    add(8, 'doma', 'adv', [['doma', '']]);
    add(9, 'stôl', 'noun', [['stolov', 'p2']], { gender: 'm_inan' });
    add(10, 'pokoj', 'noun', [['pokoj', 's4']], { gender: 'm_inan' });
    addAnimateAccusatives(small);
    expect(small.readings('psov', false)).toEqual([
      { lemmaId: 2, tag: 'p2', form: 'psov' },
      { lemmaId: 1, tag: 'p4', form: 'psov' },
    ]);
    // koní is the genitive only (the accusative is kone); a table has no animate lemma.
    expect(small.readings('koní', false)).toEqual([{ lemmaId: 4, tag: 'p2', form: 'koní' }]);
    expect(small.readings('stolov', false)).toEqual([{ lemmaId: 9, tag: 'p2', form: 'stolov' }]);
    // Mám doma dvoch psov: an accusative. Neither psov nor dvoch may show a genitive.
    const has = analyse('Mám doma dvoch psov.', small);
    expect(targetsOf(has, small).map((t) => t.form)).toEqual(['Mám', 'doma']);
    // After bez only the genitive is left, and the word can be shown.
    const without = analyse('Mám doma pokoj bez psov.', small);
    expect(targetsOf(without, small).find((t) => t.form === 'psov')).toMatchObject({
      lemmaId: 2,
      tag: 'p2',
    });
  });

  it('rejects a sentence of the wrong length, with a rare word, or with an unknown word', async () => {
    expect(sentenceProblem(analyse('Idem do mesta.', lex), lex)).toBe('length');
    expect(
      sentenceProblem(analyse('Ja mám dom a ty máš dom a on má nový dom a mesto.', lex), lex),
    ).toBe('length');
    expect(sentenceProblem(analyse('Ja mám jeden nový bicykel.', lex), lex)).toBe('unknown');
    expect(sentenceProblem(analyse('Ja mám päť nových kníh.', lex), lex)).toBeNull();
    // With only the top 40 counted as common, kniha (48) is a rare word.
    const top40 = await loadLexicon(lexiconFiles('', MINI_DIR), 40);
    expect(sentenceProblem(analyse('Ja mám dobrú knihu.', top40), top40)).toBe('rare');
    expect(sentenceProblem(analyse('Ja mám 5 kníh a dom.', lex), lex)).toBe('number');
    expect(sentenceProblem(analyse('„Ja mám dobrú knihu."', lex), lex)).toBe('punctuation');
  });

  it('rejects a generated sentence whose target form is missing or not a top form', () => {
    const want = { lemmaId: ID.mesto, form: 'mesta', tag: 's2' };
    expect(checkGenerated(analyse('Ja idem do mesta s bicyklom.', lex), lex, want)).toBe('unknown');
    expect(checkGenerated(analyse('Ja idem do mesta dnes.', lex), lex, want)).toMatchObject({
      tokenIndex: 3,
      lemmaId: ID.mesto,
      tag: 's2',
    });
    expect(checkGenerated(analyse('Ja bývam v meste dnes.', lex), lex, want)).toBe(
      'target-missing',
    );
    // mestami (p7) is a form of mesto, but not one of its most used forms.
    expect(
      checkGenerated(analyse('Ja som s mestami veľmi.', lex), lex, {
        lemmaId: ID.mesto,
        form: 'mestami',
        tag: 'p7',
      }),
    ).toBe('not-top-form');
    expect(checkGenerated(analyse('Mesta je.', lex), lex, want)).toBe('length');
  });

  it('finds the targets of a real sentence, scores it and chooses different forms first', () => {
    const a = analyse('Bol som v meste dnes.', lex);
    const targets = targetsOf(a, lex);
    expect(targets.map((t) => [t.form, t.tag])).toContainEqual(['meste', 's6']);
    // práci (s6) is not among the three most used forms of práca in the mini dataset.
    const rejected = new Map();
    expect(
      targetsOf(analyse('Bol som v práci dnes.', lex), lex, rejected).map((t) => t.form),
    ).not.toContain('práci');
    expect(rejected.get('not-top-form')).toBe(1);
    const d = difficulty(a, lex);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
    expect(difficulty(analyse('Ja som v práci a ty si v meste dnes.', lex), lex)).toBeGreaterThan(
      d,
    );
    const c = (id: string, form: string, tag: string, diff: number): Candidate => ({
      sentenceId: id,
      source: 'tatoeba',
      target: { tokenIndex: 0, lemmaId: ID.mesto, form, tag },
      difficulty: diff,
    });
    const picked = choose([
      c('tat-1', 'mesto', 's1', 0.1),
      c('tat-2', 'mesto', 's1', 0.11),
      c('tat-3', 'mesto', 's1', 0.12),
      c('tat-4', 'mesta', 's2', 0.5),
    ]).get(ID.mesto);
    expect(picked?.map((p) => p.sentenceId)).toEqual(['tat-1', 'tat-2', 'tat-4']);
  });

  it('describes tags for the prompt', () => {
    expect(describeTag('s2')).toBe('genitive singular');
    expect(describeTag('p4f')).toBe('accusative plural, feminine');
    expect(describeTag('x3')).toBe('dative');
    expect(describeTag('v:Kesc+')).toBe('present tense, 3rd person singular');
  });
});

describe('the harvest', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
    await seedSentencesSample(t.paths);
  });
  afterAll(() => t.remove());

  it('reads Tatoeba sentences with their English translation', async () => {
    const s = await readTatoeba(join(t.paths.raw, TATOEBA_SOURCE), { minWords: 4, maxWords: 12 });
    expect(s.length).toBeGreaterThan(50);
    expect(s.every((x) => x.textEn && x.id === `tat-${x.sourceRef}`)).toBe(true);
    expect(s.find((x) => x.sourceRef === '7702586')).toMatchObject({
      textSk: 'Bol som v práci.',
      license: 'CC BY 2.0 FR',
    });
  });
});

describe('repeated sentences', () => {
  it('leaves out a sentence written like an earlier one', () => {
    const s = (id: string, textSk: string): HarvestedSentence => ({
      id,
      source: 'ud',
      sourceRef: id,
      license: 'CC BY-SA 4.0',
      textSk,
    });
    const kept = withoutRepeats(
      [
        s('a', 'Inak bolo všetko v poriadku.'),
        s('b', 'Bol na slnku, oni v tieni.'),
        s('c', 'Inak bolo všetko v poriadku.'),
      ],
      // The texts of the Tatoeba sentences.
      new Set(['Bol na slnku, oni v tieni.']),
    );
    expect(kept.map((x) => x.id)).toEqual(['a']);
  });
});

describe('the sentences stage on the mini dataset', () => {
  let t: TempRoot;
  const generated = () => join(t.root, 'generated.jsonl');
  const outPath = () => join(t.paths.build, 'sentences', 'sentences.jsonl');
  beforeAll(async () => {
    t = await tempRoot();
    await seedSentencesSample(t.paths);
  });
  afterAll(() => t.remove());

  it('keeps real sentences without a fill, and leaves the treebank ones out until translated', async () => {
    const r = (await runStage(sentencesStage, t.ctx({ lexicon: MINI_DIR, generated: generated() })))
      .result as { rejected: Record<string, number>; kept: { tatoeba: number; ud: number } };
    expect(r.kept.tatoeba).toBeGreaterThan(5);
    expect(r.rejected.unknown).toBeGreaterThan(0);
    const out = await rows<SentenceRow>(outPath());
    // Idem do mesta. has three words: the harvest leaves it out.
    expect(out.some((s) => s.id === 'tat-8214994')).toBe(false);
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((s) => s.source === 'tatoeba')).toBe(true);
    expect(existsSync(generated())).toBe(false);
  });

  it('prints the request count and cost on a dry run and sends nothing', async () => {
    const logs: string[] = [];
    const ctx = {
      ...t.ctx({ lexicon: MINI_DIR, generated: generated(), fill: 'dry-run' }),
      log: (m: string) => logs.push(m),
    };
    const r = (await runStage(sentencesStage, ctx)).result as {
      fill: { gaps: number; routes: { route: string; sent: number; estimate: { usd: number } }[] };
    };
    expect(r.fill.gaps).toBeGreaterThan(0);
    expect(r.fill.routes.map((f) => f.route).sort()).toEqual([
      'content.review',
      'content.sentences',
      'content.translate',
    ]);
    expect(r.fill.routes.every((f) => f.sent === 0 && f.estimate.usd > 0)).toBe(true);
    const text = logs.join('\n');
    expect(text).toMatch(/content\.sentences: \d+ requests .* at batch prices/u);
    expect(text).toMatch(
      /sentences: fill dry-run: \d+ requests to send in all, \$[\d.]+ at batch/u,
    );
    expect(existsSync(generated())).toBe(false);
    expect(existsSync(join(t.paths.build, 'model-cache'))).toBe(false);
  });

  it('fills in mock mode: at least two sentences per noun, every row with source, licence and source id', async () => {
    const r = (
      await runStage(
        sentencesStage,
        t.ctx({ lexicon: MINI_DIR, generated: generated(), fill: 'mock' }),
      )
    ).result as { generated: number; perSource: Record<string, number> };
    expect(r.generated).toBeGreaterThan(0);
    expect(r.perSource.ud).toBeGreaterThan(0);
    const out = await rows<SentenceRow>(outPath());
    const lemmas = await rows<{ id: number; pos: string }>(join(MINI_DIR, 'lemmas.jsonl'));
    const per = new Map<number, Set<string>>();
    for (const s of out)
      for (const l of s.links) per.set(l.lemmaId, (per.get(l.lemmaId) ?? new Set()).add(s.id));
    const nouns = lemmas.filter((l) => l.pos === 'noun');
    expect(nouns).toHaveLength(31);
    for (const n of nouns)
      expect(per.get(n.id)?.size ?? 0, `noun ${n.id}`).toBeGreaterThanOrEqual(2);
    for (const l of lemmas) expect(per.get(l.id)?.size ?? 0).toBeLessThanOrEqual(3);
    const licences = { tatoeba: 'CC BY 2.0 FR', ud: 'CC BY-SA 4.0', generated: 'CC BY 4.0' };
    for (const s of out) {
      expect(s.license).toBe(licences[s.source]);
      expect(s.sourceRef).toBeTruthy();
      expect(s.verified).toBe(false);
      expect(s.id).toMatch(/^(tat|ud|gen)-[\w-]+$/u);
    }
    expect(out.find((s) => s.source === 'ud')?.textEn).toMatch(/^\[mock\] /u);
    // Mock rows land where they were told, never in content/generated.
    const gen = await readGenerated(generated());
    expect(gen.some((g: GeneratedRow) => g.kind === 'sentence')).toBe(true);
    expect(gen.some((g: GeneratedRow) => g.kind === 'translation')).toBe(true);
    expect(existsSync(join(t.paths.content, 'generated', 'sentences.jsonl'))).toBe(false);
  });

  it('reuses the generated rows: a rerun has nothing left to fill', async () => {
    const r = (
      await runStage(
        sentencesStage,
        t.ctx({ lexicon: MINI_DIR, generated: generated(), fill: 'dry-run' }),
        { force: true },
      )
    ).result as { fill: { untranslated: number; routes: { route: string; jobs: number }[] } };
    expect(r.fill.untranslated).toBe(0);
    expect(r.fill.routes.find((f) => f.route === 'content.sentences')).toBeUndefined();
  });

  it('refuses a live fill whose sentences and review together exceed --max-spend, before sending', async () => {
    const t2 = await tempRoot();
    try {
      await seedSentencesSample(t2.paths);
      // Keep the translations, drop the sentences: generation and review are left to do.
      const onlyTranslations = (await readGenerated(generated())).filter(
        (g) => g.kind === 'translation',
      );
      const g2 = join(t2.root, 'generated.jsonl');
      await writeJsonl(g2, onlyTranslations);
      await expect(
        runStage(
          sentencesStage,
          t2.ctx({ lexicon: MINI_DIR, generated: g2, fill: 'live', 'max-spend': '0.01' }),
        ),
      ).rejects.toThrow(/refusing to send \d+ requests: the estimate \$[\d.]+ is above the limit/u);
      expect(existsSync(join(t2.paths.build, 'model-cache'))).toBe(false);
    } finally {
      await t2.remove();
    }
  });

  it('passes validate together with the rest of the mini dataset', async () => {
    const dir = join(t.root, 'set');
    await cp(MINI_DIR, dir, { recursive: true });
    const out = await rows<SentenceRow>(outPath());
    await writeJsonl(join(dir, 'sentences.jsonl'), out);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
    manifest.counts.sentences = out.length;
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    // The mini lessons have three steps, not C4's five: the C4 checks are tested in their stages.
    const stages = STAGES.filter((s) => !['triggers', 'lessons', 'exercises'].includes(s.name));
    const r = await validateSet(dir, allChecks(stages), { registry: await miniRegistry() });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.issueCounts['sentences.rules']).toBeUndefined();
  });
});

describe('the exclusion list', () => {
  let t: TempRoot;
  const generated = () => join(t.root, 'generated.jsonl');
  const outPath = () => join(t.paths.build, 'sentences', 'sentences.jsonl');
  const run = () =>
    runStage(sentencesStage, t.ctx({ lexicon: MINI_DIR, generated: generated() }), {
      force: true,
    });
  beforeAll(async () => {
    t = await tempRoot();
    await seedSentencesSample(t.paths);
  });
  afterAll(() => t.remove());

  it('reads texts with their reasons, and nothing when the file is missing', async () => {
    expect(await readExcluded(excludedPath(t.paths))).toEqual(new Map());
    const file = join(t.root, 'list.yaml');
    await writeFile(file, '- text: " Idem domov. "\n  reason: A test.\n');
    expect(await readExcluded(file)).toEqual(new Map([['Idem domov.', 'A test.']]));
    await writeFile(file, '- text: Idem domov.\n');
    await expect(readExcluded(file)).rejects.toThrow(/list\.yaml: 0\.reason/u);
    await writeFile(file, '- text: Idem domov.\n  reason: x\n  by: me\n');
    await expect(readExcluded(file)).rejects.toThrow(/by/u);
  });

  it('leaves a listed sentence out of the kept sentences and counts it', async () => {
    const before = (await run()).result as { excluded: number; kept: { tatoeba: number } };
    expect(before.excluded).toBe(0);
    const first = (await rows<SentenceRow>(outPath()))[0] as SentenceRow;
    await mkdir(join(t.paths.content, 'authored', 'sentences'), { recursive: true });
    await writeFile(
      excludedPath(t.paths),
      `- text: ${JSON.stringify(first.textSk)}\n  reason: Wrong Slovak in the source.\n` +
        '- text: Táto veta v zdrojoch nie je.\n  reason: Not in any source.\n',
    );
    const after = (await run()).result as { excluded: number; kept: { tatoeba: number } };
    expect(after.excluded).toBe(1);
    expect(after.kept.tatoeba).toBe(before.kept.tatoeba - 1);
    const out = await rows<SentenceRow>(outPath());
    expect(out.some((s) => s.textSk === first.textSk)).toBe(false);
    const report = await readFile(join(t.paths.build, 'sentences', 'report.md'), 'utf8');
    expect(report).toContain('| listed in content/authored/sentences/excluded.yaml | 1 |');
  });
});

describe('the sentence checks', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
  });
  afterAll(() => t.remove());

  it('fail a row without a source id, a link off its token, a wrong length, a rare word and a wrong form', async () => {
    const dir = join(t.root, 'set');
    await writeJsonl(join(dir, 'lemmas.jsonl'), [
      {
        id: 20,
        key: 'mesto|noun|n|1',
        lemma: 'mesto',
        pos: 'noun',
        gender: 'n',
        freqRank: 43,
        topForms: [{ form: 'mesto', tag: 's1', share: 0.3 }],
      },
      { id: 50, key: 'v|prep||1', lemma: 'v', pos: 'prep', freqRank: 8 },
      { id: 99, key: 'zámok|noun|m_inan|1', lemma: 'zámok', pos: 'noun', freqRank: 4000 },
    ]);
    const row = (over: Partial<SentenceRow>): SentenceRow => ({
      id: 'gen-00000001',
      textSk: 'Mesto je tu dnes.',
      textEn: 'The town is here today.',
      tokens: [{ s: 0, e: 5, lemmaId: 20, tag: 's1' }],
      difficulty: 0.2,
      source: 'generated',
      sourceRef: 'content.sentences:abc',
      license: 'CC BY 4.0',
      verified: false,
      links: [{ lemmaId: 20, tokenIndex: 0, form: 'Mesto', tag: 's1', ord: 0 }],
      ...over,
    });
    await writeJsonl(join(dir, 'sentences.jsonl'), [
      row({ id: 'gen-00000001', sourceRef: undefined }),
      row({
        id: 'gen-00000002',
        links: [{ lemmaId: 20, tokenIndex: 0, form: 'Mesto', tag: 's4', ord: 0 }],
      }),
      row({ id: 'gen-00000003', textSk: 'Mesto je.' }),
      row({
        id: 'gen-00000004',
        textSk: 'Mesto je zámok dnes.',
        tokens: [
          { s: 0, e: 5, lemmaId: 20, tag: 's1' },
          { s: 9, e: 14, lemmaId: 99, tag: 's1' },
        ],
      }),
      row({
        id: 'gen-00000005',
        textSk: 'Mestá sú tu dnes.',
        tokens: [{ s: 0, e: 5, lemmaId: 20, tag: 'p1' }],
        links: [{ lemmaId: 20, tokenIndex: 0, form: 'Mestá', tag: 'p1', ord: 0 }],
      }),
      row({ id: 'gen-00000006' }),
    ]);
    const r = await validateSet(dir, [sentenceRulesCheck, sentenceCoverageCheck], {
      complete: true,
    });
    expect(r.issues.map((i) => i.message)).toEqual([
      'sentences.jsonl:1 (gen-00000001): no source id (sourceRef)',
      'sentences.jsonl:2 (gen-00000002): link to lemma 20 (s4) does not match token 0',
      'sentences.jsonl:2 (gen-00000002): "Mesto" (s4) is not a top form of lemma 20',
      'sentences.jsonl:3 (gen-00000003): 2 words',
      'sentences.jsonl:4 (gen-00000004): "zámok" is lemma 99, ranked 4000',
      'sentences.jsonl:5 (gen-00000005): "Mestá" (p1) is not a top form of lemma 20',
      // mesto has six sentences; v (ranked 8) none: 1 of 2 short fails a complete build.
      '1 of 2 lemmas ranked up to 3000 have fewer than 2 sentences, e.g. v (8): 0; run sentences --fill (dry-run first)',
    ]);
    const partial = await validateSet(dir, [sentenceCoverageCheck], { complete: false });
    expect(partial.ok).toBe(true);
    expect(partial.warnings).toHaveLength(1);
  });
});
