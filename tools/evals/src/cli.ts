// The eval command line: pnpm --filter @app/evals run evals <command> [options]
//
//   build      datasets from the treebank and the morphology build → tools/evals/data
//   run        one run: --mode mock | dry-run | replay | live (live needs the key and a spend cap)
//   estimate   request count and cost of the full live eval, the cheaper model comparison included
//   compare    a side by side of two report.json files
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createGateway } from '@app/ai';
import { AI_ROUTES, type AiRoute } from '@app/contracts';
import { MINI_DIR } from '@app/testkit/mini';
import { buildDatasets, readDatasets, readTreebank, writeDatasets } from './datasets/build';
import { Lexicon, sourceFromBuild, sourceFromContentDir } from './lexicon';
import { type EvalReport, type RunMode, renderComparison, renderMarkdown } from './report';
import { runEval, type Suite, writeRun } from './run';

export const ROOT = resolve(new URL('../../../', import.meta.url).pathname);
export const PATHS = {
  data: join(ROOT, 'tools/evals/data'),
  cache: join(ROOT, 'tools/evals/cache'),
  reports: join(ROOT, 'tools/evals/reports'),
  scratch: join(ROOT, 'content/build/evals'),
  treebank: join(ROOT, 'content/raw/ud-slovak-snk'),
  build: join(ROOT, 'content/build'),
};

/** The model the cheaper comparison tries on `tutor.reply` and `reader.disambiguate`. */
export const CHEAPER_MODEL = 'claude-sonnet-5-5';
export const COMPARISON_ROUTES: AiRoute[] = ['tutor.reply', 'reader.disambiguate'];
export const DEFAULT_MAX_SPEND_USD = 5;

function parseModels(values: readonly string[] | undefined): Partial<Record<AiRoute, string>> {
  const out: Partial<Record<AiRoute, string>> = {};
  for (const v of values ?? []) {
    const [route, model] = v.split('=');
    if (!route || !model || !(AI_ROUTES as readonly string[]).includes(route))
      throw new Error(`--model takes <route>=<model>, e.g. tutor.reply=${CHEAPER_MODEL}`);
    out[route as AiRoute] = model;
  }
  return out;
}

function lexiconOf(kind: string): Lexicon {
  if (kind === 'mini') return new Lexicon(sourceFromContentDir(MINI_DIR));
  return new Lexicon(sourceFromBuild(PATHS.build));
}

const RUN_OPTIONS = {
  mode: { type: 'string', default: 'mock' },
  suite: { type: 'string', default: 'all' },
  limit: { type: 'string' },
  model: { type: 'string', multiple: true },
  'max-spend': { type: 'string' },
  cache: { type: 'string' },
  out: { type: 'string' },
  data: { type: 'string' },
  lexicon: { type: 'string', default: 'build' },
  'no-replies': { type: 'boolean', default: false },
  concurrency: { type: 'string', default: '4' },
  'per-text': { type: 'string', default: '10' },
} as const;

type RunArgs = {
  mode?: string;
  suite?: string;
  limit?: string;
  model?: string[];
  'max-spend'?: string;
  cache?: string;
  out?: string;
  data?: string;
  lexicon?: string;
  'no-replies'?: boolean;
  concurrency?: string;
  'per-text'?: string;
};

function suitesOf(s: string | undefined): Suite[] {
  if (!s || s === 'all') return ['tutor', 'analyzer'];
  if (s === 'tutor' || s === 'analyzer') return [s];
  throw new Error('--suite is all, tutor or analyzer');
}

async function commandRun(args: RunArgs, log: (s: string) => void): Promise<EvalReport> {
  const mode = (args.mode ?? 'mock') as RunMode;
  if (!['mock', 'dry-run', 'replay', 'live'].includes(mode))
    throw new Error('--mode is mock, dry-run, replay or live');
  const datasets = readDatasets(args.data ?? PATHS.data);
  const lexicon = lexiconOf(args.lexicon ?? 'build');
  const models = parseModels(args.model);
  const base = {
    datasets,
    lexicon,
    suites: suitesOf(args.suite),
    limit: args.limit ? Number(args.limit) : undefined,
    models,
    replies: !args['no-replies'],
    concurrency: Number(args.concurrency ?? 4),
    perText: Number(args['per-text'] ?? 10),
  };
  // Mock answers never enter the real cache, and each mock run starts from an empty one.
  const cacheDir =
    args.cache ?? (mode === 'mock' ? mkdtempSync(join(tmpdir(), 'evals-mock-')) : PATHS.cache);
  let live: ReturnType<typeof createGateway> | undefined;
  if (mode === 'live') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('live mode needs ANTHROPIC_API_KEY in the environment.');
    const cap = Number(args['max-spend'] ?? DEFAULT_MAX_SPEND_USD);
    if (!(cap > 0)) throw new Error('--max-spend must be a positive number of US dollars.');
    const plan = await runEval({ ...base, mode: 'dry-run', cacheDir });
    const estimate = plan.report.costs.reduce((n, c) => n + c.sentCostUsd, 0);
    log(
      `estimate before the live run: ${plan.report.totals.calls - plan.report.totals.cached} requests to send, about $${estimate.toFixed(2)}`,
    );
    if (estimate > cap)
      throw new Error(
        `The estimate ($${estimate.toFixed(2)}) is above the spend cap ($${cap.toFixed(2)}). Raise it with --max-spend <usd> once the spend is approved.`,
      );
    let spent = 0;
    live = createGateway({
      mode: 'anthropic',
      apiKey,
      dailyBudgetUsd: cap,
      models,
      // The gateway's budget check is the run's spend cap: no call starts once it is used up.
      spendToday: async () => ({ spentUsd: spent, resetsAt: '2100-01-01T00:00:00Z' }),
      recordUsage: async (row) => {
        spent += row.costUsd;
      },
    });
  }
  const result = await runEval({ ...base, mode, cacheDir, live });
  const out =
    args.out ??
    (mode === 'live' || mode === 'replay'
      ? join(PATHS.reports, 'latest')
      : join(PATHS.scratch, mode));
  writeRun(out, result);
  log(renderMarkdown(result.report));
  log(`report written to ${out}`);
  return result.report;
}

export interface FullEstimate {
  base: EvalReport;
  comparison: EvalReport;
  /** Requests the comparison adds: only the routes whose model changes. */
  comparisonRequests: number;
  comparisonUsd: number;
  requests: number;
  usd: number;
  worstUsd: number;
}

/** The estimate of the full live eval: the base run, then the cheaper model on two routes. */
export async function estimateFull(args: RunArgs): Promise<FullEstimate> {
  const datasets = readDatasets(args.data ?? PATHS.data);
  const lexicon = lexiconOf(args.lexicon ?? 'build');
  const common = {
    mode: 'dry-run' as const,
    datasets,
    lexicon,
    suites: suitesOf(args.suite),
    limit: args.limit ? Number(args.limit) : undefined,
    cacheDir: args.cache ?? PATHS.cache,
    replies: !args['no-replies'],
    concurrency: Number(args.concurrency ?? 4),
    perText: Number(args['per-text'] ?? 10),
  };
  const base = (await runEval(common)).report;
  const models = Object.fromEntries(COMPARISON_ROUTES.map((r) => [r, CHEAPER_MODEL]));
  const comparison = (await runEval({ ...common, models })).report;
  const changed = comparison.costs.filter((c) => c.model === CHEAPER_MODEL);
  const sent = (r: EvalReport['costs']) => r.reduce((n, c) => n + c.calls - c.cached, 0);
  const comparisonUsd = changed.reduce((n, c) => n + c.sentCostUsd, 0);
  return {
    base,
    comparison,
    comparisonRequests: sent(changed),
    comparisonUsd,
    requests: sent(base.costs) + sent(changed),
    usd: base.costs.reduce((n, c) => n + c.sentCostUsd, 0) + comparisonUsd,
    worstUsd: base.totals.worstUsd + changed.reduce((n, c) => n + c.worstUsd, 0),
  };
}

export function renderEstimate(e: FullEstimate): string {
  const rows = [
    ...e.base.costs.map((c) => [c.route, c.model, c.calls - c.cached, c.sentCostUsd, c.worstUsd]),
    ...e.comparison.costs
      .filter((c) => c.model === CHEAPER_MODEL)
      .map((c) => [c.route, c.model, c.calls - c.cached, c.sentCostUsd, c.worstUsd]),
  ];
  return [
    '| Route | Model | Requests to send | Estimate | At most |',
    '|---|---|---|---|---|',
    ...rows.map(
      ([r, m, n, u, w]) =>
        `| \`${r}\` | ${m} | ${n} | $${Number(u).toFixed(2)} | $${Number(w).toFixed(2)} |`,
    ),
    `| **Total** | | **${e.requests}** | **$${e.usd.toFixed(2)}** | $${e.worstUsd.toFixed(2)} |`,
  ].join('\n');
}

export async function main(argv: string[], log: (s: string) => void = console.log): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'build': {
      const { values } = parseArgs({
        args: rest,
        options: {
          treebank: { type: 'string' },
          out: { type: 'string' },
          seed: { type: 'string' },
          lexicon: { type: 'string', default: 'build' },
        },
      });
      const lexicon = lexiconOf(values.lexicon ?? 'build');
      const sentences = readTreebank(values.treebank ?? PATHS.treebank);
      const d = buildDatasets(sentences, lexicon, {
        ...(values.seed ? { seed: Number(values.seed) } : {}),
        sources: ['UD Slovak SNK (CC BY-SA 4.0)', 'SNK morphological database'],
      });
      writeDatasets(values.out ?? PATHS.data, d);
      log(
        `datasets: ${d.correct.length} correct, ${d.injected.length} injected (${d.manifest.injectionSkipped} sentences could take no error), ${d.analyzer.length} analyzer sentences → ${values.out ?? PATHS.data}`,
      );
      return;
    }
    case 'run': {
      const { values } = parseArgs({ args: rest, options: RUN_OPTIONS });
      await commandRun(values, log);
      return;
    }
    case 'estimate': {
      const { values } = parseArgs({ args: rest, options: RUN_OPTIONS });
      const e = await estimateFull(values);
      const text = [
        `Full live eval, nothing sent: ${e.requests} requests, about $${e.usd.toFixed(2)} (at most $${e.worstUsd.toFixed(2)}).`,
        '',
        renderEstimate(e),
      ].join('\n');
      if (values.out) {
        mkdirSync(dirname(resolve(values.out)), { recursive: true });
        writeFileSync(values.out, `${text}\n`);
      }
      log(text);
      return;
    }
    case 'compare': {
      const [a, b] = rest;
      if (!a || !b) throw new Error('compare <a/report.json> <b/report.json>');
      const ra = JSON.parse(readFileSync(a, 'utf8')) as EvalReport;
      const rb = JSON.parse(readFileSync(b, 'utf8')) as EvalReport;
      log(renderComparison(ra, rb));
      return;
    }
    default:
      log(
        [
          'pnpm --filter @app/evals run evals <command>',
          '  build                         datasets → tools/evals/data',
          '  run --mode mock|dry-run|replay|live [--suite all|tutor|analyzer] [--limit N]',
          '      [--model <route>=<model>] [--max-spend USD] [--no-replies] [--out DIR]',
          '  estimate                      cost of the full live eval with the comparison',
          '  compare <a.json> <b.json>     side by side of two runs',
        ].join('\n'),
      );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
