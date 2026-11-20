// Stage audit: the review reports of work package I2. A second model pass reads a random
// sample of the finished content: 100 example sentences, 100 exercises and the glosses of 100
// of the most common lemmas. The stage changes nothing in the set. It writes
// content/build/audit/report.md with what the pass found and for-you.md with 30 items for a
// person to look at: every item the pass doubts first, then items it passed.
//
// The sample is drawn by a seed, so a second run asks about the same items and reads their
// verdicts from the cache. An item belongs to a request by its own hash, never by its place
// in the sample: when an item changes or leaves the set, the only requests asked again are
// its own and the one that receives the item drawn in its place.
//
//   pnpm run pipeline audit                  the sample and the verdicts already made
//   pnpm run pipeline audit --fill dry-run   + request count and cost of the missing verdicts
//   pnpm run pipeline audit --fill live      + sends them
//   pnpm run pipeline audit --fill mock      + scripted verdicts (every item passes)
//   pnpm run pipeline audit --fill offline   + verdicts written outside the API
import { join } from 'node:path';
import {
  existsSync,
  readJsonl,
  sha256,
  stableJson,
  writeFileAtomic,
  writeJsonl,
} from '../../lib/files';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import {
  FILL_OPTIONS,
  fillAlwaysRuns,
  fillModeOf,
  modelCacheDir,
  runOptionsOf,
} from '../../model/options';
import { formatUsd } from '../../model/pricing';
import { type BatchJob, type BatchTask, type RunOptions, runBatch } from '../../model/runner';
import { CASE_NAMES, describeTag, GENDER_NAMES } from '../sentences/prompts';
import {
  AUDIT_GROUP_SIZE,
  AUDIT_KINDS,
  AUDIT_ROUTES,
  type AuditAnswer,
  type AuditKind,
  type AuditRequest,
  type AuditVerdict,
  auditExercisesTask,
  auditGlossesTask,
  auditSentencesTask,
  type ExerciseAuditItem,
  type GlossAuditItem,
  type SentenceAuditItem,
} from './prompts';

export const AUDIT_SIZE = 100;
export const AUDIT_SEED = 'i2';
/** Glosses are sampled among the lemmas ranked up to this: the words the app teaches. */
export const AUDIT_TOP = 3000;
/** Items in for-you.md, an equal share of each kind. */
export const FOR_YOU = 30;

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'audit', f);

function inputsOf(ctx: StageContext) {
  const b = ctx.paths.build;
  return {
    sentences: join(b, 'sentences', 'sentences.jsonl'),
    exercises: join(b, 'exercises', 'exercises.jsonl'),
    senses: join(b, 'dict', 'senses.jsonl'),
    lemmas: join(b, 'morph', 'lemmas.jsonl'),
    ranks: join(b, 'freq', 'lemmas.jsonl'),
    triggers: join(b, 'triggers', 'triggers.jsonl'),
  };
}

function positiveInt(v: unknown, name: string, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a whole number above 0`);
  return n;
}
const sizeOf = (ctx: StageContext) => positiveInt(ctx.args.size, 'size', AUDIT_SIZE);
const seedOf = (ctx: StageContext) =>
  typeof ctx.args.seed === 'string' && ctx.args.seed !== '' ? ctx.args.seed : AUDIT_SEED;

/** The first `size` rows in the order of sha256(seed, id): the same rows on every run. */
export function sample<T>(
  rows: readonly T[],
  idOf: (row: T) => string,
  size: number,
  seed: string,
): T[] {
  return rows
    .map((row) => ({ row, key: sha256(`${seed}|${idOf(row)}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, size)
    .map((x) => x.row);
}

const JOB_PREFIX: Record<AuditKind, string> = { sentences: 's', exercises: 'e', glosses: 'g' };

/**
 * Gives each item of one kind its request and its number in it. The request follows from
 * the item's own hash, so it does not move when another item leaves the sample.
 */
function assign(
  kind: AuditKind,
  rows: { id: string; asked: Record<string, unknown> }[],
  size: number,
  seed: string,
): AuditItem[] {
  const groups = Math.max(1, Math.ceil(size / AUDIT_GROUP_SIZE));
  const next = new Map<string, number>();
  return rows.map((row) => {
    const group = Number.parseInt(sha256(`${seed}|${row.id}`).slice(0, 8), 16) % groups;
    const job = `${JOB_PREFIX[kind]}${group}`;
    const n = next.get(job) ?? 0;
    next.set(job, n + 1);
    return { kind, id: row.id, job, n, asked: row.asked };
  });
}

interface LemmaRow {
  id: number;
  lemma: string;
  pos: string;
  gender?: string;
  aspect?: string;
}
interface SentenceRow {
  id: string;
  textSk: string;
  textEn: string;
  source: string;
  links: { lemmaId: number; form: string; tag: string; ord: number }[];
}
interface ExerciseRow {
  id: string;
  kind: string;
  sentenceSk: string;
  sentenceEn: string;
  target: { cue: string; answers: string[] };
  case: string;
  number: string;
  gender?: string;
  triggerId?: string;
  options?: { text: string; correct: boolean }[];
}
interface TriggerRow {
  id: string;
  kind: string;
  lemma: string;
  case: string;
  meaningEn: string;
}

/** One sampled item: what the pass is asked, and what it answered. */
export interface AuditItem {
  kind: AuditKind;
  /** The id of the sentence or the exercise, or `lemma|pos|gender` of a dictionary entry. */
  id: string;
  /** The request that asks about the item (`s2`) and the item's number in it. */
  job: string;
  n: number;
  /** The item as the request shows it, without its number. */
  asked: Record<string, unknown>;
  verdict?: AuditVerdict;
  problem?: string;
  fix?: string;
  model?: string;
  requestHash?: string;
}

async function readAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for await (const r of readJsonl<T>(path)) rows.push(r);
  return rows;
}

const glossText = (s: { glossEn: string; note?: string }) =>
  s.note ? `${s.glossEn} (${s.note})` : s.glossEn;

/** The sample of each kind, each item as its request shows it. */
export async function drawSample(
  ctx: StageContext,
  size: number,
  seed: string,
): Promise<{ items: AuditItem[]; population: Record<AuditKind, number> }> {
  const f = inputsOf(ctx);
  for (const [name, path] of Object.entries(f))
    if (!existsSync(path))
      throw new Error(`audit: ${path} (${name}) does not exist. Build the set first.`);
  const lemmas = new Map<number, LemmaRow>();
  for await (const l of readJsonl<LemmaRow>(f.lemmas)) lemmas.set(l.id, l);
  const senses = new Map<number, { ord: number; glossEn: string; note?: string }[]>();
  for await (const s of readJsonl<{ lemmaId: number; ord: number; glossEn: string; note?: string }>(
    f.senses,
  )) {
    const list = senses.get(s.lemmaId) ?? [];
    list.push(s);
    senses.set(s.lemmaId, list);
  }
  for (const list of senses.values()) list.sort((a, b) => a.ord - b.ord);
  const meaning = (id: number) => (senses.get(id) ?? []).slice(0, 3).map(glossText);
  const triggers = new Map<string, TriggerRow>();
  for await (const t of readJsonl<TriggerRow>(f.triggers)) triggers.set(t.id, t);

  const sentences = await readAll<SentenceRow>(f.sentences);
  const exercises = await readAll<ExerciseRow>(f.exercises);
  const common: LemmaRow[] = [];
  for await (const r of readJsonl<{ id: number; freqRank?: number }>(f.ranks)) {
    const l = lemmas.get(r.id);
    if (l && r.freqRank !== undefined && r.freqRank <= AUDIT_TOP && senses.has(l.id))
      common.push(l);
  }
  const entryId = (l: LemmaRow) => [l.lemma, l.pos, l.gender ?? ''].join('|');

  type Row = { id: string; asked: Record<string, unknown> };
  const sentenceRows: Row[] = [];
  const exerciseRows: Row[] = [];
  const glossRows: Row[] = [];
  for (const s of sample(sentences, (r) => r.id, size, seed)) {
    const teaches = [...s.links]
      .sort((a, b) => a.ord - b.ord)
      .map((k) => {
        const l = lemmas.get(k.lemmaId);
        const m = meaning(k.lemmaId);
        return {
          lemma: l?.lemma ?? `#${k.lemmaId}`,
          pos: l?.pos ?? 'other',
          ...(l?.gender ? { gender: l.gender } : {}),
          ...(m.length > 0 ? { meaning: m } : {}),
          form: k.form,
          formIs: describeTag(k.tag),
        };
      });
    const asked: Omit<SentenceAuditItem, 'n'> = {
      sk: s.textSk,
      en: s.textEn,
      source: s.source,
      teaches,
    };
    sentenceRows.push({ id: s.id, asked });
  }
  for (const e of sample(exercises, (r) => r.id, size, seed)) {
    const t = e.triggerId ? triggers.get(e.triggerId) : undefined;
    const asked: Omit<ExerciseAuditItem, 'n'> = {
      kind: e.kind,
      sk: e.sentenceSk,
      en: e.sentenceEn,
      answer: e.target.answers[0] ?? '',
      cue: e.target.cue,
      asks: [
        `${CASE_NAMES[e.case] ?? e.case} ${e.number === 'pl' ? 'plural' : 'singular'}`,
        ...(e.gender ? [GENDER_NAMES[e.gender] ?? e.gender] : []),
      ].join(', '),
      ...(t
        ? { trigger: `${t.kind} ${t.lemma} + ${CASE_NAMES[t.case] ?? t.case}: ${t.meaningEn}` }
        : {}),
      ...(e.options ? { options: e.options } : {}),
    };
    exerciseRows.push({ id: e.id, asked });
  }
  for (const l of sample(common, entryId, size, seed)) {
    const asked: Omit<GlossAuditItem, 'n'> = {
      lemma: l.lemma,
      pos: l.pos,
      ...(l.gender ? { gender: l.gender } : {}),
      ...(l.aspect ? { aspect: l.aspect } : {}),
      glosses: (senses.get(l.id) ?? []).map(glossText),
    };
    glossRows.push({ id: entryId(l), asked });
  }
  return {
    items: [
      ...assign('sentences', sentenceRows, size, seed),
      ...assign('exercises', exerciseRows, size, seed),
      ...assign('glosses', glossRows, size, seed),
    ],
    population: {
      sentences: sentences.length,
      exercises: exercises.length,
      glosses: common.length,
    },
  };
}

const TASKS: Record<AuditKind, BatchTask<AuditRequest<{ n: number }>, AuditAnswer>> = {
  sentences: auditSentencesTask as BatchTask<AuditRequest<{ n: number }>, AuditAnswer>,
  exercises: auditExercisesTask as BatchTask<AuditRequest<{ n: number }>, AuditAnswer>,
  glosses: auditGlossesTask as BatchTask<AuditRequest<{ n: number }>, AuditAnswer>,
};
const KIND_TITLES: Record<AuditKind, string> = {
  sentences: 'Example sentences',
  exercises: 'Exercises',
  glosses: 'Glosses (dictionary entries)',
};

/** The jobs of one kind: its requests in the order of their names. */
function jobsOf(items: readonly AuditItem[]): BatchJob<AuditRequest<{ n: number }>>[] {
  const byJob = new Map<string, AuditItem[]>();
  for (const it of items) byJob.set(it.job, [...(byJob.get(it.job) ?? []), it]);
  return [...byJob.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, mine]) => ({
      id,
      input: { items: mine.map((it) => ({ n: it.n, ...it.asked })) },
    }));
}

interface KindSummary {
  population: number;
  sampled: number;
  checked: number;
  verdicts: Record<AuditVerdict, number>;
  requests?: number;
  open?: number;
  estimateUsd?: number;
  worstUsd?: number;
  failed?: string[];
}

export async function runAudit(ctx: StageContext): Promise<unknown> {
  const size = sizeOf(ctx);
  const seed = seedOf(ctx);
  const mode = fillModeOf(ctx);
  const { items, population } = await drawSample(ctx, size, seed);
  // Without a fill the verdicts already in the cache still count: a dry run sends nothing
  // and reads them.
  const options: RunOptions = runOptionsOf(ctx, 'audit') ?? {
    mode: 'dry-run',
    cacheDir: modelCacheDir(ctx.paths),
  };
  const summary = {} as Record<AuditKind, KindSummary>;
  for (const kind of AUDIT_KINDS) {
    const mine = items.filter((it) => it.kind === kind);
    const jobs = jobsOf(mine);
    const s: KindSummary = {
      population: population[kind],
      sampled: mine.length,
      checked: 0,
      verdicts: { ok: 0, minor: 0, wrong: 0 },
    };
    if (jobs.length > 0) {
      const outcome = await runBatch(TASKS[kind], jobs, {
        ...options,
        ...(mode === 'none' ? { log: () => undefined } : {}),
      });
      for (const r of outcome.results) {
        for (const a of r.output.items) {
          const it = mine.find((x) => x.job === r.id && x.n === a.n);
          if (!it) continue;
          it.verdict = a.verdict;
          it.problem = a.problem;
          it.fix = a.fix;
          it.model = r.model;
          it.requestHash = r.hash;
          s.checked++;
          s.verdicts[a.verdict]++;
        }
      }
      s.requests = outcome.requests;
      s.open = outcome.requests - new Set(outcome.results.map((x) => x.hash)).size;
      s.estimateUsd = outcome.estimate.usd;
      s.worstUsd = outcome.estimate.worstUsd;
      // An open request of an offline fill is no failure: its answer is not written yet.
      const failed = outcome.failures.filter((x) => x.reason !== 'no answer yet');
      if (failed.length > 0) s.failed = failed.map((x) => `${x.id}: ${x.reason}`);
    }
    summary[kind] = s;
  }
  const report = { seed, size, mode, kinds: summary };
  await writeJsonl(out(ctx, 'sample.jsonl'), items);
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(report));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(report, items));
  await writeFileAtomic(out(ctx, 'for-you.md'), renderForYou(items, seed));
  ctx.log(
    `audit: ${AUDIT_KINDS.map((k) => `${k} ${summary[k].checked} of ${summary[k].sampled} checked (${summary[k].verdicts.wrong} wrong, ${summary[k].verdicts.minor} minor)`).join('; ')}`,
  );
  const open = AUDIT_KINDS.reduce((n, k) => n + (summary[k].open ?? 0), 0);
  if (open > 0 && mode !== 'offline')
    ctx.log(`audit: ${open} requests have no verdict yet; --fill dry-run estimates the pass`);
  return report;
}

// --- Reports -------------------------------------------------------------------------------

const cell = (s: string) => s.replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim();

/** One item in words a person can judge without the data files. */
export function describeItem(it: AuditItem): string[] {
  const a = it.asked;
  if (it.kind === 'sentences') {
    const s = a as unknown as Omit<SentenceAuditItem, 'n'>;
    return [
      `**${s.sk}**`,
      s.en,
      ...s.teaches.map(
        (t) =>
          `Teaches \`${t.form}\` (${t.formIs}) of \`${t.lemma}\` (${[t.pos, t.gender].filter(Boolean).join(', ')}${t.meaning ? `: ${t.meaning.join('; ')}` : ''}).`,
      ),
      `Source: ${s.source}.`,
    ];
  }
  if (it.kind === 'exercises') {
    const e = a as unknown as Omit<ExerciseAuditItem, 'n'>;
    return [
      `**${e.sk}**`,
      e.en,
      `${e.kind}: the answer is \`${e.answer}\` (${e.asks}) of \`${e.cue}\`.`,
      ...(e.trigger ? [`Rule: ${e.trigger}.`] : []),
      ...(e.options
        ? [`Options: ${e.options.map((o) => (o.correct ? `**${o.text}**` : o.text)).join(' / ')}.`]
        : []),
    ];
  }
  const g = a as unknown as Omit<GlossAuditItem, 'n'>;
  return [
    `**${g.lemma}** (${[g.pos, g.gender, g.aspect].filter(Boolean).join(', ')})`,
    ...g.glosses.map((x, i) => `${i + 1}. ${x}`),
  ];
}

const verdictLine = (it: AuditItem): string[] =>
  it.verdict === undefined
    ? ['Second pass: not checked yet.']
    : it.verdict === 'ok'
      ? ['Second pass: ok.']
      : [
          `Second pass: **${it.verdict}**. ${it.problem ?? ''}`.trim(),
          ...(it.fix ? [`Suggested: ${it.fix}`] : []),
        ];

type Report = {
  seed: string;
  size: number;
  mode: string;
  kinds: Record<AuditKind, KindSummary>;
};

export function renderReport(r: Report, items: readonly AuditItem[]): string {
  const lines = [
    '# Audit report',
    '',
    `A second pass over a random sample of the finished content (seed \`${r.seed}\`, ${r.size} of each kind). \`wrong\`: a learner would learn something false. \`minor\`: nothing false, but the item should be better.`,
    '',
    '| Kind | In the set | Sampled | Checked | ok | minor | wrong |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const k of AUDIT_KINDS) {
    const s = r.kinds[k];
    lines.push(
      `| ${KIND_TITLES[k]} | ${s.population} | ${s.sampled} | ${s.checked} | ${s.verdicts.ok} | ${s.verdicts.minor} | ${s.verdicts.wrong} |`,
    );
  }
  lines.push('', '## Audit pass', '', `Mode \`${r.mode}\`.`, '');
  lines.push(
    '| Route | Requests | Without a verdict | Estimate | At most |',
    '|---|---:|---:|---:|---:|',
  );
  for (const k of AUDIT_KINDS) {
    const s = r.kinds[k];
    lines.push(
      `| ${AUDIT_ROUTES[k]} | ${s.requests ?? 0} | ${s.open ?? 0} | ${formatUsd(s.estimateUsd ?? 0)} | ${formatUsd(s.worstUsd ?? 0)} |`,
    );
    for (const x of s.failed ?? []) lines.push(`| ${AUDIT_ROUTES[k]} failed | ${cell(x)} | | | |`);
  }
  for (const k of AUDIT_KINDS) {
    const found = items.filter((it) => it.kind === k && it.verdict && it.verdict !== 'ok');
    lines.push('', `## ${KIND_TITLES[k]}: ${found.length} found`, '');
    for (const v of ['wrong', 'minor'] as const)
      for (const it of found.filter((x) => x.verdict === v))
        lines.push(
          `- \`${it.id}\` ${describeItem(it).join(' ')}`,
          `  ${verdictLine(it).join(' ')}`,
        );
    if (found.length === 0) lines.push('Nothing.');
  }
  return `${lines.join('\n')}\n`;
}

/** The items for a person: per kind those the pass doubts, then those it passed. */
export function pickForYou(items: readonly AuditItem[], total = FOR_YOU): AuditItem[] {
  const share = Math.ceil(total / AUDIT_KINDS.length);
  const rank = (it: AuditItem) => (it.verdict === 'wrong' ? 0 : it.verdict === 'minor' ? 1 : 2);
  const picked: AuditItem[] = [];
  for (const k of AUDIT_KINDS) {
    const mine = items.filter((it) => it.kind === k);
    picked.push(
      ...mine
        .map((it, i) => ({ it, i }))
        .sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i)
        .slice(0, share)
        .map((x) => x.it),
    );
  }
  return picked.slice(0, total);
}

export function renderForYou(items: readonly AuditItem[], seed: string): string {
  const picked = pickForYou(items);
  const lines = [
    '# Items to look at',
    '',
    `${picked.length} items of the audit sample (seed \`${seed}\`): the ones the second pass doubts come first in each group, the rest passed and are a plain random draw.`,
  ];
  for (const k of AUDIT_KINDS) {
    lines.push('', `## ${KIND_TITLES[k]}`);
    let n = 0;
    for (const it of picked.filter((x) => x.kind === k)) {
      n++;
      lines.push('', `### ${n}. \`${it.id}\``, '', ...describeItem(it).flatMap((l) => [l, '']));
      lines.push(...verdictLine(it));
    }
  }
  return `${lines.join('\n')}\n`;
}

export const auditStage: Stage = {
  name: 'audit',
  description:
    'A second pass over a random sample of sentences, exercises and glosses (content.audit.*)',
  codeDir: codeDirOf(import.meta.url),
  options: { ...FILL_OPTIONS, size: { type: 'string' }, seed: { type: 'string' } },
  inputs: (ctx) => Object.values(inputsOf(ctx)),
  outputs: (ctx) =>
    ['sample.jsonl', 'report.md', 'report.json', 'for-you.md'].map((f) => out(ctx, f)),
  params: (ctx) => ({
    fill: fillModeOf(ctx),
    size: sizeOf(ctx),
    seed: seedOf(ctx),
    maxSpend: ctx.args['max-spend'] ?? null,
    at: fillAlwaysRuns(ctx) ? ctx.now().toISOString() : null,
  }),
  run: runAudit,
};
