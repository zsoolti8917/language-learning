import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LessonRow, PatternRow } from '@app/contracts';
import { formKey } from '@app/ling';
import { MINI_DIR } from '@app/testkit/mini';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readJsonl } from '../../lib/files';
import { runStage } from '../../lib/runner';
import { type TempRoot, tempRoot } from '../../lib/testing';
import { validateSet } from '../../lib/validate';
import { triggersStage, yamlFiles } from '../triggers';
import { findLemma, formsWith, loadMorphology, type Morphology } from '../triggers/morphology';
import {
  lessonBuckets,
  lessonsOut,
  lessonsStage,
  patternEndingsCheck,
  readAuthoredLessons,
  readExample,
  readLessonRows,
  STEP_KINDS,
} from '.';
import { type AuthoredPattern, buildPattern, readAuthoredPatterns, rebuildForms } from './patterns';
import { araneumBucketSums, lessonWeights } from './weights';

const AUTHORED = fileURLToPath(new URL('../../../../../content/authored', import.meta.url));
const MINI = {
  lemmas: join(MINI_DIR, 'lemmas.jsonl'),
  forms: join(MINI_DIR, 'forms.jsonl'),
  complete: false,
};

async function* lines(text: string): AsyncIterable<string> {
  for (const l of text.split('\n')) yield l;
}

describe('the declension patterns', () => {
  let m: Morphology;
  let patterns: AuthoredPattern[];
  beforeAll(async () => {
    m = await loadMorphology(MINI, { formsFor: () => true, words: true });
    patterns = await readAuthoredPatterns(await yamlFiles(join(AUTHORED, 'patterns')));
  });

  it('cover every pattern of the morphology', () => {
    const ids = new Set(patterns.map((p) => p.id));
    for (const l of m.lemmas.values()) if (l.pattern) expect(ids).toContain(l.pattern);
  });

  it("rebuild each model word's real forms from the stem and the endings", () => {
    let rebuilt = 0;
    for (const p of patterns) {
      const model = findLemma(m, p.model, p.pos === 'noun' ? ['noun'] : ['adj'], p.gender);
      if (!model) continue; // otcov is not in the mini dataset
      const built = buildPattern(m, p);
      expect(built.problems, p.id).toEqual([]);
      const row = built.row as PatternRow;
      const forms = rebuildForms(p, row.endings);
      const map = m.forms.get(model.id) ?? {};
      for (const [tag, form] of Object.entries(forms)) {
        // The rebuilt form is a real form of the model word with that tag ...
        expect(formsWith(map, tag), `${p.id} ${tag}`).toContain(formKey(form));
        // ... and the one the pattern prefers when the model word has two.
        const preferred = p.prefer?.[tag];
        if (preferred) expect(form, `${p.id} ${tag}`).toBe(formKey(preferred));
      }
      // Every tag of the declension is there: 14 for a noun, 56 for an adjective.
      expect(Object.keys(forms).length, p.id).toBe(p.pos === 'noun' ? 14 : 56);
      rebuilt++;
    }
    expect(rebuilt).toBeGreaterThanOrEqual(16);
  });

  it('take the irregular stems and the preferred forms from the pattern file', () => {
    const dlan = patterns.find((p) => p.id === 'dlan') as AuthoredPattern;
    const row = buildPattern(m, dlan).row as PatternRow;
    expect(rebuildForms(dlan, row.endings)).toMatchObject({
      s1: 'dlaň',
      s2: 'dlane',
      p7: 'dlaňami',
    });
    const dievca = patterns.find((p) => p.id === 'dievca') as AuthoredPattern;
    const drow = buildPattern(m, dievca).row as PatternRow;
    expect(rebuildForms(dievca, drow.endings)).toMatchObject({ s1: 'dievča', p1: 'dievčatá' });
  });

  it('fail when an ending does not belong to the model word', () => {
    const zena = patterns.find((p) => p.id === 'zena') as AuthoredPattern;
    const built = buildPattern(m, { ...zena, stem: 'mest' });
    expect(built.problems.join('\n')).toMatch(/žena \(s1\) does not start with the stem mest/u);
  });
});

describe('corpus weights', () => {
  it('sum the corpus frequency of the noun tags by bucket, without the vocative', async () => {
    const sums = await araneumBucketSums(
      lines(
        [
          'mesto\tSSns4\t100\t90.5',
          'mesto\tSSns1\t100\t50',
          'ženy\tSSfp1\t10\t9.5',
          'ženo\tSSfs5\t3\t2',
          'Peter\tSSms1:r\t10\t10',
          'pekný\tAAms1x\t5\t5',
        ].join('\n'),
      ),
    );
    expect(Object.fromEntries(sums)).toEqual({ 'acc.sg.n': 90.5, 'nom.sg.n': 50, 'nom.pl.f': 9.5 });
  });

  it('give a lesson weights that sum to one', () => {
    const w = lessonWeights(
      ['acc.sg.f', 'acc.sg.n', 'acc.sg.m_inan'],
      new Map([
        ['acc.sg.f', 3],
        ['acc.sg.n', 1],
        ['acc.sg.m_inan', 2],
      ]),
    );
    expect(w.map((x) => x.weight)).toEqual([0.5, 0.167, 0.333]);
    expect(w.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1, 6);
  });
});

describe('the authored lessons', () => {
  it('are nine, in order, each with its buckets and a highlight in every example', async () => {
    const lessons = await readAuthoredLessons(join(AUTHORED, 'lessons'));
    expect(lessons.map((l) => l.ord)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(lessons.at(-1)?.buckets).toBe('all');
    const buckets = lessonBuckets(lessons);
    expect(buckets.get('mixed')?.length).toBe(
      new Set(lessons.flatMap((l) => (l.buckets === 'all' ? [] : l.buckets))).size,
    );
    for (const l of lessons)
      for (const e of l.explain.examples)
        expect(readExample(e.sk), `${l.id}: ${e.sk}`).not.toBeNull();
  });
});

describe('the lessons stage', () => {
  let t: TempRoot;
  beforeAll(async () => {
    t = await tempRoot();
    await cp(AUTHORED, join(t.paths.content, 'authored'), { recursive: true });
    await runStage(triggersStage, t.ctx({ morph: MINI_DIR }));
  });
  afterAll(() => t.remove());

  it('writes nine lessons with five steps in order and the patterns of the mini dataset', async () => {
    await runStage(lessonsStage, t.ctx({ morph: MINI_DIR }));
    const lessons = await readLessonRows(lessonsOut(t.ctx()));
    expect(lessons).toHaveLength(9);
    for (const l of lessons as LessonRow[]) {
      expect(l.steps.map((s) => s.kind)).toEqual([...STEP_KINDS]);
      expect(l.steps.map((s) => s.ord)).toEqual([0, 1, 2, 3, 4]);
      expect(l.focus.buckets.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1, 2);
    }
    const patterns: PatternRow[] = [];
    for await (const p of readJsonl<PatternRow>(join(t.paths.build, 'lessons', 'patterns.jsonl')))
      patterns.push(p);
    expect(patterns.length).toBeGreaterThanOrEqual(16);
  });

  it('has a validate check that finds an ending of no real form', async () => {
    const dir = join(t.root, 'set');
    await cp(MINI_DIR, dir, { recursive: true });
    await cp(join(t.paths.build, 'lessons', 'patterns.jsonl'), join(dir, 'patterns.jsonl'));
    expect((await validateSet(dir, [patternEndingsCheck])).issues).toEqual([]);
    const text = await readFile(join(dir, 'patterns.jsonl'), 'utf8');
    await writeFile(join(dir, 'patterns.jsonl'), text.replace('"s2":"y"', '"s2":"ou"'));
    const r = await validateSet(dir, [patternEndingsCheck]);
    expect(r.issues.map((i) => i.message)).toContainEqual(
      expect.stringMatching(/\(zena\): no s2 form of the model word ends in "ou"/u),
    );
  });
});
