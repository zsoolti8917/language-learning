// The command line options every stage with a model fill shares, so C2 to C5 read them the
// same way: `--fill none|dry-run|mock|live|offline`, `--max-spend <usd>` and, for an offline
// fill, `--answered-by <writer>`.
import { join } from 'node:path';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { Paths } from '../lib/paths';
import type { StageContext } from '../lib/runner';
import { DEFAULT_MAX_SPEND_USD } from './pricing';
import { OFFLINE_MODEL, RUN_MODES, type RunMode, type RunOptions } from './runner';

export type FillMode = 'none' | RunMode;

export const FILL_OPTIONS: ParseArgsOptionsConfig = {
  fill: { type: 'string' },
  'max-spend': { type: 'string' },
  'answered-by': { type: 'string' },
};

/**
 * The answer cache: `content/build/model-cache/<route>/`, not in git. Mock answers go to
 * `model-cache-mock/`, so they can never stand in for real ones.
 */
export function modelCacheDir(paths: Paths, mode: RunMode = 'live'): string {
  return join(paths.build, mode === 'mock' ? 'model-cache-mock' : 'model-cache');
}

/**
 * Offline fills: the open requests of a stage, `<stage>/<route>/<hash>.json`, and the answers
 * a writer places under the same names. Both sit in content/build, so neither is in git; an
 * accepted answer moves into the answer cache and from there into content/generated.
 */
export function offlineRequestsDir(paths: Paths, stage: string): string {
  return join(paths.build, 'model-requests', stage);
}
export function offlineAnswersDir(paths: Paths, stage: string): string {
  return join(paths.build, 'model-answers', stage);
}

/** `--fill`: none (default), dry-run, mock, live or offline. */
export function fillModeOf(ctx: StageContext): FillMode {
  const v = ctx.args.fill ?? 'none';
  if (v === 'none' || (typeof v === 'string' && (RUN_MODES as string[]).includes(v)))
    return v as FillMode;
  throw new Error(`--fill must be none, ${RUN_MODES.join(', ')}; not "${String(v)}"`);
}

/** `--max-spend <usd>`: the explicit permission to spend more than $5. */
export function maxSpendOf(ctx: StageContext): number {
  const v = ctx.args['max-spend'];
  if (v === undefined) return DEFAULT_MAX_SPEND_USD;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`--max-spend must be a number of USD, not "${String(v)}"`);
  return n;
}

/** `--answered-by <writer>`: who writes the answers of an offline fill. */
export function answeredByOf(ctx: StageContext): string {
  const v = ctx.args['answered-by'];
  if (v === undefined) return OFFLINE_MODEL;
  if (typeof v !== 'string' || !/^[\w.-]{1,60}$/u.test(v))
    throw new Error('--answered-by must be a short name of letters, digits, ".", "-" and "_"');
  return v;
}

/**
 * Whether a fill must reach its model step on every run, even when no input file changed:
 * a dry run prints an estimate, a live run sends, an offline run looks for new answers.
 */
export function fillAlwaysRuns(ctx: StageContext): boolean {
  const mode = fillModeOf(ctx);
  return mode === 'dry-run' || mode === 'live' || mode === 'offline';
}

/**
 * Run options for a stage's fill; `null` when the fill is off. `stage` names the folder of
 * the stage's offline requests and answers.
 */
export function runOptionsOf(ctx: StageContext, stage = 'stage'): RunOptions | null {
  const mode = fillModeOf(ctx);
  if (mode === 'none') return null;
  return {
    mode,
    cacheDir: modelCacheDir(ctx.paths, mode),
    maxSpendUsd: maxSpendOf(ctx),
    log: ctx.log,
    ...(mode === 'offline'
      ? {
          requestsDir: offlineRequestsDir(ctx.paths, stage),
          answersDir: offlineAnswersDir(ctx.paths, stage),
          answeredBy: answeredByOf(ctx),
        }
      : {}),
  };
}
