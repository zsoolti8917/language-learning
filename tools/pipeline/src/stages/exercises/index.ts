// Stage 8, exercises: the verified exercise bank, bucket by bucket.
//
// 1. plan.ts lays out slots: per bucket, target words in the bucket's form and the triggers
//    that demand it (the lesson's own, else any of that case).
// 2. `content.exercises` writes a sentence around each gap (--fill mock|dry-run|live).
// 3. rules.ts checks each sentence: real form with the claimed tag, known and common words,
//    the trigger where it governs the gap. A failing sentence is rejected and reported.
// 4. `content.exercises.review` reads every sentence that passed; a "no" rejects it.
// 5. The kind, the wrong options (by rule), the difficulty, the lesson and the hash id are
//    added, and the row goes into content/generated/exercises.jsonl (mock fills: the build
//    folder). Slots already there are never asked again.
// 6. The bank is written to the set, and the exercise steps of every lesson are filled from
//    it and merged into the lessons' rows.
import { join } from 'node:path';
import type { ExerciseRow, LessonRow, LessonStepContent } from '@app/contracts';
import { formKey, parseTag } from '@app/ling';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import type { BatchClient } from '../../model/client';
import { FILL_OPTIONS, fillModeOf, runOptionsOf } from '../../model/options';
import { formatUsd } from '../../model/pricing';
import { type BatchJob, type BatchOutcome, DEFAULT_MODEL, runBatch } from '../../model/runner';
import { lessonBuckets, lessonsOut, readAuthoredLessons, readLessonRows } from '../lessons';
import { authoredDir, readTriggerRows, triggersOut } from '../triggers';
import { loadMorphology, MORPH_OPTION, morphFiles, morphInputs } from '../triggers/morphology';
import {
  DEFAULT_PLAN,
  MIXED_LESSON,
  type PlanOptions,
  planAll,
  planLemmaFilter,
  planTriggers,
  prepositionSpellings,
  type Slot,
} from './plan';
import {
  type ExerciseRequest,
  exercisesTask,
  ITEMS_PER_REQUEST,
  type ReviewItem,
  type ReviewRequest,
  REVIEWS_PER_REQUEST,
  reviewTask,
} from './prompts';
import { buildRow, type Candidate, checkCandidate, NAMES, type RuleContext } from './rules';

const out = (ctx: Pick<StageContext, 'paths'>, f: string) => join(ctx.paths.build, 'exercises', f);
const base = () => process.env.INIT_CWD ?? process.cwd();

/** content/generated/exercises.jsonl; mock fills go to the build folder so git stays clean. */
export function exercisesPath(ctx: StageContext): string {
  const custom = resolveArg(ctx.args.exercises, base());
  if (custom) return custom;
  if (fillModeOf(ctx) === 'mock') return out(ctx, 'exercises.mock.jsonl');
  return join(ctx.paths.content, 'generated', 'exercises.jsonl');
}

function intArg(ctx: StageContext, name: string, fallback: number): number {
  const v = ctx.args[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number above 0`);
  return n;
}

export function planOptionsOf(ctx: StageContext): PlanOptions {
  const buckets = typeof ctx.args.buckets === 'string' ? ctx.args.buckets.split(',').filter(Boolean) : [];
  return {
    ...DEFAULT_PLAN,
    perBucket: intArg(ctx, 'per-bucket', DEFAULT_PLAN.perBucket),
    vocabularyLimit: intArg(ctx, 'vocabulary', DEFAULT_PLAN.vocabularyLimit),
    buckets,
  };
}

const CASE_NAMES = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  voc: 'vocative',
  loc: 'locative',
  ins: 'instrumental',
} as const;
const GENDER_NAMES = {
  m_anim: 'masculine animate',
  m_inan: 'masculine inanimate',
  f: 'feminine',
  n: 'neuter',
} as const;

/** The generation requests: the open slots of each bucket, ITEMS_PER_REQUEST at a time. */
export function generationJobs(slots: readonly Slot[], vocabularyLimit: number): BatchJob<ExerciseRequest>[] {
  const byBucket = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = s.slot.split('/')[0] as string;
    byBucket.set(k, [...(byBucket.get(k) ?? []), s]);
  }
  const jobs: BatchJob<ExerciseRequest>[] = [];
  for (const [key, list] of byBucket)
    for (let i = 0; i < list.length; i += ITEMS_PER_REQUEST) {
      const group = list.slice(i, i + ITEMS_PER_REQUEST);
      const b = (group[0] as Slot).bucket;
      const triggers = [...new Map(group.map((s) => [s.trigger.id, s.trigger])).values()];
      jobs.push({
        id: `${key}#${i / ITEMS_PER_REQUEST}`,
        input: {
          bucket: `${CASE_NAMES[b.case]} ${b.number === 'sg' ? 'singular' : 'plural'}, ${GENDER_NAMES[b.gender]}`,
          vocabularyLimit,
          names: NAMES,
          triggers: triggers.map((t) => ({ id: t.id, kind: t.kind, word: t.say, meaning: t.meaningEn })),
          items: group.map((s) => ({
            slot: s.slot,
            trigger: s.trigger.id,
            gap: s.gap,
            words: s.words.map((w, j) => ({ form: s.gap.split(' ')[j] as string, lemma: w.lemma })),
          })),
        },
      });
    }
  return jobs;
}

function reviewItem(slot: Slot, c: Candidate, gapText: string): ReviewItem {
  const b = slot.bucket;
  return {
    id: slot.slot,
    sentenceSk: c.sentenceSk.trim(),
    sentenceEn: c.sentenceEn.trim(),
    gap: gapText,
    expected: `${gapText}: ${CASE_NAMES[b.case]} ${b.number === 'sg' ? 'singular' : 'plural'} of ${slot.cue}`,
    trigger: `${slot.trigger.say} (${slot.trigger.meaningEn})`,
  };
}

/** Review requests: per bucket, REVIEWS_PER_REQUEST at a time, so one change moves few. */
export function reviewJobs(items: readonly ReviewItem[]): BatchJob<ReviewRequest>[] {
  const byBucket = new Map<string, ReviewItem[]>();
  for (const it of items) {
    const k = it.id.split('/')[0] as string;
    byBucket.set(k, [...(byBucket.get(k) ?? []), it]);
  }
  const jobs: BatchJob<ReviewRequest>[] = [];
  for (const [key, list] of byBucket)
    for (let i = 0; i < list.length; i += REVIEWS_PER_REQUEST)
      jobs.push({ id: `review ${key}#${i / REVIEWS_PER_REQUEST}`, input: { items: list.slice(i, i + REVIEWS_PER_REQUEST) } });
  return jobs;
}

export interface Rejection {
  slot: string;
  stage: 'rules' | 'review' | 'model';
  reason: string;
  sentenceSk?: string;
}

/** Picks n items round robin over buckets, each bucket easiest first. */
function roundRobin(rows: readonly ExerciseRow[], n: number): ExerciseRow[] {
  const groups = new Map<string, ExerciseRow[]>();
  for (const r of [...rows].sort((a, b) => a.difficulty - b.difficulty || (a.id < b.id ? -1 : 1))) {
    const k = `${r.case}.${r.number}.${r.gender}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const lists = [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, l]) => l);
  const picked: ExerciseRow[] = [];
  for (let i = 0; picked.length < n && lists.some((l) => l.length > i); i++)
    for (const l of lists) {
      const r = l[i];
      if (r && picked.length < n) picked.push(r);
    }
  return picked;
}

export const COMPREHENSION_SIZE = 12;
export const PRODUCTION_SIZE = 12;
export const CHECKPOINT_SIZE = 10;

/** The exercise steps of a lesson, from the bank. */
export function fillSteps(lesson: LessonRow, bank: readonly ExerciseRow[]): LessonRow['steps'] {
  const mine = bank.filter((r) => r.lessonId === lesson.id);
  const choice = roundRobin(mine.filter((r) => r.kind !== 'cloze'), COMPREHENSION_SIZE);
  const cloze = roundRobin(mine.filter((r) => r.kind === 'cloze'), Number.POSITIVE_INFINITY);
  const checkpoint = Math.min(CHECKPOINT_SIZE, cloze.length);
  const production = Math.min(PRODUCTION_SIZE, cloze.length - checkpoint);
  const ids: Record<string, string[]> = {
    comprehension: choice.map((r) => r.id),
    production: cloze.slice(0, production).map((r) => r.id),
    checkpoint: cloze.slice(production, production + checkpoint).map((r) => r.id),
  };
  return lesson.steps.map((s) => {
    const c = s.content;
    if (c.kind === 'explain' || c.kind === 'triggers') return s;
    const content: LessonStepContent = { ...c, exerciseIds: ids[c.kind] ?? [] };
    return { ...s, content };
  });
}

export async function readExercises(path: string): Promise<ExerciseRow[]> {
  const rows: ExerciseRow[] = [];
  if (!existsSync(path)) return rows;
  for await (const r of readJsonl<ExerciseRow>(path)) rows.push(r);
  return rows;
}

export interface ExerciseDeps {
  /** Batches clients for tests; by default the fill mode decides. */
  generateClient?: BatchClient;
  reviewClient?: BatchClient;
}

export async function runExercises(
  ctx: StageContext,
  deps: ExerciseDeps = {},
): Promise<Record<string, unknown>> {
  const files = morphFiles(ctx);
  const opts = planOptionsOf(ctx);
  const lessons = await readAuthoredLessons(authoredDir(ctx, 'lessons'));
  const triggerRows = await readTriggerRows(triggersOut(ctx));
  const lessonRows = await readLessonRows(lessonsOut(ctx));
  const m = await loadMorphology(files, {
    formsFor: planLemmaFilter(lessons, triggerRows, opts),
    words: true,
  });
  const triggers = planTriggers(m, triggerRows);
  const contrast = new Map<string, { id: string; meaningEn: string }[]>();
  for (const t of triggerRows)
    if (t.contrastGroup)
      contrast.set(t.contrastGroup, [...(contrast.get(t.contrastGroup) ?? []), { id: t.id, meaningEn: t.meaningEn }]);
  const rc: RuleContext = { m, prepositions: prepositionSpellings(m), vocabularyLimit: opts.vocabularyLimit };
  const slots = planAll(m, lessons, triggers, opts);
  const slotById = new Map(slots.map((s) => [s.slot, s]));

  const gpath = exercisesPath(ctx);
  const existing = await readExercises(gpath);
  const done = new Set(existing.map((r) => String(r.flags.slot)));
  const open = slots.filter((s) => !done.has(s.slot));
  const rejections: Rejection[] = [];
  const mode = fillModeOf(ctx);
  const options = runOptionsOf(ctx);
  let generation: BatchOutcome<ExerciseRequest, unknown> | null = null;
  let review: BatchOutcome<ReviewRequest, unknown> | null = null;
  const added: ExerciseRow[] = [];

  if (options && open.length > 0) {
    const gen = await runBatch(exercisesTask, generationJobs(open, opts.vocabularyLimit), {
      ...options,
      ...(deps.generateClient ? { client: deps.generateClient } : {}),
    });
    generation = gen as BatchOutcome<ExerciseRequest, unknown>;
    for (const f of gen.failures)
      rejections.push({ slot: f.id, stage: 'model', reason: f.reason });
    const passed: { slot: Slot; c: Candidate; text: string; start: number; end: number; hash: string }[] = [];
    for (const r of gen.results)
      for (const c of r.output.items) {
        const slot = slotById.get(c.slot);
        if (!slot) continue;
        const checked = checkCandidate(c, slot, rc);
        if (!checked.ok)
          rejections.push({ slot: c.slot, stage: 'rules', reason: checked.problems.join('; '), sentenceSk: c.sentenceSk });
        else passed.push({ slot, c, ...checked.value, hash: r.hash });
      }
    let items = passed.map((p) => reviewItem(p.slot, p.c, p.text));
    if (mode === 'dry-run')
      // Nothing was written yet: estimate the review as if every open slot passed, with a
      // sentence of a typical length.
      items = open.map((s) =>
        reviewItem(s, { slot: s.slot, sentenceSk: `${s.trigger.say} ${s.gap} a ešte pár slov.`, sentenceEn: 'A typical sentence of about eight words.', gap: s.gap }, s.gap),
      );
    if (items.length > 0) {
      const rev = await runBatch(reviewTask, reviewJobs(items), {
        ...options,
        ...(deps.reviewClient ? { client: deps.reviewClient } : {}),
      });
      review = rev as BatchOutcome<ReviewRequest, unknown>;
      const verdict = new Map<string, { ok: boolean; problem?: string; hash: string }>();
      for (const r of rev.results)
        for (const v of r.output.items)
          verdict.set(v.id, {
            ok: v.natural && v.translationCorrect && v.onlyThisCase,
            hash: r.hash,
            ...(v.problem ? { problem: v.problem } : {}),
          });
      for (const f of rev.failures) rejections.push({ slot: f.id, stage: 'model', reason: `review: ${f.reason}` });
      for (const p of passed) {
        const v = verdict.get(p.slot.slot);
        if (!v) continue;
        if (!v.ok) {
          rejections.push({ slot: p.slot.slot, stage: 'review', reason: v.problem ?? 'rejected by the review', sentenceSk: p.c.sentenceSk });
          continue;
        }
        added.push(
          buildRow(rc, p.slot, p.c, { start: p.start, end: p.end, text: p.text }, contrast, {
            slot: p.slot.slot,
            review: 'pass',
            model: exercisesTask.model ?? DEFAULT_MODEL,
            generation: { route: exercisesTask.route, promptVersion: exercisesTask.promptVersion, requestHash: p.hash },
            reviewer: { route: reviewTask.route, promptVersion: reviewTask.promptVersion, requestHash: v.hash },
          }),
        );
      }
    }
    if (added.length > 0) {
      const all = [...existing, ...added].sort((a, b) => (String(a.flags.slot) < String(b.flags.slot) ? -1 : 1));
      const w = await JsonlWriter.open(gpath);
      for (const r of all) await w.write(r);
      await w.close();
      ctx.log(`exercises: ${added.length} exercises added to ${gpath}`);
    }
  } else if (open.length > 0)
    ctx.log(`exercises: ${open.length} slots have no exercise; --fill dry-run estimates the model fill`);

  // The bank: every stored row whose slot is still planned (or any slot when --buckets
  // narrows the plan), unique by id.
  const bank = new Map<string, ExerciseRow>();
  for (const r of [...existing, ...added]) if (!bank.has(r.id)) bank.set(r.id, r);
  const rows = [...bank.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const w = await JsonlWriter.open(out(ctx, 'exercises.jsonl'));
  for (const r of rows) await w.write(r);
  await w.close();
  const lw = await JsonlWriter.open(out(ctx, 'lessons.jsonl'));
  for (const l of lessonRows) await lw.write({ id: l.id, steps: fillSteps(l, rows) });
  await lw.close();

  const perBucket: Record<string, number> = {};
  for (const r of rows) perBucket[`${r.case}.${r.number}.${r.gender}`] = (perBucket[`${r.case}.${r.number}.${r.gender}`] ?? 0) + 1;
  const perLesson: Record<string, number> = {};
  for (const r of rows) perLesson[r.lessonId ?? 'none'] = (perLesson[r.lessonId ?? 'none'] ?? 0) + 1;
  const summary = {
    mode,
    morphology: m.source,
    slots: slots.length,
    openSlots: open.length,
    exercises: rows.length,
    added: added.length,
    rejected: rejections.length,
    perBucket,
    perLesson,
    generation: generation
      ? { requests: generation.requests, cached: generation.cached, sent: generation.sent, estimate: generation.estimate, actualUsd: generation.actualUsd }
      : null,
    review: review
      ? { requests: review.requests, cached: review.cached, sent: review.sent, estimate: review.estimate, actualUsd: review.actualUsd }
      : null,
  };
  if (generation && review) {
    const usd = generation.estimate.usd + review.estimate.usd;
    const worst = generation.estimate.worstUsd + review.estimate.worstUsd;
    ctx.log(
      `exercises: ${generation.estimate.requests + review.estimate.requests} requests to send in all, estimate ${formatUsd(usd)} at batch prices (at most ${formatUsd(worst)})`,
    );
  }
  await writeFileAtomic(out(ctx, 'report.json'), stableJson({ ...summary, rejections }));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary, rejections, lessonBuckets(lessons)));
  for (const r of rejections.slice(0, 20)) ctx.log(`exercises: rejected ${r.slot} (${r.stage}): ${r.reason}`);
  ctx.log(`exercises: ${rows.length} exercises in the bank, ${rejections.length} rejected in this run`);
  return { ...summary, perBucket: undefined, rejections: rejections.length };
}

function renderReport(
  s: {
    mode: string;
    slots: number;
    openSlots: number;
    exercises: number;
    perBucket: Record<string, number>;
    perLesson: Record<string, number>;
    generation: { requests: number; estimate: { usd: number; worstUsd: number; requests: number; inputTokens: number; outputTokens: number } } | null;
    review: { requests: number; estimate: { usd: number; worstUsd: number; requests: number; inputTokens: number; outputTokens: number } } | null;
  },
  rejections: readonly Rejection[],
  buckets: Map<string, string[]>,
): string {
  const lines = [
    '# Exercises report',
    '',
    `Mode \`${s.mode}\`. ${s.slots} slots planned, ${s.openSlots} without an exercise before this run. ${s.exercises} exercises in the bank.`,
    '',
    '## Model fill',
    '',
  ];
  for (const [name, o] of [['Generation', s.generation], ['Review', s.review]] as const)
    if (o)
      lines.push(
        `- ${name}: ${o.estimate.requests} requests to send, ${o.estimate.inputTokens.toLocaleString('en')} input and ${o.estimate.outputTokens.toLocaleString('en')} output tokens, ${formatUsd(o.estimate.usd)} at batch prices (at most ${formatUsd(o.estimate.worstUsd)}).`,
      );
  if (!s.generation) lines.push('No fill in this run.');
  lines.push('', '## Exercises per bucket', '', '| Lesson | Bucket | Exercises |', '|---|---|---:|');
  for (const [lesson, keys] of buckets)
    if (lesson !== MIXED_LESSON) for (const k of keys) lines.push(`| ${lesson} | ${k} | ${s.perBucket[k] ?? 0} |`);
  lines.push('', '## Exercises per lesson', '', ...Object.entries(s.perLesson).map(([k, v]) => `- ${k}: ${v}`), '');
  if (rejections.length > 0)
    lines.push(
      '## Rejected in this run',
      '',
      ...rejections.slice(0, 300).map((r) => `- ${r.slot} (${r.stage}): ${r.reason}${r.sentenceSk ? ` — ${r.sentenceSk}` : ''}`),
      '',
    );
  return `${lines.join('\n')}\n`;
}

/** The exercises a complete build wants per bucket (docs/architecture.md, "Stages"). */
export const BUCKET_TARGET = 40;

/**
 * Every exercise's answers are real forms of its target words with the claimed case and
 * number; the gap holds an answer; options of a form choice are real forms of the target
 * words, exactly one of them right; generated rows are reviewed and never marked verified.
 */
export const exerciseFormsCheck: Check = {
  id: 'c4.exercises',
  description:
    'Answers and choice options are real forms of the target words with the claimed tag; one option is right; generated rows are reviewed, not verified',
  async run(ctx) {
    const rows: { n: number; row: ExerciseRow }[] = [];
    for await (const r of ctx.rows('exercises.jsonl')) rows.push(r);
    if (rows.length === 0) return;
    const ids = new Set(rows.flatMap((r) => r.row.target.lemmaIds));
    const forms = new Map<number, Map<string, string[]>>();
    for await (const { row } of ctx.raw('forms.jsonl')) {
      const id = row.lemmaId as number;
      if (!ids.has(id)) continue;
      const map = forms.get(id) ?? new Map<string, string[]>();
      const key = formKey(String(row.form));
      map.set(key, [...(map.get(key) ?? []), ...String(row.tags).split(' ')]);
      forms.set(id, map);
    }
    const fitsTag = (tag: string, r: ExerciseRow) => {
      try {
        const t = parseTag(tag);
        if (t.kind === 'noun') return t.case === r.case && t.number === r.number;
        if (t.kind === 'agree') return t.case === r.case && t.number === r.number && t.gender === r.gender;
        if (t.kind === 'pron') return t.case === r.case;
      } catch {
        return false;
      }
      return false;
    };
    /** Why a text is not a form of the target words, or null. */
    const notAForm = (text: string, r: ExerciseRow, tagged: boolean): string | null => {
      const words = text.split(/\s+/u).filter(Boolean).map(formKey);
      if (words.length !== r.target.lemmaIds.length)
        return `"${text}" has ${words.length} words for ${r.target.lemmaIds.length} target words`;
      for (const [j, w] of words.entries()) {
        const id = r.target.lemmaIds[j] as number;
        const tags = forms.get(id)?.get(w);
        if (!tags) return `"${w}" is not a form of lemma ${id}`;
        if (tagged && !tags.some((t) => fitsTag(t, r)))
          return `"${w}" is ${tags.join(' ')} of lemma ${id}, not ${r.case} ${r.number}`;
      }
      return null;
    };
    const perBucket = new Map<string, number>();
    for (const { n, row } of rows) {
      const w = `exercises.jsonl:${n} (${row.id})`;
      const k = `${row.case}.${row.number}.${row.gender}`;
      perBucket.set(k, (perBucket.get(k) ?? 0) + 1);
      if (row.source === 'generated') {
        if (row.verified) ctx.issue(`${w}: a generated exercise is marked verified`);
        if (row.flags.review !== 'pass') ctx.issue(`${w}: a generated exercise without a passed review`);
      }
      const answers = new Set(row.target.answers.map(formKey));
      for (const a of row.target.answers) {
        const why = notAForm(a, row, true);
        if (why) ctx.issue(`${w}: answer ${why}`);
      }
      const gap = formKey(row.sentenceSk.slice(row.target.start, row.target.end));
      if (!answers.has(gap)) ctx.issue(`${w}: the gap "${gap}" is not an accepted answer`);
      const opts = row.options ?? [];
      if (row.kind === 'cloze') {
        if (opts.length > 0) ctx.issue(`${w}: a cloze with options`);
        continue;
      }
      if (opts.filter((o) => o.correct).length !== 1) ctx.issue(`${w}: not exactly one right option`);
      if (row.kind === 'choice_form')
        for (const o of opts) {
          const why = notAForm(o.text, row, false);
          if (why) ctx.issue(`${w}: option ${why}`);
          else if (o.correct !== answers.has(formKey(o.text)))
            ctx.issue(`${w}: option "${o.text}" is marked ${o.correct ? 'right' : 'wrong'}`);
        }
    }
    if (ctx.complete)
      for (const [k, c] of perBucket)
        if (c < BUCKET_TARGET) ctx.warn(`bucket ${k} has ${c} exercises, fewer than ${BUCKET_TARGET}`);
  },
};

export const exercisesStage: Stage = {
  name: 'exercises',
  description: 'The verified exercise bank, bucket by bucket (content.exercises + review)',
  codeDir: codeDirOf(import.meta.url),
  options: {
    ...FILL_OPTIONS,
    ...MORPH_OPTION,
    'per-bucket': { type: 'string' },
    vocabulary: { type: 'string' },
    buckets: { type: 'string' },
    exercises: { type: 'string' },
  },
  // The exercises file is an input that a fill also writes; the runner fingerprints it after
  // the run, so a run that added exercises is skipped next time.
  inputs: (ctx) => [
    authoredDir(ctx, 'lessons'),
    triggersOut(ctx),
    lessonsOut(ctx),
    ...morphInputs(morphFiles(ctx)),
    exercisesPath(ctx),
  ],
  outputs: (ctx) => ['exercises.jsonl', 'lessons.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  params: (ctx) => ({
    fill: fillModeOf(ctx),
    morph: ctx.args.morph ?? null,
    perBucket: ctx.args['per-bucket'] ?? null,
    vocabulary: ctx.args.vocabulary ?? null,
    buckets: ctx.args.buckets ?? null,
    maxSpend: ctx.args['max-spend'] ?? null,
    at: fillModeOf(ctx) === 'dry-run' || fillModeOf(ctx) === 'live' ? ctx.now().toISOString() : null,
  }),
  run: (ctx) => runExercises(ctx),
  parts: [
    { file: 'exercises.jsonl', path: (p) => join(p.build, 'exercises', 'exercises.jsonl') },
    { file: 'lessons.jsonl', path: (p) => join(p.build, 'exercises', 'lessons.jsonl'), mode: 'merge' },
  ],
  checks: [exerciseFormsCheck],
};
