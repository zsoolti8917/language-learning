// Stage 5, sentences: two or three short, easy example sentences for each of the most common
// lemmas, each showing a frequent form (docs/work-packages.md, C3).
//
// 1. Harvest Tatoeba sentences with an English translation and the UD treebank's sentences.
// 2. Tokenize them with @app/ling, give each word its lemma and tag (the treebank's checked
//    analysis, else the lexicon narrowed by rules) and keep those that pass the rules: 4 to
//    12 words, every word within the top 3,000 lemmas, the target word in a top form.
// 3. Choose up to three per lemma, easiest first, different forms first.
// 4. Translate the chosen treebank sentences (`content.translate`).
// 5. Generate sentences for lemmas still short of two (`content.sentences`), check them by
//    the same rules, then by a second model pass (`content.review`).
// Model output lives in content/generated/sentences.jsonl (in git), so a rebuild needs no
// model call; mock fills go to the build folder.
//
//   pnpm run pipeline sentences                    harvest + what was generated before
//   pnpm run pipeline sentences --fill dry-run     + request count and cost of the fill
//   pnpm run pipeline sentences --fill live        + sends it (refuses above $5 without --max-spend)
//   pnpm run pipeline sentences --fill mock        + scripted answers (tests, local runs)
//   pnpm run pipeline sentences --fill offline     + answers written outside the API, route by
//                                                    route: translate, then sentences, then review
//   --lexicon <set dir>   take lemmas, forms, triggers and senses from a set (the mini dataset)
import { join } from 'node:path';
import type { SentenceRow } from '@app/contracts';
import { tokenize } from '@app/ling';
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
import { FILL_OPTIONS, fillAlwaysRuns, fillModeOf, runOptionsOf } from '../../model/options';
import { type CostEstimate, DEFAULT_MAX_SPEND_USD, formatUsd } from '../../model/pricing';
import {
  type BatchJob,
  type BatchOutcome,
  type RunOptions,
  runBatch,
  SpendLimitError,
} from '../../model/runner';
import { type Analysis, analyse } from './analyze';
import { excludedPath, readExcluded } from './excluded';
import {
  type HarvestedSentence,
  harvest,
  TATOEBA_FILES,
  TATOEBA_SOURCE,
  UD_SOURCE,
  UD_SPLITS,
  udFile,
} from './harvest';
import { lexiconFiles, loadLexicon } from './lexicon';
import {
  describeTag,
  REVIEW_GROUP_SIZE,
  type ReviewItem,
  type ReviewRequest,
  reviewTask,
  SENTENCE_GROUP_SIZE,
  type SentenceItem,
  type SentenceRequest,
  sentencesTask,
  TRANSLATE_GROUP_SIZE,
  type TranslateRequest,
  translateTask,
} from './prompts';
import {
  type Candidate,
  checkGenerated,
  choose,
  difficulty,
  MAX_PER_LEMMA,
  MAX_WORDS,
  MIN_PER_LEMMA,
  MIN_WORDS,
  REJECTIONS,
  type Rejection,
  rowTokens,
  sentenceProblem,
  type Target,
  targetsOf,
} from './rules';

/** Example sentences are for the lemmas ranked up to this, and use only words ranked up to it. */
export const SENTENCE_TOP = 3000;
/** The licence of model-written sentences: the project's own content licence. */
export const GENERATED_LICENSE = 'CC BY 4.0';

/** A generated sentence, accepted by the rules and the review, in content/generated/sentences.jsonl. */
export interface GeneratedSentence {
  kind: 'sentence';
  id: string;
  lemmaId: number;
  key: string;
  form: string;
  tag: string;
  textSk: string;
  /** The English translation the review accepted or corrected. */
  textEn: string;
  route: string;
  promptVersion: number;
  model: string;
  requestHash: string;
  review: { route: string; promptVersion: number; requestHash: string };
}

/** A model translation of a treebank sentence. */
export interface GeneratedTranslation {
  kind: 'translation';
  id: string;
  sourceRef: string;
  textSk: string;
  textEn: string;
  route: string;
  promptVersion: number;
  model: string;
  requestHash: string;
}

export type GeneratedRow = GeneratedSentence | GeneratedTranslation;

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'sentences', f);
const base = () => process.env.INIT_CWD ?? process.cwd();
const lexiconDir = (ctx: StageContext) => resolveArg(ctx.args.lexicon, base());

/** content/generated/sentences.jsonl; mock fills go to the build folder so git stays clean. */
export function generatedPath(ctx: StageContext): string {
  const custom = resolveArg(ctx.args.generated, base());
  if (custom) return custom;
  if (fillModeOf(ctx) === 'mock') return out(ctx, 'generated.mock.jsonl');
  return join(ctx.paths.content, 'generated', 'sentences.jsonl');
}

export async function readGenerated(path: string): Promise<GeneratedRow[]> {
  const rows: GeneratedRow[] = [];
  if (!existsSync(path)) return rows;
  for await (const r of readJsonl<GeneratedRow>(path)) rows.push(r);
  return rows;
}

function sensesPath(ctx: StageContext): string {
  const dir = lexiconDir(ctx);
  return dir ? join(dir, 'senses.jsonl') : join(ctx.paths.build, 'dict', 'senses.jsonl');
}

function rawFiles(ctx: StageContext): string[] {
  return [
    ...Object.values(TATOEBA_FILES).map((f) => join(ctx.paths.raw, TATOEBA_SOURCE, f)),
    ...UD_SPLITS.map((s) => join(ctx.paths.raw, UD_SOURCE, udFile(s))),
  ];
}

function intArg(ctx: StageContext, name: string, fallback: number): number {
  const v = ctx.args[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
}

/** A sentence that passed the rules, with what it can show. */
interface Kept {
  id: string;
  source: SentenceRow['source'];
  sourceRef: string;
  license: string;
  analysis: Analysis;
  targets: Target[];
  difficulty: number;
  textEn?: string;
}

const genId = (textSk: string) => `gen-${sha256(textSk).slice(0, 8)}`;
const count = <K>(m: Map<K, number>, k: K, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

interface FillReport {
  route: string;
  jobs: number;
  requests: number;
  cached: number;
  sent: number;
  answered: number;
  failed: number;
  estimate: CostEstimate;
  actualUsd: number;
}

function fillReport(o: BatchOutcome<unknown, unknown>, jobs: number): FillReport {
  return {
    route: o.route,
    jobs,
    requests: o.requests,
    cached: o.cached,
    sent: o.sent,
    answered: o.results.length,
    failed: o.failures.length,
    estimate: o.estimate,
    actualUsd: o.actualUsd,
  };
}

function groups<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function reviewJobsOf(
  reviewGroups: readonly (readonly { item: Omit<SentenceItem, 'n'>; sk: string; en: string }[])[],
): BatchJob<ReviewRequest>[] {
  return reviewGroups.map((g, i) => ({
    id: `r${i}`,
    input: {
      items: g.map(
        (p, n): ReviewItem => ({
          n,
          sk: p.sk,
          en: p.en,
          lemma: p.item.lemma,
          form: p.item.form,
          formIs: p.item.formIs,
        }),
      ),
    },
  }));
}

export async function runSentences(ctx: StageContext): Promise<Record<string, unknown>> {
  const top = intArg(ctx, 'top', SENTENCE_TOP);
  const sample = intArg(ctx, 'sample', 0);
  const mode = fillModeOf(ctx);
  const options = runOptionsOf(ctx, 'sentences');
  const files = lexiconFiles(ctx.paths.build, lexiconDir(ctx));
  for (const p of [files.lemmas, files.forms, ...(files.ranks ? [files.ranks] : [])])
    if (!existsSync(p))
      throw new Error(
        `sentences: ${p} does not exist. Run morph and freq first, or pass --lexicon.`,
      );
  for (const f of Object.values(TATOEBA_FILES)) {
    const p = join(ctx.paths.raw, TATOEBA_SOURCE, f);
    if (!existsSync(p))
      throw new Error(
        `sentences: ${p} does not exist. Run fetch --source tatoeba,ud-slovak-snk first.`,
      );
  }

  // 1. Harvest.
  const words = { minWords: MIN_WORDS, maxWords: MAX_WORDS };
  const { tatoeba, ud } = await harvest(ctx.paths.raw, words);
  const gpath = generatedPath(ctx);
  const generated = await readGenerated(gpath);
  const wordSet = new Set<string>();
  for (const s of [...tatoeba, ...ud, ...generated])
    for (const t of tokenize(s.textSk))
      if (t.t === 'word') wordSet.add(s.textSk.slice(t.s, t.e).toLowerCase());
  const lex = await loadLexicon(files, top, wordSet);
  ctx.log(
    `sentences: ${tatoeba.length} Tatoeba and ${ud.length} treebank sentences of ${MIN_WORDS} to ${MAX_WORDS} words; ${lex.ranked().length} lemmas ranked up to ${top}`,
  );

  // 2. Tokens, rules, targets.
  const rejected = new Map<Rejection, number>();
  const kept = new Map<string, Kept>();
  const harvested = new Map<string, HarvestedSentence>();
  let noTarget = 0;
  // Sentences a reader found wrong (content/authored/sentences/excluded.yaml) are left out.
  const excluded = await readExcluded(excludedPath(ctx.paths));
  const excludedSeen = new Set<string>();
  for (const s of [...tatoeba, ...ud]) {
    harvested.set(s.id, s);
    if (excluded.has(s.textSk.normalize('NFC'))) {
      excludedSeen.add(s.textSk.normalize('NFC'));
      continue;
    }
    const a = analyse(s.textSk, lex, s.ud);
    const problem = sentenceProblem(a, lex);
    if (problem) {
      count(rejected, problem);
      continue;
    }
    const targets = targetsOf(a, lex, rejected);
    if (targets.length === 0) {
      noTarget++;
      continue;
    }
    kept.set(s.id, {
      id: s.id,
      source: s.source,
      sourceRef: s.sourceRef,
      license: s.license,
      analysis: a,
      targets,
      difficulty: difficulty(a, lex),
      ...(s.textEn ? { textEn: s.textEn } : {}),
    });
  }
  const translations = new Map<string, GeneratedTranslation>();
  for (const g of generated)
    if (g.kind === 'translation' && harvested.get(g.id)?.textSk === g.textSk)
      translations.set(g.id, g);

  const candidatesOf = (k: Kept): Candidate[] =>
    k.targets.map((target) => ({
      sentenceId: k.id,
      source: k.source,
      target,
      difficulty: k.difficulty,
    }));
  const realCandidates = (untranslated: boolean): Candidate[] =>
    [...kept.values()]
      .filter((k) => k.source !== 'ud' || translations.has(k.id) || untranslated)
      .flatMap(candidatesOf);

  const fills: FillReport[] = [];
  // --max-spend (default $5) bounds the whole run: each route may spend what the routes
  // before it left. The review is estimated only once the sentences exist, so a live run
  // can stop there; its generated rows are cached and the next run starts from them.
  const budgeted = (o: RunOptions): RunOptions => ({
    ...o,
    maxSpendUsd: Math.max(
      0,
      (o.maxSpendUsd ?? DEFAULT_MAX_SPEND_USD) - fills.reduce((a, f) => a + f.estimate.usd, 0),
    ),
  });
  const newRows: GeneratedRow[] = [];

  // 3–4. Choose among real sentences, then translate the chosen treebank ones.
  let chosen = choose(realCandidates(options !== null));
  const toTranslate = [
    ...new Set(
      [...chosen.values()]
        .flat()
        .filter((c) => c.source === 'ud' && !translations.has(c.sentenceId))
        .map((c) => c.sentenceId),
    ),
  ].sort();
  if (options && toTranslate.length > 0) {
    const jobs: BatchJob<TranslateRequest>[] = groups(toTranslate, TRANSLATE_GROUP_SIZE).map(
      (ids, g) => ({
        id: `t${g}`,
        input: {
          items: ids.map((id, n) => ({ n, sk: (harvested.get(id) as HarvestedSentence).textSk })),
        },
      }),
    );
    const outcome = await runBatch(translateTask, jobs, budgeted(options));
    fills.push(fillReport(outcome as BatchOutcome<unknown, unknown>, toTranslate.length));
    const byJob = new Map(jobs.map((j, g) => [j.id, groups(toTranslate, TRANSLATE_GROUP_SIZE)[g]]));
    for (const r of outcome.results) {
      const ids = byJob.get(r.id) ?? [];
      for (const item of r.output.items) {
        const id = ids[item.n];
        const s = id ? harvested.get(id) : undefined;
        if (!id || !s) continue;
        const row: GeneratedTranslation = {
          kind: 'translation',
          id,
          sourceRef: s.sourceRef,
          textSk: s.textSk,
          textEn: item.en.trim(),
          route: translateTask.route,
          promptVersion: translateTask.promptVersion,
          model: r.model,
          requestHash: r.hash,
        };
        translations.set(id, row);
        newRows.push(row);
      }
    }
  }
  // A dry run counts the chosen treebank sentences as if translated.
  chosen = choose(realCandidates(mode === 'dry-run'));

  // 5. Generated sentences: those made before, then a fill for lemmas still short.
  const genKept = new Map<string, Kept>();
  const genCandidates: Candidate[] = [];
  const genRejected = new Map<Rejection | 'review', number>();
  const addGenerated = (g: GeneratedSentence): Rejection | null => {
    const l = lex.lemmas.get(g.lemmaId);
    if (!l || l.key !== g.key) return 'unknown';
    const a = analyse(g.textSk, lex);
    const t = checkGenerated(a, lex, g);
    if (typeof t === 'string') return t;
    let k = genKept.get(g.id);
    if (!k) {
      k = {
        id: g.id,
        source: 'generated',
        sourceRef: `${g.route}:${g.requestHash.slice(0, 16)}`,
        license: GENERATED_LICENSE,
        analysis: a,
        targets: [],
        difficulty: difficulty(a, lex),
        textEn: g.textEn,
      };
      genKept.set(g.id, k);
    }
    k.targets.push(t);
    genCandidates.push({
      sentenceId: g.id,
      source: 'generated',
      target: t,
      difficulty: k.difficulty,
    });
    return null;
  };
  let staleGenerated = 0;
  for (const g of generated) if (g.kind === 'sentence' && addGenerated(g)) staleGenerated++;

  const ranked = lex.ranked();
  const have = choose([...chosen.values()].flat().concat(genCandidates));
  let gaps = ranked.filter((l) => (have.get(l.id)?.length ?? 0) < MIN_PER_LEMMA);
  if (sample > 0) gaps = gaps.slice(0, sample);

  if (options && gaps.length > 0) {
    const glosses = new Map<number, string[]>();
    if (existsSync(sensesPath(ctx)))
      for await (const s of readJsonl<{ lemmaId: number; ord: number; glossEn: string }>(
        sensesPath(ctx),
      )) {
        const list = glosses.get(s.lemmaId) ?? [];
        if (list.length < 2) list.push(s.glossEn);
        glosses.set(s.lemmaId, list);
      }
    // One item per sentence wanted, forms not yet shown first.
    const items: (Omit<SentenceItem, 'n'> & { lemmaId: number })[] = [];
    for (const l of gaps) {
      const shown = new Set(
        (have.get(l.id) ?? []).map((c) => `${c.target.form.toLowerCase()}|${c.target.tag}`),
      );
      const forms =
        l.topForms.length > 0
          ? l.topForms
          : (lex
              .readings(l.lemma, true)
              .filter((r) => r.lemmaId === l.id)
              .slice(0, 1) as {
              form: string;
              tag: string;
            }[]);
      if (forms.length === 0) continue;
      const fresh = forms.filter((f) => !shown.has(`${f.form.toLowerCase()}|${f.tag}`));
      const order = [...fresh, ...forms];
      const want = MAX_PER_LEMMA - (have.get(l.id)?.length ?? 0);
      for (let i = 0; i < want; i++) {
        const f = order[i % order.length] as { form: string; tag: string };
        const meaning = glosses.get(l.id);
        items.push({
          lemmaId: l.id,
          lemma: l.lemma,
          pos: l.pos,
          ...(l.gender ? { gender: l.gender } : {}),
          form: f.form,
          tag: f.tag,
          formIs: describeTag(f.tag),
          ...(meaning && meaning.length > 0 ? { meaning } : {}),
        });
      }
    }
    const vocabulary = [...new Set(ranked.map((l) => l.lemma))];
    const task = sentencesTask(vocabulary);
    const itemGroups = groups(items, SENTENCE_GROUP_SIZE);
    const jobs: BatchJob<SentenceRequest>[] = itemGroups.map((g, i) => ({
      id: `s${i}`,
      input: { items: g.map(({ lemmaId: _id, ...it }, n) => ({ ...it, n })) },
    }));
    type Passed = {
      item: (typeof items)[number];
      sk: string;
      en: string;
      hash: string;
      model: string;
    };
    // Before anything is generated the review has no sentences: it is estimated with one
    // stand-in per item (a dry run reports that; a live run checks it fits the budget).
    const standIns: Passed[] = items.map((item) => ({
      item,
      sk: `${item.form} ${'slovo '.repeat(6).trim()}.`,
      en: 'An English sentence of about eight words here.',
      hash: '',
      model: '',
    }));
    if (options.mode === 'live') {
      const dry = { ...options, mode: 'dry-run' as const, log: () => undefined };
      const gen = await runBatch(task, jobs, dry);
      const rev = await runBatch(
        reviewTask,
        reviewJobsOf(groups(standIns, REVIEW_GROUP_SIZE)),
        dry,
      );
      const budget = budgeted(options).maxSpendUsd ?? DEFAULT_MAX_SPEND_USD;
      const usd = gen.estimate.usd + rev.estimate.usd;
      if (usd > budget)
        throw new SpendLimitError(
          {
            ...gen.estimate,
            requests: gen.estimate.requests + rev.estimate.requests,
            inputTokens: gen.estimate.inputTokens + rev.estimate.inputTokens,
            outputTokens: gen.estimate.outputTokens + rev.estimate.outputTokens,
            usd,
            worstUsd: gen.estimate.worstUsd + rev.estimate.worstUsd,
          },
          budget,
        );
    }
    const outcome = await runBatch(task, jobs, budgeted(options));
    fills.push(fillReport(outcome as BatchOutcome<unknown, unknown>, items.length));

    // The rules, then the review.
    const passed: Passed[] = [];
    for (const r of outcome.results) {
      const g = itemGroups[Number(r.id.slice(1))] ?? [];
      for (const ans of r.output.items) {
        const item = g[ans.n];
        if (!item) continue;
        const sk = ans.sk.trim();
        const a = analyse(sk, lex);
        const t = checkGenerated(a, lex, item);
        if (typeof t === 'string') {
          count(genRejected, t);
          continue;
        }
        passed.push({ item, sk, en: ans.en.trim(), hash: r.hash, model: r.model });
      }
    }
    const toReview = mode === 'dry-run' ? standIns : passed;
    const reviewGroups = groups(toReview, REVIEW_GROUP_SIZE);
    const reviewJobs = reviewJobsOf(reviewGroups);
    if (reviewJobs.length > 0) {
      const review = await runBatch(reviewTask, reviewJobs, budgeted(options));
      fills.push(fillReport(review as BatchOutcome<unknown, unknown>, toReview.length));
      for (const r of review.results) {
        const g = reviewGroups[Number(r.id.slice(1))] ?? [];
        for (const ans of r.output.items) {
          const p = g[ans.n];
          if (!p) continue;
          if (!ans.natural || !ans.formCorrect) {
            count(genRejected, 'review');
            continue;
          }
          const l = lex.lemmas.get(p.item.lemmaId);
          if (!l) continue;
          const row: GeneratedSentence = {
            kind: 'sentence',
            id: genId(p.sk),
            lemmaId: l.id,
            key: l.key,
            form: p.item.form,
            tag: p.item.tag,
            textSk: p.sk,
            textEn: ans.en.trim(),
            route: task.route,
            promptVersion: task.promptVersion,
            model: p.model,
            requestHash: p.hash,
            review: {
              route: reviewTask.route,
              promptVersion: reviewTask.promptVersion,
              requestHash: r.hash,
            },
          };
          if (
            generated.some((x) => x.kind === 'sentence' && x.id === row.id && x.lemmaId === l.id) ||
            newRows.some((x) => x.kind === 'sentence' && x.id === row.id && x.lemmaId === l.id)
          )
            continue;
          if (addGenerated(row) === null) newRows.push(row);
        }
      }
    }
  } else if (gaps.length > 0) {
    ctx.log(
      `sentences: ${gaps.length} lemmas have fewer than ${MIN_PER_LEMMA} sentences; --fill dry-run estimates the model fill`,
    );
  }

  if (newRows.length > 0 && mode !== 'dry-run') {
    const all = [...generated, ...newRows].sort(
      (a, b) =>
        (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) ||
        (a.kind === 'sentence' && b.kind === 'sentence' ? a.lemmaId - b.lemmaId : 0),
    );
    const w = await JsonlWriter.open(gpath);
    for (const row of all) await w.write(row);
    await w.close();
    ctx.log(`sentences: ${newRows.length} model rows added to ${gpath}`);
  }

  // 6. The final choice and the rows.
  const finalChosen = choose([...realCandidates(false), ...genCandidates]);
  // A token shows one lemma: when homographs (*hlavne* adverb and particle) chose the same
  // word of one sentence, the better ranked lemma keeps it.
  const bySentence = new Map<string, { lemmaId: number; target: Target; ord: number }[]>();
  const rankOrder = [...finalChosen.keys()].sort(
    (a, b) => (lex.rankOf(a) ?? Infinity) - (lex.rankOf(b) ?? Infinity) || a - b,
  );
  for (const lemmaId of rankOrder) {
    let ord = 0;
    for (const c of finalChosen.get(lemmaId) ?? []) {
      const links = bySentence.get(c.sentenceId) ?? [];
      if (links.some((l) => l.target.tokenIndex === c.target.tokenIndex)) continue;
      links.push({ lemmaId, target: c.target, ord: ord++ });
      bySentence.set(c.sentenceId, links);
    }
  }
  const w = await JsonlWriter.open(out(ctx, 'sentences.jsonl'));
  const perSource: Record<string, number> = { tatoeba: 0, ud: 0, generated: 0 };
  const shown = new Map<number, number>();
  for (const id of [...bySentence.keys()].sort()) {
    const k = (kept.get(id) ?? genKept.get(id)) as Kept;
    const links = (bySentence.get(id) ?? []).sort(
      (a, b) => a.target.tokenIndex - b.target.tokenIndex || a.lemmaId - b.lemmaId,
    );
    const textEn = k.source === 'ud' ? translations.get(id)?.textEn : k.textEn;
    if (!textEn) continue;
    const row: SentenceRow = {
      id,
      textSk: k.analysis.text,
      textEn,
      tokens: rowTokens(
        k.analysis,
        links.map((l) => l.target),
      ),
      difficulty: k.difficulty,
      source: k.source,
      sourceRef: k.sourceRef,
      license: k.license,
      verified: false,
      links: links.map((l) => ({
        lemmaId: l.lemmaId,
        tokenIndex: l.target.tokenIndex,
        form: l.target.form,
        tag: l.target.tag,
        ord: l.ord,
      })),
    };
    perSource[k.source] = (perSource[k.source] ?? 0) + 1;
    for (const l of links) count(shown, l.lemmaId);
    await w.write(row);
  }
  await w.close();

  // Report.
  const bands = [1000, top].filter((b, i, xs) => xs.indexOf(b) === i && b <= top);
  const coverage = bands.map((band) => {
    const inBand = ranked.filter((l) => (l.freqRank as number) <= band);
    const n = (l: { id: number }) => shown.get(l.id) ?? 0;
    return {
      band,
      lemmas: inBand.length,
      enough: inBand.filter((l) => n(l) >= MIN_PER_LEMMA).length,
      one: inBand.filter((l) => n(l) === 1).length,
      none: inBand.filter((l) => n(l) === 0).length,
    };
  });
  const short = ranked
    .filter((l) => (shown.get(l.id) ?? 0) < MIN_PER_LEMMA)
    .slice(0, 50)
    .map((l) => `${l.freqRank} ${l.lemma} (${l.pos}): ${shown.get(l.id) ?? 0}`);
  const estimate =
    fills.length > 0
      ? {
          requests: fills.reduce((a, f) => a + f.estimate.requests, 0),
          usd: fills.reduce((a, f) => a + f.estimate.usd, 0),
          worstUsd: fills.reduce((a, f) => a + f.estimate.worstUsd, 0),
        }
      : null;
  const summary = {
    harvested: { tatoeba: tatoeba.length, ud: ud.length },
    rejected: Object.fromEntries(REJECTIONS.map((r) => [r, rejected.get(r) ?? 0])),
    withoutTarget: noTarget,
    excluded: excludedSeen.size,
    kept: {
      tatoeba: [...kept.values()].filter((k) => k.source === 'tatoeba').length,
      ud: [...kept.values()].filter((k) => k.source === 'ud').length,
    },
    translations: translations.size,
    generated: genKept.size,
    staleGenerated,
    generatedRejected: Object.fromEntries(genRejected),
    rows: w.count,
    perSource,
    coverage,
    fill: { mode, gaps: gaps.length, untranslated: toTranslate.length, routes: fills, estimate },
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson({ ...summary, short }));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary, short));
  for (const c of coverage)
    ctx.log(
      `sentences: top ${c.band}: ${c.enough} lemmas with ${MIN_PER_LEMMA}+ sentences, ${c.one} with one, ${c.none} with none`,
    );
  if (estimate)
    ctx.log(
      `sentences: fill ${mode}: ${estimate.requests} requests to send in all, ${formatUsd(estimate.usd)} at batch prices (at most ${formatUsd(estimate.worstUsd)})`,
    );
  return summary;
}

function renderReport(
  s: {
    harvested: { tatoeba: number; ud: number };
    rejected: Record<string, number>;
    withoutTarget: number;
    excluded: number;
    kept: { tatoeba: number; ud: number };
    translations: number;
    generated: number;
    staleGenerated: number;
    generatedRejected: Record<string, number>;
    rows: number;
    perSource: Record<string, number>;
    coverage: { band: number; lemmas: number; enough: number; one: number; none: number }[];
    fill: {
      mode: string;
      gaps: number;
      untranslated: number;
      routes: FillReport[];
      estimate: { requests: number; usd: number; worstUsd: number } | null;
    };
  },
  short: string[],
): string {
  const lines = [
    '# Sentences report',
    '',
    `Harvested (${MIN_WORDS} to ${MAX_WORDS} words, no digits): ${s.harvested.tatoeba.toLocaleString('en')} Tatoeba sentences with an English translation, ${s.harvested.ud.toLocaleString('en')} treebank sentences.`,
    '',
    '| Rejected because | Sentences |',
    '|---|---:|',
    ...Object.entries(s.rejected).map(([r, n]) => `| ${r} | ${n.toLocaleString('en')} |`),
    `| no word can be a target | ${s.withoutTarget.toLocaleString('en')} |`,
    `| listed in content/authored/sentences/excluded.yaml | ${s.excluded.toLocaleString('en')} |`,
    '',
    '(`ambiguous` and `not-top-form` count words, not sentences.)',
    '',
    `Kept: ${s.kept.tatoeba} Tatoeba, ${s.kept.ud} treebank (${s.translations} with a model translation). Generated sentences that pass the rules: ${s.generated}${s.staleGenerated > 0 ? `; ${s.staleGenerated} generated rows no longer pass and are left out` : ''}.`,
    '',
    `Rows written: ${s.rows} (${Object.entries(s.perSource)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}).`,
    '',
    `| Top | Lemmas | ${MIN_PER_LEMMA}+ sentences | One | None |`,
    '|---:|---:|---:|---:|---:|',
    ...s.coverage.map(
      (c) =>
        `| ${c.band.toLocaleString('en')} | ${c.lemmas} | ${c.enough} (${((c.enough / Math.max(1, c.lemmas)) * 100).toFixed(1)} %) | ${c.one} | ${c.none} |`,
    ),
    '',
    '## Model fill',
    '',
    `Mode \`${s.fill.mode}\`: ${s.fill.gaps} lemmas short of ${MIN_PER_LEMMA} sentences, ${s.fill.untranslated} chosen treebank sentences without a translation.`,
  ];
  if (Object.keys(s.generatedRejected).length > 0)
    lines.push(
      '',
      `Generated sentences rejected: ${Object.entries(s.generatedRejected)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}.`,
    );
  if (s.fill.routes.length > 0)
    lines.push(
      '',
      '| Route | Items | Requests | Cached | To send | Input tokens | Output tokens | Estimate | At most |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...s.fill.routes.map(
        (f) =>
          `| ${f.route} | ${f.jobs} | ${f.requests} | ${f.cached} | ${f.estimate.requests} | ${f.estimate.inputTokens.toLocaleString('en')} | ${f.estimate.outputTokens.toLocaleString('en')} | ${formatUsd(f.estimate.usd)} | ${formatUsd(f.estimate.worstUsd)} |`,
      ),
    );
  if (s.fill.estimate)
    lines.push(
      '',
      `In all: ${s.fill.estimate.requests} requests, ${formatUsd(s.fill.estimate.usd)} at batch prices (at most ${formatUsd(s.fill.estimate.worstUsd)}).${s.fill.mode === 'dry-run' ? ' The review is estimated with one stand-in sentence per item.' : ''}`,
    );
  if (short.length > 0)
    lines.push(
      '',
      `## First lemmas with fewer than ${MIN_PER_LEMMA} sentences`,
      '',
      short.map((m) => `- ${m}`).join('\n'),
    );
  return `${lines.join('\n')}\n`;
}

// --- Checks -----------------------------------------------------------------------------------

/** In a complete build, more than this share of the top lemmas short of sentences fails. */
export const MAX_SHORT_SHARE = 0.02;

/**
 * Rows keep the rules: links point at their token with its lemma and tag. Unverified rows
 * (all the pipeline writes) also keep the rules of the stage: a source id beside the
 * source and licence the schema requires, 4 to 12 words, every lemma within the top 3,000,
 * the linked form one of the lemma's most used forms. Rows marked verified were checked by
 * a person (the mini dataset's hand-written ones) and are exempt from those.
 */
export const sentenceRulesCheck: Check = {
  id: 'sentences.rules',
  description: `Sentence links match their tokens; unverified rows have a source id, ${MIN_WORDS} to ${MAX_WORDS} words, lemmas within the top ${SENTENCE_TOP} and linked forms among the top forms`,
  async run(ctx) {
    if (!ctx.has('sentences.jsonl')) return;
    const lemmas = new Map<
      number,
      { freqRank?: number; topForms: { form: string; tag: string }[] }
    >();
    for await (const { row } of ctx.rows('lemmas.jsonl')) lemmas.set(row.id, row);
    for await (const { n, row } of ctx.rows('sentences.jsonl')) {
      const w = `sentences.jsonl:${n} (${row.id})`;
      for (const l of row.links) {
        const tok = row.tokens[l.tokenIndex];
        if (!tok) continue; // links reports it
        if (tok.lemmaId !== l.lemmaId || (tok.tag ?? '') !== l.tag)
          ctx.issue(
            `${w}: link to lemma ${l.lemmaId} (${l.tag}) does not match token ${l.tokenIndex}`,
          );
      }
      if (row.verified) continue;
      if (!row.sourceRef) ctx.issue(`${w}: no source id (sourceRef)`);
      const words = tokenize(row.textSk).filter((t) => t.t === 'word').length;
      if (words < MIN_WORDS || words > MAX_WORDS) ctx.issue(`${w}: ${words} words`);
      for (const t of row.tokens) {
        if (t.lemmaId === undefined) continue;
        const r = lemmas.get(t.lemmaId)?.freqRank;
        if (r === undefined || r > SENTENCE_TOP)
          ctx.issue(
            `${w}: "${row.textSk.slice(t.s, t.e)}" is lemma ${t.lemmaId}, ranked ${r ?? 'not at all'}`,
          );
      }
      for (const l of row.links) {
        const top = lemmas.get(l.lemmaId)?.topForms ?? [];
        if (
          top.length > 0 &&
          !top.some((f) => f.tag === l.tag && f.form.toLowerCase() === l.form.toLowerCase())
        )
          ctx.issue(`${w}: "${l.form}" (${l.tag}) is not a top form of lemma ${l.lemmaId}`);
      }
    }
  },
};

/**
 * Every lemma ranked within the top 3,000 has at least two sentences. In a complete build
 * more than 2 % of them short fails the set; fewer, or any number in a partial set, warns.
 */
export const sentenceCoverageCheck: Check = {
  id: 'sentences.coverage',
  description: `Lemmas ranked up to ${SENTENCE_TOP} have at least ${MIN_PER_LEMMA} sentences (a complete build fails above ${MAX_SHORT_SHARE * 100} % short)`,
  async run(ctx) {
    const per = new Map<number, Set<string>>();
    for await (const { row } of ctx.rows('sentences.jsonl'))
      for (const l of row.links) {
        const s = per.get(l.lemmaId) ?? new Set<string>();
        s.add(row.id);
        per.set(l.lemmaId, s);
      }
    let ranked = 0;
    const short: string[] = [];
    for await (const { row } of ctx.rows('lemmas.jsonl')) {
      if (row.freqRank === undefined || row.freqRank > SENTENCE_TOP) continue;
      ranked++;
      const n = per.get(row.id)?.size ?? 0;
      if (n < MIN_PER_LEMMA) short.push(`${row.lemma} (${row.freqRank}): ${n}`);
    }
    if (short.length === 0) return;
    const msg = `${short.length} of ${ranked} lemmas ranked up to ${SENTENCE_TOP} have fewer than ${MIN_PER_LEMMA} sentences, e.g. ${short.slice(0, 10).join(', ')}`;
    if (ctx.complete && short.length > ranked * MAX_SHORT_SHARE)
      ctx.issue(`${msg}; run sentences --fill (dry-run first)`);
    else ctx.warn(msg);
  },
};

export const sentencesStage: Stage = {
  name: 'sentences',
  description: 'Example sentences from Tatoeba and the UD treebank, plus a checked model fill',
  sources: [
    ...Object.values(TATOEBA_FILES).map((f) => `${TATOEBA_SOURCE}/${f}`),
    ...UD_SPLITS.map((s) => `${UD_SOURCE}/${udFile(s)}`),
  ],
  codeDir: codeDirOf(import.meta.url),
  options: {
    ...FILL_OPTIONS,
    lexicon: { type: 'string' },
    generated: { type: 'string' },
    top: { type: 'string' },
    sample: { type: 'string' },
  },
  // The generated file is an input that a fill also writes; the runner fingerprints it after
  // the run, so a run that added rows is skipped next time.
  inputs: (ctx) => {
    const f = lexiconFiles(ctx.paths.build, lexiconDir(ctx));
    return [
      ...rawFiles(ctx),
      f.lemmas,
      f.forms,
      ...(f.ranks ? [f.ranks] : []),
      ...(f.triggers ? [f.triggers] : []),
      sensesPath(ctx),
      generatedPath(ctx),
      ...(existsSync(excludedPath(ctx.paths)) ? [excludedPath(ctx.paths)] : []),
    ];
  },
  outputs: (ctx) => ['sentences.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  params: (ctx) => ({
    fill: fillModeOf(ctx),
    lexicon: lexiconDir(ctx) ?? null,
    top: ctx.args.top ?? null,
    sample: ctx.args.sample ?? null,
    maxSpend: ctx.args['max-spend'] ?? null,
    at: fillAlwaysRuns(ctx) ? ctx.now().toISOString() : null,
  }),
  run: runSentences,
  parts: [{ file: 'sentences.jsonl', path: (p) => join(p.build, 'sentences', 'sentences.jsonl') }],
  checks: [sentenceRulesCheck, sentenceCoverageCheck],
};
