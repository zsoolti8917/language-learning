// One eval run: the chosen suites over the datasets, through the eval gateway, into a report.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AiGateway, promptVersions } from '@app/ai';
import type { AiRoute } from '@app/contracts';
import type { Datasets } from './datasets/build';
import { type CallRecord, createEvalGateway, type GatewayMode } from './gateway';
import type { Lexicon } from './lexicon';
import { analyzerMetrics, routeCosts, tutorMetrics } from './metrics';
import { createOracleGateway, type OracleOptions } from './oracle';
import { type EvalReport, type RunMode, renderMarkdown, targetsOf } from './report';
import { runAnalyzerEval, type ScoredWord } from './runners/analyzer';
import { runTutorEval, type TutorCaseResult } from './runners/tutor';

export type Suite = 'tutor' | 'analyzer';

/** The routes each suite calls. */
export const SUITE_ROUTES: Record<Suite, AiRoute[]> = {
  tutor: ['tutor.analyze', 'tutor.reply'],
  analyzer: ['reader.disambiguate'],
};

export interface RunOptions {
  mode: RunMode;
  datasets: Datasets;
  lexicon: Lexicon;
  suites: readonly Suite[];
  /** At most this many cases of each dataset (for a first small live run). */
  limit?: number | undefined;
  /** Model per route (the cheaper model comparison). */
  models?: Partial<Record<AiRoute, string>> | undefined;
  cacheDir: string;
  /** Run `tutor.reply` and its rule checks. */
  replies: boolean;
  concurrency: number;
  /** Sentences per analyzer text. */
  perText: number;
  /** The gateway behind the cache in live mode (the real one). Others use the oracle. */
  live?: AiGateway | undefined;
  oracle?: OracleOptions | undefined;
}

export interface RunResult {
  report: EvalReport;
  tutor: TutorCaseResult[];
  analyzer: ScoredWord[];
  log: readonly CallRecord[];
}

const GATEWAY_MODE: Record<RunMode, GatewayMode> = {
  mock: 'record',
  live: 'record',
  replay: 'replay',
  'dry-run': 'estimate',
};

export function limited(d: Datasets, limit: number | undefined): Datasets {
  if (limit === undefined) return d;
  return {
    ...d,
    correct: d.correct.slice(0, limit),
    injected: d.injected.slice(0, limit),
    analyzer: d.analyzer.slice(0, limit),
  };
}

export async function runEval(opts: RunOptions): Promise<RunResult> {
  const data = limited(opts.datasets, opts.limit);
  if (opts.mode === 'live' && !opts.live) throw new Error('live mode needs the real gateway');
  const inner =
    opts.mode === 'live' ? (opts.live as AiGateway) : createOracleGateway(data, opts.oracle ?? {});
  const gateway = createEvalGateway({
    mode: GATEWAY_MODE[opts.mode],
    inner,
    cacheDir: opts.cacheDir,
    models: opts.models,
  });

  let tutor: TutorCaseResult[] = [];
  let analyzer: ScoredWord[] = [];
  if (opts.suites.includes('tutor'))
    tutor = await runTutorEval(data, {
      gateway,
      morphology: opts.lexicon.morphology(),
      triggers: opts.lexicon.triggerInfos(),
      replies: opts.replies,
      concurrency: opts.concurrency,
    });
  if (opts.suites.includes('analyzer'))
    analyzer = await runAnalyzerEval(data.analyzer, {
      gateway,
      lexicon: opts.lexicon,
      perText: opts.perText,
      concurrency: opts.concurrency,
    });

  const tm = opts.suites.includes('tutor') ? tutorMetrics(tutor) : undefined;
  const am = opts.suites.includes('analyzer') ? analyzerMetrics(analyzer) : undefined;
  const costs = routeCosts(gateway.log);
  const routes = opts.suites.flatMap((s) => SUITE_ROUTES[s]);
  const versions = promptVersions();
  const report: EvalReport = {
    mode: opts.mode,
    mockModel: opts.mode === 'mock' || opts.mode === 'dry-run',
    datasets: {
      correct: data.correct.length,
      injected: data.injected.length,
      analyzer: data.analyzer.length,
      seed: data.manifest.seed,
      morphology: opts.lexicon.label,
    },
    promptVersions: Object.fromEntries(routes.map((r) => [r, versions[r]])),
    models: Object.fromEntries(routes.map((r) => [r, opts.models?.[r] ?? 'claude-opus-5-5'])),
    tutor: tm,
    analyzer: am,
    costs,
    totals: {
      calls: gateway.log.length,
      cached: gateway.log.filter((c) => c.cached).length,
      costUsd: Math.round(costs.reduce((n, c) => n + c.costUsd, 0) * 1e4) / 1e4,
      worstUsd: Math.round(costs.reduce((n, c) => n + c.worstUsd, 0) * 1e4) / 1e4,
    },
    targets: targetsOf(tm, am),
  };
  return { report, tutor, analyzer, log: gateway.log };
}

/** Writes `report.json`, `report.md` and the per case results into `dir`. */
export function writeRun(dir: string, r: RunResult): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(r.report, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), renderMarkdown(r.report));
  const jsonl = (rows: readonly unknown[]) => `${rows.map((x) => JSON.stringify(x)).join('\n')}\n`;
  if (r.tutor.length > 0) writeFileSync(join(dir, 'tutor-cases.jsonl'), jsonl(r.tutor));
  if (r.analyzer.length > 0) writeFileSync(join(dir, 'analyzer-words.jsonl'), jsonl(r.analyzer));
}
