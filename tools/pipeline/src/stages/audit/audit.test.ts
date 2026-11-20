import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readJsonl, writeJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { offlineAnswersDir, offlineRequestsDir } from '../../model/options';
import { type OfflineRequest, offlinePath, validateAnswer } from '../../model/runner';
import { OFFLINE_ROUTES, showRequest } from '../../offline/lint';
import { type AuditItem, auditStage, drawSample, pickForYou, renderForYou, sample } from '.';
import {
  AUDIT_GROUP_SIZE,
  AUDIT_ROUTES,
  type AuditAnswer,
  auditExercisesTask,
  auditSentencesTask,
} from './prompts';

let t: TempRoot;

/** A built set small enough to read: 6 sentences, 5 exercises, 4 common lemmas with glosses. */
async function seed(root: TempRoot) {
  const b = root.paths.build;
  await writeJsonl(join(b, 'morph', 'lemmas.jsonl'), [
    { id: 1, lemma: 'žena', pos: 'noun', gender: 'f' },
    { id: 2, lemma: 'vidieť', pos: 'verb', aspect: 'ipf' },
    { id: 3, lemma: 'k', pos: 'prep' },
    { id: 4, lemma: 'kniha', pos: 'noun', gender: 'f' },
    { id: 5, lemma: 'zriedkavý', pos: 'adj' },
  ]);
  await writeJsonl(join(b, 'freq', 'lemmas.jsonl'), [
    { id: 1, freqRank: 120 },
    { id: 2, freqRank: 100 },
    { id: 3, freqRank: 30 },
    { id: 4, freqRank: 400 },
    { id: 5, freqRank: 9000 },
  ]);
  await writeJsonl(join(b, 'dict', 'senses.jsonl'), [
    { lemmaId: 1, ord: 1, glossEn: 'wife' },
    { lemmaId: 1, ord: 0, glossEn: 'woman', note: 'adult female person' },
    { lemmaId: 2, ord: 0, glossEn: 'to see' },
    { lemmaId: 3, ord: 0, glossEn: 'to, towards' },
    { lemmaId: 4, ord: 0, glossEn: 'book' },
    { lemmaId: 5, ord: 0, glossEn: 'rare' },
  ]);
  await writeJsonl(join(b, 'triggers', 'triggers.jsonl'), [
    { id: 'prep-k', kind: 'preposition', lemma: 'k', case: 'dat', meaningEn: 'to, towards' },
  ]);
  await writeJsonl(
    join(b, 'sentences', 'sentences.jsonl'),
    [0, 1, 2, 3, 4, 5].map((i) => ({
      id: `s-${i}`,
      textSk: `Vidím ženu číslo ${i}.`,
      textEn: `I see woman number ${i}.`,
      source: i % 2 ? 'tatoeba' : 'generated',
      links: [
        { lemmaId: 2, form: 'Vidím', tag: 'v:Kesa+', ord: 2 },
        { lemmaId: 1, form: 'ženu', tag: 's4', ord: 1 },
      ],
    })),
  );
  await writeJsonl(
    join(b, 'exercises', 'exercises.jsonl'),
    [0, 1, 2, 3, 4].map((i) => ({
      id: `ex-${i}`,
      kind: i === 0 ? 'choice_form' : 'cloze',
      sentenceSk: `Idem k žene číslo ${i}.`,
      sentenceEn: `I am going to woman number ${i}.`,
      target: { cue: 'žena', answers: ['žene'] },
      case: 'dat',
      number: 'sg',
      gender: 'f',
      triggerId: 'prep-k',
      ...(i === 0
        ? {
            options: [
              { text: 'ženu', correct: false },
              { text: 'žene', correct: true },
            ],
          }
        : {}),
    })),
  );
}

async function rows<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for await (const r of readJsonl<T>(path)) out.push(r);
  return out;
}

beforeAll(async () => {
  t = await tempRoot();
  await seed(t);
});
afterAll(() => t.remove());

describe('the sample', () => {
  it('is the same on every draw and changes with the seed', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `row-${i}`);
    const a = sample(ids, (x) => x, 10, 'one');
    expect(a).toHaveLength(10);
    expect(sample([...ids].reverse(), (x) => x, 10, 'one')).toEqual(a);
    expect(sample(ids, (x) => x, 10, 'two')).not.toEqual(a);
    expect(sample(ids, (x) => x, 80, 'one')).toHaveLength(50);
  });

  it('shows a sentence with what it teaches, an exercise with its rule and a lemma with its glosses', async () => {
    const { items, population } = await drawSample(t.ctx(), 3, 'x');
    expect(population).toEqual({ sentences: 6, exercises: 5, glosses: 4 });
    expect(items.map((i) => i.kind)).toEqual([
      ...Array(3).fill('sentences'),
      ...Array(3).fill('exercises'),
      ...Array(3).fill('glosses'),
    ]);
    const s = items[0] as AuditItem;
    expect(s.asked).toMatchObject({ source: expect.stringMatching(/tatoeba|generated/u) });
    // Links in the order of their rank; the meaning is the first glosses in dictionary order,
    // each with its note, as the word's card shows them.
    expect(s.asked.teaches).toEqual([
      {
        lemma: 'žena',
        pos: 'noun',
        gender: 'f',
        meaning: ['woman (adult female person)', 'wife'],
        form: 'ženu',
        formIs: 'accusative singular',
      },
      {
        lemma: 'vidieť',
        pos: 'verb',
        meaning: ['to see'],
        form: 'Vidím',
        formIs: 'present tense, 1st person singular',
      },
    ]);
    const e = items.find((i) => i.kind === 'exercises') as AuditItem;
    expect(e.asked).toMatchObject({
      answer: 'žene',
      cue: 'žena',
      asks: 'dative singular, feminine',
      trigger: 'preposition k + dative: to, towards',
    });
    // The rare lemma (rank 9000) is never drawn; a note stands in brackets after its gloss.
    const g = items.filter((i) => i.kind === 'glosses');
    expect(g.map((i) => i.id)).not.toContain('zriedkavý|adj|');
    const zena = (await drawSample(t.ctx(), 100, 'x')).items.find((i) => i.id === 'žena|noun|f');
    expect(zena?.asked.glosses).toEqual(['woman (adult female person)', 'wife']);
  });
});

describe('the answer of an audit request', () => {
  const input = { items: [{ n: 0 }, { n: 1 }] } as Parameters<typeof validateAnswer>[1];
  const check = (items: AuditAnswer['items']) =>
    validateAnswer(auditSentencesTask, input as never, { items });
  it('names every item once; a verdict other than ok says what is wrong', () => {
    const ok = { n: 0, verdict: 'ok' as const, problem: '', fix: '' };
    expect(
      check([ok, { n: 1, verdict: 'wrong', problem: 'Wrong case.', fix: 'Vidím ženu.' }]).ok,
    ).toBe(true);
    const refused: [AuditAnswer['items'], RegExp][] = [
      [[ok], /n 1 not answered/u],
      [[ok, ok], /answered twice/u],
      [[ok, { n: 1, verdict: 'minor', problem: ' ', fix: '' }], /without a problem/u],
      [[ok, { n: 1, verdict: 'ok', problem: 'Odd.', fix: '' }], /"ok" with a problem/u],
      [[ok, { n: 7, verdict: 'ok', problem: '', fix: '' }], /unknown n 7/u],
    ];
    for (const [items, reason] of refused) {
      const r = check(items);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(reason);
    }
  });
});

describe('the audit stage', () => {
  it('without a fill writes the sample and a report with nothing checked', async () => {
    const outcome = await runStage(auditStage, t.ctx({ size: '4' }));
    expect(outcome.result).toMatchObject({
      seed: 'i2',
      size: 4,
      mode: 'none',
      kinds: {
        sentences: { population: 6, sampled: 4, checked: 0, requests: 1, open: 1 },
        exercises: { population: 5, sampled: 4, checked: 0 },
        glosses: { population: 4, sampled: 4, checked: 0 },
      },
    });
    const dir = join(t.paths.build, 'audit');
    expect(await rows<AuditItem>(join(dir, 'sample.jsonl'))).toHaveLength(12);
    expect(await readFile(join(dir, 'report.md'), 'utf8')).toContain(
      '| Example sentences | 6 | 4 | 0 | 0 | 0 | 0 |',
    );
    expect(await readFile(join(dir, 'for-you.md'), 'utf8')).toContain('not checked yet');
    // No request leaves the stage without a fill.
    expect(existsSync(offlineRequestsDir(t.paths, 'audit'))).toBe(false);
  });

  it('an offline fill leaves its requests, takes the verdicts and reports what was found', async () => {
    const args = { size: '4', fill: 'offline', 'answered-by': 'a-reader' };
    await runStage(auditStage, t.ctx(args));
    const rdir = offlineRequestsDir(t.paths, 'audit');
    for (const route of Object.values(AUDIT_ROUTES))
      expect(await readdir(join(rdir, route))).toHaveLength(1);

    // A reader sees each request through `offline show` and answers it.
    for (const route of Object.values(AUDIT_ROUTES)) {
      const [file] = await readdir(join(rdir, route));
      const request = JSON.parse(
        await readFile(join(rdir, route, file as string), 'utf8'),
      ) as OfflineRequest;
      expect(OFFLINE_ROUTES.audit?.[route]).toBeDefined();
      const shown = showRequest(t.paths, 'audit', request);
      if (route === AUDIT_ROUTES.sentences)
        expect(shown).toContain(
          'teaches: ženu = accusative singular of žena (noun f), meaning: woman (adult female person); wife',
        );
      if (route === AUDIT_ROUTES.exercises)
        expect(shown).toContain('trigger: preposition k + dative: to, towards');
      if (route === AUDIT_ROUTES.glosses) expect(shown).toMatch(/\[0\] \S+ \(/u);
      const asked = JSON.parse(request.user) as { n: number }[];
      const answer: AuditAnswer = {
        items: asked.map((i) =>
          route === AUDIT_ROUTES.exercises && i.n === 2
            ? {
                n: i.n,
                verdict: 'wrong',
                problem: 'The answer is accusative.',
                fix: 'Idem k žene.',
              }
            : route === AUDIT_ROUTES.sentences && i.n === 3
              ? { n: i.n, verdict: 'minor', problem: 'Stiff English.', fix: 'I can see her.' }
              : { n: i.n, verdict: 'ok', problem: '', fix: '' },
        ),
      };
      const path = offlinePath(offlineAnswersDir(t.paths, 'audit'), route, request.hash);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(answer));
    }

    // The test clock stands still, so the second run is forced; the CLI's clock moves.
    const outcome = await runStage(auditStage, t.ctx(args), { force: true });
    expect(outcome.result).toMatchObject({
      kinds: {
        sentences: { checked: 4, open: 0, verdicts: { ok: 3, minor: 1, wrong: 0 } },
        exercises: { checked: 4, open: 0, verdicts: { ok: 3, minor: 0, wrong: 1 } },
        glosses: { checked: 4, open: 0, verdicts: { ok: 4, minor: 0, wrong: 0 } },
      },
    });
    const dir = join(t.paths.build, 'audit');
    const items = await rows<AuditItem>(join(dir, 'sample.jsonl'));
    expect(items.filter((i) => i.verdict !== undefined)).toHaveLength(12);
    expect(items.find((i) => i.verdict === 'wrong')).toMatchObject({
      kind: 'exercises',
      problem: 'The answer is accusative.',
      model: 'a-reader',
    });
    const report = await readFile(join(dir, 'report.md'), 'utf8');
    expect(report).toContain('| Exercises | 5 | 4 | 4 | 3 | 0 | 1 |');
    expect(report).toContain('## Exercises: 1 found');
    expect(report).toContain(
      'Second pass: **wrong**. The answer is accusative. Suggested: Idem k žene.',
    );
    expect(report).toContain('## Glosses (dictionary entries): 0 found');
    // The doubted items lead their groups in the list for a person.
    const forYou = await readFile(join(dir, 'for-you.md'), 'utf8');
    const first = (title: string) => forYou.slice(forYou.indexOf(`## ${title}`)).split('### 2.')[0];
    expect(first('Exercises')).toContain('**wrong**');
    expect(first('Example sentences')).toContain('**minor**');

    // A later run without a fill reads the verdicts from the cache.
    const again = await runStage(auditStage, t.ctx({ size: '4' }), { force: true });
    expect(again.result).toMatchObject({ kinds: { exercises: { checked: 4, open: 0 } } });
  });

  it('a mock fill passes every item and keeps out of the real cache', async () => {
    const outcome = await runStage(auditStage, t.ctx({ size: '5', seed: 'other', fill: 'mock' }));
    expect(outcome.result).toMatchObject({
      kinds: {
        sentences: { checked: 5, verdicts: { ok: 5 } },
        glosses: { sampled: 4, checked: 4 },
      },
    });
    const real = await runStage(auditStage, t.ctx({ size: '5', seed: 'other' }));
    expect(real.result).toMatchObject({ kinds: { sentences: { checked: 0 } } });
  });

  it('refuses a size that is no number', async () => {
    await expect(runStage(auditStage, t.ctx({ size: 'many' }))).rejects.toThrow(/--size/u);
  });
});

describe('the list for a person', () => {
  const item = (kind: AuditItem['kind'], i: number, verdict?: AuditItem['verdict']): AuditItem => ({
    kind,
    id: `${kind}-${i}`,
    job: `${kind[0]}0`,
    n: i,
    asked:
      kind === 'glosses'
        ? { lemma: `slovo${i}`, pos: 'noun', glosses: ['word'] }
        : kind === 'exercises'
          ? { kind: 'cloze', sk: 'Sk.', en: 'En.', answer: 'a', cue: 'b', asks: 'dative singular' }
          : { sk: 'Sk.', en: 'En.', source: 'generated', teaches: [] },
    ...(verdict ? { verdict, problem: verdict === 'ok' ? '' : 'Because.', fix: '' } : {}),
  });

  it('takes an equal share of each kind, the doubted items first, then the sample order', () => {
    const items = [
      ...Array.from({ length: 40 }, (_, i) =>
        item('sentences', i, i === 30 ? 'wrong' : i === 12 ? 'minor' : 'ok'),
      ),
      ...Array.from({ length: 40 }, (_, i) => item('exercises', i, 'ok')),
      ...Array.from({ length: 4 }, (_, i) => item('glosses', i, i === 3 ? 'minor' : 'ok')),
    ];
    const picked = pickForYou(items);
    expect(picked.filter((p) => p.kind === 'sentences').map((p) => p.id)).toEqual([
      'sentences-30',
      'sentences-12',
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `sentences-${i}`),
    ]);
    expect(picked.filter((p) => p.kind === 'exercises')).toHaveLength(10);
    expect(picked.filter((p) => p.kind === 'glosses').map((p) => p.id)).toEqual([
      'glosses-3',
      'glosses-0',
      'glosses-1',
      'glosses-2',
    ]);
    const text = renderForYou(items, 'i2');
    expect(text).toContain('### 1. `sentences-30`');
    expect(text).toContain('Second pass: **wrong**. Because.');
    expect(text).toContain('**slovo3** (noun)');
  });

  it('an item keeps its request when another item leaves the set', async () => {
    const root = await tempRoot();
    try {
      await seed(root);
      const b = root.paths.build;
      const many = Array.from({ length: 90 }, (_, i) => ({
        id: `s-${i}`,
        textSk: `Veta ${i}.`,
        textEn: `Sentence ${i}.`,
        source: 'generated',
        links: [],
      }));
      await writeJsonl(join(b, 'sentences', 'sentences.jsonl'), many);
      const size = 3 * AUDIT_GROUP_SIZE;
      const before = (await drawSample(root.ctx(), size, 'x')).items.filter(
        (i) => i.kind === 'sentences',
      );
      expect(new Set(before.map((i) => i.job))).toEqual(new Set(['s0', 's1', 's2']));
      // Within a request the numbers run from 0 without a gap.
      for (const job of ['s0', 's1', 's2'])
        expect(before.filter((i) => i.job === job).map((i) => i.n)).toEqual(
          before.filter((i) => i.job === job).map((_, k) => k),
        );
      const gone = before[0] as AuditItem;
      await writeJsonl(
        join(b, 'sentences', 'sentences.jsonl'),
        many.filter((m) => m.id !== gone.id),
      );
      const after = (await drawSample(root.ctx(), size, 'x')).items.filter(
        (i) => i.kind === 'sentences',
      );
      const jobOf = new Map(before.map((i) => [i.id, i.job]));
      for (const i of after) if (jobOf.has(i.id)) expect(i.job).toBe(jobOf.get(i.id));
      // The items that stay keep their requests and their order in them.
      const members = (list: AuditItem[], job: string) =>
        list.filter((i) => i.job === job && i.id !== gone.id && jobOf.has(i.id)).map((i) => i.id);
      for (const job of ['s0', 's1', 's2'])
        expect(members(after, job)).toEqual(members(before, job));
      expect(auditExercisesTask.route).toBe('content.audit.exercises');
    } finally {
      await root.remove();
    }
  });
});
