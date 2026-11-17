// The command line options every stage with a model fill shares, so C2 to C5 read them the
// same way: `--fill none|dry-run|mock|live` and `--max-spend <usd>`.
import { join } from 'node:path';
import type { ParseArgsOptionsConfig } from 'node:util';
import type { Paths } from '../lib/paths';
import type { StageContext } from '../lib/runner';
import { DEFAULT_MAX_SPEND_USD } from './pricing';
import { RUN_MODES, type RunMode, type RunOptions } from './runner';

export type FillMode = 'none' | RunMode;

export const FILL_OPTIONS: ParseArgsOptionsConfig = {
  fill: { type: 'string' },
  'max-spend': { type: 'string' },
};

/**
 * The answer cache: `content/build/model-cache/<route>/`, not in git. Mock answers go to
 * `model-cache-mock/`, so they can never stand in for real ones.
 */
export function modelCacheDir(paths: Paths, mode: RunMode = 'live'): string {
  return join(paths.build, mode === 'mock' ? 'model-cache-mock' : 'model-cache');
}

/** `--fill`: none (default), dry-run, mock or live. */
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

/** Run options for a stage's fill; `null` when the fill is off. */
export function runOptionsOf(ctx: StageContext): RunOptions | null {
  const mode = fillModeOf(ctx);
  if (mode === 'none') return null;
  return {
    mode,
    cacheDir: modelCacheDir(ctx.paths, mode),
    maxSpendUsd: maxSpendOf(ctx),
    log: ctx.log,
  };
}
