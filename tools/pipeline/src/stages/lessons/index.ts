// Stage 7, lessons: the authored lessons and pattern files → lessons.jsonl and patterns.jsonl.
// - Patterns take their endings from the real forms of the model word (patterns.ts).
// - Each lesson gets its five steps in order; the three exercise steps are left empty here
//   and filled by the exercises stage, which merges the exercise ids into these rows.
// - Each lesson's bucket weights come from how often each case, number and gender occurs in
//   the corpus list (weights.ts).
// - Example sentences are checked against the morphology: every word is a known form, and the
//   highlighted words have a reading in the lesson's case.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Case,
  CaseSchema,
  GrammaticalNumberSchema,
  type LessonRow,
  type PatternRow,
} from '@app/contracts';
import { formKey, parseBucketKey } from '@app/ling';
import { parse } from 'yaml';
import { z } from 'zod';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import { ARANEUM_SOURCE, WORD_TAG_FILE } from '../freq';
import { authoredDir, readTriggerRows, triggersOut, yamlFiles } from '../triggers';
import {
  CASE_DIGITS,
  loadMorphology,
  MORPH_OPTION,
  type Morphology,
  morphFiles,
  morphInputs,
  wordsOf,
} from '../triggers/morphology';
import { buildPattern, readAuthoredPatterns } from './patterns';
import { corpusWeights, lessonWeights, wordTagPath } from './weights';

/** The share of a checkpoint a learner needs to complete the lesson. */
export const PASS_SHARE = 0.75;
/** A checkpoint lists at least this many exercises. */
export const MIN_CHECKPOINT = 8;
export const STEP_KINDS = [
  'explain',
  'triggers',
  'comprehension',
  'production',
  'checkpoint',
] as const;

export const AuthoredLessonSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/u),
    ord: z.int().positive(),
    titleEn: z.string().min(1),
    titleSk: z.string().min(1),
    case: CaseSchema.optional(),
    number: GrammaticalNumberSchema.optional(),
    prerequisites: z.array(z.string()).default([]),
    /** Bucket keys (`acc.sg.f`), or `all`: every bucket of the other lessons. */
    buckets: z.union([z.literal('all'), z.array(z.string()).min(1)]),
    triggerIds: z.array(z.string()).min(1),
    /** Pronouns the exercises of this lesson may target besides nouns (lemmas). */
    pronouns: z.array(z.string()).optional(),
    summaryMd: z.string().min(1),
    explain: z
      .object({
        md: z.string().min(1),
        examples: z
          .array(z.object({ sk: z.string().min(1), en: z.string().min(1) }).strict())
          .min(1),
      })
      .strict(),
  })
  .strict();
export type AuthoredLesson = z.infer<typeof AuthoredLessonSchema>;

export async function readAuthoredLessons(dir: string): Promise<AuthoredLesson[]> {
  const out: AuthoredLesson[] = [];
  for (const file of await yamlFiles(dir)) {
    const parsed = AuthoredLessonSchema.safeParse(parse(await readFile(file, 'utf8')));
    if (!parsed.success)
      throw new Error(
        `${file}: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    out.push(parsed.data);
  }
  return out.sort((a, b) => a.ord - b.ord);
}

/** The bucket keys of each lesson, with `all` expanded. */
export function lessonBuckets(lessons: readonly AuthoredLesson[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const every: string[] = [];
  for (const l of lessons)
    if (l.buckets !== 'all') {
      out.set(l.id, l.buckets);
      for (const b of l.buckets) if (!every.includes(b)) every.push(b);
    }
  for (const l of lessons) if (l.buckets === 'all') out.set(l.id, every);
  return out;
}

/** `Vidím [ženu].` → the text without brackets and the span of the bracketed words. */
export function readExample(
  sk: string,
): { sk: string; highlight: { start: number; end: number } } | null {
  const open = sk.indexOf('[');
  const close = sk.indexOf(']');
  if (open < 0 || close < open || sk.indexOf('[', open + 1) >= 0) return null;
  const text = sk.slice(0, open) + sk.slice(open + 1, close) + sk.slice(close + 1);
  return { sk: text, highlight: { start: open, end: close - 1 } };
}

export interface BuiltLessons {
  lessons: LessonRow[];
  patterns: PatternRow[];
  problems: string[];
  notes: string[];
  weights: Record<string, number>;
  weightSource: string;
}

export async function buildLessons(
  ctx: Pick<StageContext, 'paths' | 'args'>,
  m: Morphology,
): Promise<BuiltLessons> {
  const problems: string[] = [];
  const notes: string[] = [];
  const soft = (msg: string) => (m.complete ? problems : notes).push(msg);

  // Patterns.
  const authoredPatterns = await readAuthoredPatterns(
    await yamlFiles(authoredDir(ctx, 'patterns')),
  );
  const patterns: PatternRow[] = [];
  for (const p of authoredPatterns) {
    const built = buildPattern(m, p);
    problems.push(...built.problems);
    notes.push(...built.notes);
    if (built.row) patterns.push(built.row);
  }
  const patternIds = new Set(authoredPatterns.map((p) => p.id));
  if (patternIds.size !== authoredPatterns.length) problems.push('a pattern id is used twice');
  const used = new Map<string, number>();
  for (const l of m.lemmas.values())
    if (l.pattern) used.set(l.pattern, (used.get(l.pattern) ?? 0) + 1);
  for (const [id, n] of used)
    if (!patternIds.has(id))
      soft(`pattern ${id} is used by ${n} lemmas but has no pattern file entry`);

  // Lessons.
  const authored = await readAuthoredLessons(authoredDir(ctx, 'lessons'));
  const triggers = new Map((await readTriggerRows(triggersOut(ctx))).map((t) => [t.id, t]));
  const ids = new Set(authored.map((l) => l.id));
  const buckets = lessonBuckets(authored);
  const weights = await corpusWeights(m, ctx.paths, { araneum: m.complete });
  const lessons: LessonRow[] = [];
  authored.forEach((l, i) => {
    const w = `lesson ${l.id}`;
    if (l.ord !== i + 1) problems.push(`${w}: ord ${l.ord}, expected ${i + 1}`);
    for (const p of l.prerequisites)
      if (!ids.has(p)) problems.push(`${w}: unknown prerequisite ${p}`);
    for (const t of l.triggerIds) {
      const row = triggers.get(t);
      if (!row) problems.push(`${w}: unknown trigger ${t}`);
    }
    const keys = buckets.get(l.id) ?? [];
    for (const k of keys) {
      const b = parseBucketKey(k);
      if (!b) problems.push(`${w}: "${k}" is not a bucket key`);
      else {
        if (l.case && b.case !== l.case) problems.push(`${w}: bucket ${k} is not in the ${l.case}`);
        if (l.number && b.number !== l.number)
          problems.push(`${w}: bucket ${k} is not in the ${l.number}`);
      }
    }
    const examples = l.explain.examples.map((e, j) => {
      const read = readExample(e.sk);
      if (!read) {
        problems.push(`${w}: example ${j + 1} needs one [highlight]`);
        return { sk: e.sk, en: e.en, highlight: { start: 0, end: 0 } };
      }
      const words = wordsOf(read.sk);
      const unknown = words.filter((x) => !m.words.has(formKey(x.w))).map((x) => x.w);
      if (unknown.length > 0)
        soft(`${w}: unknown words in example ${j + 1}: ${unknown.join(', ')}`);
      const hl = words.filter((x) => x.s >= read.highlight.start && x.e <= read.highlight.end);
      const lessonCase: Case | undefined = l.case;
      const caseOk = (x: string) => {
        const info = m.words.get(formKey(x));
        if (!info) return !m.complete;
        if (lessonCase) return (info.cases & (1 << CASE_DIGITS[lessonCase])) !== 0;
        return info.cases !== 0;
      };
      if (hl.length === 0 || !hl.some((x) => caseOk(x.w)))
        problems.push(
          `${w}: the highlight of example ${j + 1} (${read.sk.slice(read.highlight.start, read.highlight.end)}) is not a form in the ${lessonCase ?? 'lesson cases'}`,
        );
      return { sk: read.sk, en: e.en, highlight: read.highlight };
    });
    const focus = lessonWeights(keys, weights.shares).map(({ key, weight }) => {
      const b = parseBucketKey(key);
      return {
        case: b?.case ?? 'nom',
        number: b?.number ?? 'sg',
        gender: b?.gender ?? 'n',
        weight,
      };
    });
    const row: LessonRow = {
      id: l.id,
      course: 'declension',
      ord: l.ord,
      titleEn: l.titleEn,
      titleSk: l.titleSk,
      focus: { buckets: focus, triggerIds: l.triggerIds },
      summaryMd: l.summaryMd.trim(),
      prerequisites: l.prerequisites,
      steps: [
        {
          ord: 0,
          kind: 'explain',
          content: { kind: 'explain', md: l.explain.md.trim(), examples },
        },
        { ord: 1, kind: 'triggers', content: { kind: 'triggers', triggerIds: l.triggerIds } },
        { ord: 2, kind: 'comprehension', content: { kind: 'comprehension', exerciseIds: [] } },
        { ord: 3, kind: 'production', content: { kind: 'production', exerciseIds: [] } },
        {
          ord: 4,
          kind: 'checkpoint',
          content: { kind: 'checkpoint', exerciseIds: [], passShare: PASS_SHARE },
        },
      ],
    };
    if (l.case) row.case = l.case;
    if (l.number) row.number = l.number;
    lessons.push(row);
  });
  return {
    lessons,
    patterns,
    problems,
    notes,
    weights: Object.fromEntries(weights.shares),
    weightSource: weights.source,
  };
}

const out = (ctx: Pick<StageContext, 'paths'>, f: string) => join(ctx.paths.build, 'lessons', f);
export const lessonsOut = (ctx: Pick<StageContext, 'paths'>) => out(ctx, 'lessons.jsonl');

export async function runLessons(ctx: StageContext): Promise<Record<string, unknown>> {
  const files = morphFiles(ctx);
  const patternModels = new Set<string>();
  for (const p of await readAuthoredPatterns(await yamlFiles(authoredDir(ctx, 'patterns')))) {
    patternModels.add(p.model);
    if (p.everyday) patternModels.add(p.everyday);
  }
  const m = await loadMorphology(files, {
    formsFor: (l) => patternModels.has(l.lemma) && (l.pos === 'noun' || l.pos === 'adj'),
    words: true,
  });
  const built = await buildLessons(ctx, m);
  for (const n of built.notes.slice(0, 20)) ctx.log(`lessons: warning ${n}`);
  for (const p of built.problems.slice(0, 50)) ctx.log(`lessons: ${p}`);
  const summary = {
    morphology: m.source,
    lessons: built.lessons.length,
    patterns: built.patterns.length,
    weightSource: built.weightSource,
    weights: built.weights,
    problems: built.problems,
    notes: built.notes,
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(summary));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(built));
  if (built.problems.length > 0)
    throw new Error(
      `lessons: ${built.problems.length} problems, see ${out(ctx, 'report.md')}: ${built.problems.slice(0, 3).join('; ')}`,
    );
  const lw = await JsonlWriter.open(lessonsOut(ctx));
  for (const r of built.lessons) await lw.write(r);
  await lw.close();
  const pw = await JsonlWriter.open(out(ctx, 'patterns.jsonl'));
  for (const r of built.patterns) await pw.write(r);
  await pw.close();
  ctx.log(`lessons: ${built.lessons.length} lessons and ${built.patterns.length} patterns written`);
  return {
    lessons: built.lessons.length,
    patterns: built.patterns.length,
    notes: built.notes.length,
  };
}

function renderReport(b: BuiltLessons): string {
  const lines = [
    '# Lessons report',
    '',
    `${b.lessons.length} lessons and ${b.patterns.length} patterns. Bucket weights from ${b.weightSource === 'araneum' ? 'the ARF of every common noun row of the Araneum word form list, by the gender, number and case of its tag' : 'the most used forms of the ranked nouns, each noun weighing 1 / its rank (no Araneum list)'}.`,
    '',
    '## Bucket shares in the corpus',
    '',
    '| Bucket | Share |',
    '|---|---:|',
    ...Object.entries(b.weights)
      .sort(([, x], [, y]) => y - x)
      .map(([k, v]) => `| ${k} | ${(v * 100).toFixed(2)} % |`),
    '',
    '## Lessons',
    '',
    ...b.lessons.map(
      (l) =>
        `- ${l.ord}. ${l.id}: ${l.focus.buckets.map((x) => `${x.case}.${x.number}.${x.gender} ${x.weight}`).join(', ')}`,
    ),
    '',
  ];
  if (b.problems.length > 0) lines.push('## Problems', '', ...b.problems.map((p) => `- ${p}`), '');
  if (b.notes.length > 0) lines.push('## Warnings', '', ...b.notes.map((p) => `- ${p}`), '');
  return `${lines.join('\n')}\n`;
}

/**
 * Each pattern's endings come from its model word: for every tag, some form of the model word
 * with that tag ends with the ending. (The unit tests rebuild the whole forms from the stems.)
 */
export const patternEndingsCheck: Check = {
  id: 'c4.patterns',
  description: "Every pattern ending is the ending of a real form of the pattern's model word",
  async run(ctx) {
    const patterns: { n: number; row: PatternRow }[] = [];
    for await (const r of ctx.rows('patterns.jsonl')) patterns.push(r);
    const models = new Set(patterns.map((p) => p.row.modelLemmaId).filter((x) => x !== undefined));
    const forms = new Map<number, { form: string; tags: string[] }[]>();
    for await (const { row } of ctx.raw('forms.jsonl')) {
      const id = row.lemmaId as number;
      if (!models.has(id)) continue;
      const list = forms.get(id) ?? [];
      list.push({ form: formKey(String(row.form)), tags: String(row.tags).split(' ') });
      forms.set(id, list);
    }
    for (const { n, row } of patterns) {
      const w = `patterns.jsonl:${n} (${row.id})`;
      if (row.modelLemmaId === undefined) {
        (ctx.complete ? ctx.issue : ctx.warn)(`${w}: no model word`);
        continue;
      }
      const list = forms.get(row.modelLemmaId) ?? [];
      for (const [tag, ending] of Object.entries(row.endings))
        if (!list.some((f) => f.tags.includes(tag) && f.form.endsWith(formKey(ending))))
          ctx.issue(`${w}: no ${tag} form of the model word ends in "${ending}"`);
    }
  },
};

/**
 * Every lesson has its five steps in order, and each checkpoint lists at least
 * MIN_CHECKPOINT exercises of its own lesson; bucket weights sum to 1.
 */
export const lessonStepsCheck: Check = {
  id: 'c4.lessons',
  description: `Every lesson has its five steps in order, a checkpoint of at least ${MIN_CHECKPOINT} exercises, and bucket weights that sum to 1`,
  async run(ctx) {
    const lessonOf = new Map<string, string | undefined>();
    for await (const { row } of ctx.rows('exercises.jsonl')) lessonOf.set(row.id, row.lessonId);
    for await (const { n, row } of ctx.rows('lessons.jsonl')) {
      const w = `lessons.jsonl:${n} (${row.id})`;
      const kinds = row.steps.map((s) => s.kind);
      if (kinds.join(' ') !== STEP_KINDS.join(' '))
        ctx.issue(`${w}: steps are ${kinds.join(', ')}, not ${STEP_KINDS.join(', ')}`);
      row.steps.forEach((s, i) => {
        if (s.ord !== i) ctx.issue(`${w}: step ${i} has ord ${s.ord}`);
        const c = s.content;
        if (c.kind === 'comprehension' || c.kind === 'production' || c.kind === 'checkpoint') {
          if (c.exerciseIds.length === 0) ctx.issue(`${w}: the ${c.kind} step has no exercises`);
          if (c.kind === 'checkpoint' && c.exerciseIds.length < MIN_CHECKPOINT)
            ctx.issue(
              `${w}: the checkpoint lists ${c.exerciseIds.length} exercises, fewer than ${MIN_CHECKPOINT}`,
            );
          for (const x of c.exerciseIds)
            if (lessonOf.has(x) && lessonOf.get(x) !== row.id)
              ctx.issue(`${w}: exercise ${x} belongs to lesson ${lessonOf.get(x) ?? 'none'}`);
        }
      });
      const sum = row.focus.buckets.reduce((a, b) => a + b.weight, 0);
      if (Math.abs(sum - 1) > 0.005) ctx.issue(`${w}: bucket weights sum to ${sum.toFixed(3)}`);
    }
  },
};

export const lessonsStage: Stage = {
  name: 'lessons',
  description: 'Lessons with their steps, and declension patterns with endings from real forms',
  sources: [`${ARANEUM_SOURCE}/${WORD_TAG_FILE}`],
  codeDir: codeDirOf(import.meta.url),
  options: { ...MORPH_OPTION },
  inputs: (ctx) => [
    authoredDir(ctx, 'lessons'),
    authoredDir(ctx, 'patterns'),
    triggersOut(ctx),
    ...morphInputs(morphFiles(ctx)),
    // The corpus list for the bucket weights, in the full build when it was fetched.
    ...(morphFiles(ctx).complete && existsSync(wordTagPath(ctx.paths))
      ? [wordTagPath(ctx.paths)]
      : []),
  ],
  outputs: (ctx) =>
    ['lessons.jsonl', 'patterns.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  params: (ctx) => ({ morph: ctx.args.morph ?? null }),
  run: runLessons,
  parts: [
    { file: 'patterns.jsonl', path: (p) => join(p.build, 'lessons', 'patterns.jsonl') },
    { file: 'lessons.jsonl', path: (p) => join(p.build, 'lessons', 'lessons.jsonl') },
  ],
  checks: [patternEndingsCheck, lessonStepsCheck],
};

export async function readLessonRows(path: string): Promise<LessonRow[]> {
  if (!existsSync(path)) throw new Error(`${path} does not exist; run the lessons stage first`);
  const rows: LessonRow[] = [];
  for await (const r of readJsonl<LessonRow>(path)) rows.push(r);
  return rows;
}
