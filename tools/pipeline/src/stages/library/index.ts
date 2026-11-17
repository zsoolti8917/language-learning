// Stage 10, library: the twelve graded starter texts (docs/work-packages.md, C5). It reads the
// authored texts in content/authored/library/, splits each with the tokenizer of
// packages/ling, checks that every word is a known form of the morphology, counts tokens and
// lemmas, and measures the vocabulary profile: in an A2 text at least 90 % of the words lie
// within the 2,000 most common lemmas. The analysis stays empty until I2 runs the analyzer.
//
// A second model pass (`content.review`) reads each text; its answers live in
// content/generated/library-reviews.jsonl (in git), and each row of library.jsonl is marked
// `review: { status: 'reviewed', … }` when a review of its current body exists, else
// `review: { status: 'unreviewed' }`.
//
//   pnpm run pipeline library                  texts + the reviews already made
//   pnpm run pipeline library --fill dry-run   + request count and cost of the missing reviews
//   pnpm run pipeline library --fill live      + sends them (refuses above $5 without --max-spend)
//   pnpm run pipeline library --fill mock      + scripted reviews, kept in the build folder
import { join } from 'node:path';
import type { LibraryRow } from '@app/contracts';
import {
  existsSync,
  JsonlWriter,
  readJsonl,
  sha256,
  stableJson,
  writeFileAtomic,
} from '../../lib/files';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import { FILL_OPTIONS, fillModeOf, runOptionsOf } from '../../model/options';
import { formatUsd } from '../../model/pricing';
import { type BatchJob, DEFAULT_MODEL, runBatch } from '../../model/runner';
import { type AuthoredText, LIBRARY_LEVELS, readAuthoredTexts } from './authored';
import { REVIEW_PROMPT_VERSION, type ReviewAnswer, type ReviewInput, reviewTask } from './review';
import { setVocabulary } from './setvocab';
import {
  A2_MIN_SHARE,
  A2_WITHIN_RANK,
  buildFormIndex,
  type LemmaInfo,
  profileText,
  type TextProfile,
} from './vocab';

/** The starter library: twelve texts of 150 to 400 words. */
export const LIBRARY_TARGET = 12;
export const MIN_WORDS = 150;
export const MAX_WORDS = 400;

/** One review in content/generated/library-reviews.jsonl. */
export interface LibraryReview {
  id: string;
  /** sha256 of the body that was reviewed: an edited text needs a new review. */
  bodyHash: string;
  verdict: ReviewAnswer['verdict'];
  level: ReviewAnswer['level'];
  problems: ReviewAnswer['problems'];
  route: string;
  promptVersion: number;
  model: string;
  requestHash: string;
  /** Written by --fill mock: a scripted answer, never a real review. */
  mock?: true;
}

/** How a row of library.jsonl is marked. Not part of ling.library_text; the loader drops it. */
export type ReviewMark =
  | {
      status: 'reviewed';
      verdict: ReviewAnswer['verdict'];
      level: ReviewAnswer['level'];
      problems: number;
      model: string;
      promptVersion: number;
      mock?: true;
    }
  | { status: 'unreviewed' };

export type LibraryOutRow = LibraryRow & { review: ReviewMark };

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'library', f);
const base = () => process.env.INIT_CWD ?? process.cwd();

export function libraryDir(ctx: StageContext): string {
  return join(ctx.paths.content, 'authored', 'library');
}

/** content/generated/library-reviews.jsonl; mock reviews go to the build folder. */
export function reviewsPath(ctx: StageContext): string {
  const custom = resolveArg(ctx.args.reviews, base());
  if (custom) return custom;
  if (fillModeOf(ctx) === 'mock') return out(ctx, 'reviews.mock.jsonl');
  return join(ctx.paths.content, 'generated', 'library-reviews.jsonl');
}

function inputsOf(ctx: StageContext) {
  return {
    lemmas: join(ctx.paths.build, 'morph', 'lemmas.jsonl'),
    forms: join(ctx.paths.build, 'morph', 'forms.jsonl'),
    ranks: join(ctx.paths.build, 'freq', 'lemmas.jsonl'),
  };
}

export const bodyHash = (body: string) => sha256(body);

export async function readReviews(path: string): Promise<LibraryReview[]> {
  const rows: LibraryReview[] = [];
  if (!existsSync(path)) return rows;
  for await (const r of readJsonl<LibraryReview>(path)) rows.push(r);
  return rows;
}

export function reviewMark(review: LibraryReview | undefined): ReviewMark {
  if (!review) return { status: 'unreviewed' };
  return {
    status: 'reviewed',
    verdict: review.verdict,
    level: review.level,
    problems: review.problems.length,
    model: review.model,
    promptVersion: review.promptVersion,
    ...(review.mock ? { mock: true as const } : {}),
  };
}

/** Lemmas of the morphology with their ranks, as the profile needs them. */
export async function readLemmaInfo(
  lemmasPath: string,
  ranksPath: string,
): Promise<Map<number, LemmaInfo>> {
  const lemmas = new Map<number, LemmaInfo>();
  for await (const l of readJsonl<{
    id: number;
    lemma: string;
    flags?: { proper?: boolean; retired?: boolean };
  }>(lemmasPath)) {
    if (l.flags?.retired) continue;
    lemmas.set(l.id, { lemma: l.lemma, proper: l.flags?.proper === true });
  }
  for await (const r of readJsonl<{ id: number; freqRank: number }>(ranksPath)) {
    const l = lemmas.get(r.id);
    if (l) l.rank = r.freqRank;
  }
  return lemmas;
}

/** The problems of a set of texts that fail the stage: shape, unknown words, A2 profile. */
export function textProblems(texts: AuthoredText[], profiles: Map<string, TextProfile>): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const ords = new Set<number>();
  for (const t of texts) {
    if (ids.has(t.id)) problems.push(`${t.file}: id ${t.id} is used twice`);
    if (ords.has(t.ord)) problems.push(`${t.file}: ord ${t.ord} is used twice`);
    ids.add(t.id);
    ords.add(t.ord);
    const p = profiles.get(t.id) as TextProfile;
    if (p.words < MIN_WORDS || p.words > MAX_WORDS)
      problems.push(`${t.file}: ${p.words} words, not ${MIN_WORDS} to ${MAX_WORDS}`);
    if (p.unknown.length > 0) problems.push(`${t.file}: not a known form: ${p.unknown.join(', ')}`);
    if (t.level === 'A2' && p.share < A2_MIN_SHARE)
      problems.push(
        `${t.file}: ${pct(p.share)} of the words lie within the ${A2_WITHIN_RANK} most common lemmas; an A2 text needs ${pct(A2_MIN_SHARE)}`,
      );
  }
  return problems;
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

export async function runLibrary(ctx: StageContext): Promise<Record<string, unknown>> {
  const files = inputsOf(ctx);
  for (const [name, path] of Object.entries(files))
    if (!existsSync(path))
      throw new Error(`library: ${path} (${name}) does not exist. Run morph and freq first.`);
  const texts = (await readAuthoredTexts(libraryDir(ctx))).sort((a, b) => a.ord - b.ord);

  const lemmas = await readLemmaInfo(files.lemmas, files.ranks);
  const index = await buildFormIndex(
    texts.map((t) => t.body),
    readJsonl<{ lemmaId: number; form: string }>(files.forms),
  );
  const profiles = new Map<string, TextProfile>();
  for (const t of texts) profiles.set(t.id, profileText(t.body, index, lemmas));
  const problems = textProblems(texts, profiles);

  // Reviews: the ones made for the current bodies, then a fill for the rest.
  const mode = fillModeOf(ctx);
  const rpath = reviewsPath(ctx);
  const reviews = new Map<string, LibraryReview>();
  for (const r of await readReviews(rpath)) reviews.set(r.id, r);
  const current = (t: AuthoredText) => {
    const r = reviews.get(t.id);
    return r && r.bodyHash === bodyHash(t.body) ? r : undefined;
  };
  const pending = texts.filter((t) => !current(t));
  let fill: Record<string, unknown> = { mode, pending: pending.length };
  const options = runOptionsOf(ctx);
  if (options && pending.length > 0 && problems.length === 0) {
    const jobs: BatchJob<ReviewInput>[] = pending.map((t) => ({
      id: t.id,
      input: { id: t.id, title: t.title, level: t.level, body: t.body },
    }));
    const outcome = await runBatch(reviewTask, jobs, options);
    for (const r of outcome.results)
      reviews.set(r.id, {
        id: r.id,
        bodyHash: bodyHash(r.input.body),
        verdict: r.output.verdict,
        level: r.output.level,
        problems: r.output.problems,
        route: reviewTask.route,
        promptVersion: REVIEW_PROMPT_VERSION,
        model: reviewTask.model ?? DEFAULT_MODEL,
        requestHash: r.hash,
        ...(mode === 'mock' ? { mock: true as const } : {}),
      });
    if (outcome.results.length > 0) {
      const w = await JsonlWriter.open(rpath);
      for (const r of [...reviews.values()].sort((a, b) => (a.id < b.id ? -1 : 1)))
        await w.write(r);
      await w.close();
      ctx.log(`library: ${outcome.results.length} reviews written to ${rpath}`);
    }
    fill = {
      mode,
      pending: pending.length,
      requests: outcome.requests,
      cached: outcome.cached,
      sent: outcome.sent,
      answered: outcome.results.length,
      failed: outcome.failures.map((f) => `${f.id}: ${f.reason}`),
      estimate: outcome.estimate,
      actualUsd: outcome.actualUsd,
    };
  } else if (pending.length > 0) {
    ctx.log(
      `library: ${pending.length} texts have no review of their current text; --fill dry-run estimates the review pass`,
    );
  }

  const rows: LibraryOutRow[] = texts.map((t) => ({
    id: t.id,
    title: t.title,
    body: t.body,
    level: t.level,
    source: t.source,
    license: t.license,
    ord: t.ord,
    review: reviewMark(current(t)),
  }));
  const summary = {
    texts: texts.length,
    reviewed: rows.filter((r) => r.review.status === 'reviewed').length,
    problems,
    fill,
    profiles: texts.map((t) => {
      const p = profiles.get(t.id) as TextProfile;
      return {
        id: t.id,
        title: t.title,
        level: t.level,
        words: p.words,
        lemmas: p.lemmas,
        names: p.names,
        within: p.within,
        counted: p.counted,
        share: Math.round(p.share * 1000) / 1000,
        unknown: p.unknown,
        outside: p.outside,
        review: (rows.find((r) => r.id === t.id) as LibraryOutRow).review,
      };
    }),
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(summary));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary));
  if (problems.length > 0) {
    for (const p of problems) ctx.log(`library: ${p}`);
    throw new Error(`library: ${problems.length} problems, see ${out(ctx, 'report.md')}`);
  }
  const w = await JsonlWriter.open(out(ctx, 'library.jsonl'));
  for (const r of rows) await w.write(r);
  await w.close();
  ctx.log(
    `library: ${rows.length} texts, ${summary.reviewed} reviewed; ${summary.profiles.map((p) => `${p.id} ${p.level} ${p.words} words ${pct(p.share)}`).join(', ')}`,
  );
  return { texts: summary.texts, reviewed: summary.reviewed, fill };
}

type Summary = {
  texts: number;
  reviewed: number;
  problems: string[];
  fill: Record<string, unknown>;
  profiles: {
    id: string;
    title: string;
    level: string;
    words: number;
    lemmas: number;
    names: number;
    within: number;
    counted: number;
    share: number;
    unknown: string[];
    outside: { word: string; lemma: string; rank: number | null }[];
    review: ReviewMark;
  }[];
};

function renderReport(s: Summary): string {
  const lines = [
    '# Library report',
    '',
    `${s.texts} texts, ${s.reviewed} reviewed by a second model pass. Share: word tokens whose lemma ranks within the ${A2_WITHIN_RANK} most common, among the known words that are not only a proper name; an A2 text needs ${pct(A2_MIN_SHARE)}.`,
    '',
    '| Id | Title | Level | Words | Lemmas | Names | Within | Share | Review |',
    '|---|---|---|---:|---:|---:|---:|---:|---|',
    ...s.profiles.map(
      (p) =>
        `| ${p.id} | ${p.title} | ${p.level} | ${p.words} | ${p.lemmas} | ${p.names} | ${p.within}/${p.counted} | ${pct(p.share)} | ${p.review.status === 'reviewed' ? `${p.review.verdict}${p.review.mock ? ' (mock)' : ''}, ${p.review.problems} problems` : 'unreviewed'} |`,
    ),
    '',
  ];
  if (s.problems.length > 0) lines.push('## Problems', '', ...s.problems.map((p) => `- ${p}`), '');
  const f = s.fill as {
    mode: string;
    pending: number;
    estimate?: { requests: number; usd: number; worstUsd: number; model: string };
  };
  lines.push(
    '## Review pass',
    '',
    `Mode \`${f.mode}\`, ${f.pending} texts without a current review.`,
  );
  if (f.estimate)
    lines.push(
      '',
      `Estimate: ${f.estimate.requests} requests on ${f.estimate.model}, ${formatUsd(f.estimate.usd)} at batch prices (at most ${formatUsd(f.estimate.worstUsd)}).`,
    );
  lines.push('', '## Words outside the limit', '');
  for (const p of s.profiles)
    lines.push(
      `- ${p.id}: ${p.outside.map((o) => `${o.word} (${o.lemma}, ${o.rank ?? 'unranked'})`).join(', ') || 'none'}`,
    );
  return `${lines.join('\n')}\n`;
}

// --- Checks --------------------------------------------------------------------------------

/** In a complete build an issue, else a warning: the mini dataset is no starter library. */
const target = (ctx: Parameters<Check['run']>[0], message: string) =>
  ctx.complete ? ctx.issue(message) : ctx.warn(message);

/** Twelve texts from A2 to B1, of 150 to 400 words, each marked reviewed or unreviewed. */
export const libraryTextsCheck: Check = {
  id: 'library.texts',
  description: `At least ${LIBRARY_TARGET} texts, levels ${LIBRARY_LEVELS.join(' to ')}, ${MIN_WORDS} to ${MAX_WORDS} words each, each marked as reviewed or unreviewed`,
  async run(ctx) {
    if (!ctx.has('library.jsonl')) {
      target(ctx, 'no library.jsonl in the set');
      return;
    }
    const { index, lemmas } = await setVocabulary(ctx);
    let count = 0;
    const unreviewed: string[] = [];
    const mock: string[] = [];
    for await (const { n, row } of ctx.raw('library.jsonl')) {
      count++;
      const w = `library.jsonl:${n} (${String(row.id)})`;
      if (!(LIBRARY_LEVELS as readonly unknown[]).includes(row.level))
        target(ctx, `${w}: level ${String(row.level)}, not ${LIBRARY_LEVELS.join(' or ')}`);
      const words = profileText(String(row.body ?? ''), index, lemmas).words;
      if (words < MIN_WORDS || words > MAX_WORDS)
        target(ctx, `${w}: ${words} words, not ${MIN_WORDS} to ${MAX_WORDS}`);
      const review = row.review as Partial<ReviewMark> | undefined;
      if (review?.status === 'unreviewed') unreviewed.push(String(row.id));
      else if (review?.status === 'reviewed') {
        if ((review as { mock?: boolean }).mock) mock.push(String(row.id));
        if ((review as { verdict?: string }).verdict === 'revise')
          ctx.warn(
            `${w}: the review asks for changes; see content/generated/library-reviews.jsonl`,
          );
      } else target(ctx, `${w}: not marked as reviewed or unreviewed`);
    }
    if (count < LIBRARY_TARGET)
      target(ctx, `library.jsonl has ${count} texts; the starter library needs ${LIBRARY_TARGET}`);
    if (unreviewed.length > 0)
      ctx.warn(`${unreviewed.length} texts are unreviewed: ${unreviewed.join(', ')}`);
    if (mock.length > 0)
      ctx.warn(`${mock.length} texts carry a mock review, not a real one: ${mock.join(', ')}`);
  },
};

/** Every word of a text is a known form; an A2 text keeps 90 % of its words in the top 2,000. */
export const libraryVocabularyCheck: Check = {
  id: 'library.vocabulary',
  description: `Every word of a library text is a known form, and an A2 text has ${A2_MIN_SHARE * 100} % of its words within the ${A2_WITHIN_RANK} most common lemmas`,
  async run(ctx) {
    if (!ctx.has('library.jsonl')) return;
    const { index, lemmas } = await setVocabulary(ctx);
    for await (const { n, row } of ctx.raw('library.jsonl')) {
      const w = `library.jsonl:${n} (${String(row.id)})`;
      const p = profileText(String(row.body ?? ''), index, lemmas);
      if (p.unknown.length > 0) target(ctx, `${w}: not a known form: ${p.unknown.join(', ')}`);
      if (row.level === 'A2' && p.share < A2_MIN_SHARE)
        target(
          ctx,
          `${w}: ${pct(p.share)} of the words lie within the ${A2_WITHIN_RANK} most common lemmas, below ${pct(A2_MIN_SHARE)}`,
        );
    }
  },
};

export const libraryStage: Stage = {
  name: 'library',
  description:
    'Graded starter texts: known forms, vocabulary profile, a review pass (content.review)',
  codeDir: codeDirOf(import.meta.url),
  options: { ...FILL_OPTIONS, reviews: { type: 'string' } },
  // The reviews file is an input that a fill also writes; the runner fingerprints it after
  // the run, so a run that added reviews is skipped next time.
  inputs: (ctx) => [libraryDir(ctx), ...Object.values(inputsOf(ctx)), reviewsPath(ctx)],
  outputs: (ctx) => ['library.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  params: (ctx) => ({
    fill: fillModeOf(ctx),
    maxSpend: ctx.args['max-spend'] ?? null,
    at:
      fillModeOf(ctx) === 'dry-run' || fillModeOf(ctx) === 'live' ? ctx.now().toISOString() : null,
  }),
  run: runLibrary,
  parts: [{ file: 'library.jsonl', path: (p) => join(p.build, 'library', 'library.jsonl') }],
  checks: [libraryTextsCheck, libraryVocabularyCheck],
};
