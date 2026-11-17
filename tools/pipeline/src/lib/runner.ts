// The stage runner. A stage declares the files it reads and writes; the runner fingerprints the
// inputs, the stage's code and its parameters, and skips a stage whose fingerprint did not
// change since its last run and whose outputs are still in place.
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParseArgsOptionsConfig } from 'node:util';
import {
  existsSync,
  isDirectory,
  listFiles,
  sha256,
  sha256File,
  stableJson,
  writeFileAtomic,
} from './files';
import type { Paths } from './paths';
import type { SetPart } from './set';
import type { Check } from './validate';

export type ArgValue = string | boolean | string[] | boolean[] | undefined;

export interface StageContext {
  paths: Paths;
  /** Parsed command line options of this stage. */
  args: Record<string, ArgValue>;
  log: (message: string) => void;
  now: () => Date;
  /** Every registered stage, for stages that work across them (validate, load). */
  stages: readonly Stage[];
}

export interface Stage {
  name: string;
  description: string;
  /** Command line options, in the format of node:util parseArgs. */
  options?: ParseArgsOptionsConfig;
  /** Sources (lib/sources.ts) this stage reads: an id, or `id/file` for one file of it. */
  sources?: string[];
  /** Folder of the stage's code. Its files are part of the fingerprint. */
  codeDir?: string;
  /** Files or folders the stage reads. A folder counts with every file in it. */
  inputs(ctx: StageContext): string[];
  /** Files the stage writes. */
  outputs(ctx: StageContext): string[];
  /** Anything else that changes the output, such as options. */
  params?(ctx: StageContext): unknown;
  /** Run every time (fetch, load): the stage decides itself what to do. */
  alwaysRun?: boolean;
  run(ctx: StageContext): Promise<unknown>;
  /** Files this stage contributes to the content set that validate assembles. */
  parts?: SetPart[];
  /** Checks this stage adds to validate. */
  checks?: Check[];
}

/** The folder of a stage module, for `codeDir`: `codeDirOf(import.meta.url)`. */
export function codeDirOf(moduleUrl: string): string {
  return dirname(fileURLToPath(moduleUrl));
}

const LIB_DIR = dirname(fileURLToPath(import.meta.url));

interface FileStamp {
  size: number;
  mtimeMs: number;
  sha256: string;
}

interface StageState {
  stage: string;
  fingerprint: string;
  ranAt: string;
  files: Record<string, FileStamp>;
  outputs: string[];
  result?: unknown;
}

export interface RunOutcome {
  stage: string;
  skipped: boolean;
  fingerprint: string;
  result?: unknown;
  ms: number;
}

function statePath(paths: Paths, stage: string): string {
  return join(paths.state, `${stage}.json`);
}

async function readState(paths: Paths, stage: string): Promise<StageState | null> {
  const p = statePath(paths, stage);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as StageState;
  } catch {
    return null;
  }
}

/** Hashes files, reusing a known hash when size and mtime did not change. */
class Hasher {
  readonly stamps: Record<string, FileStamp> = {};
  constructor(
    private readonly root: string,
    private readonly known: Record<string, FileStamp>,
  ) {}

  private rel(p: string): string {
    return relative(this.root, p);
  }

  async file(path: string): Promise<string> {
    const key = this.rel(path);
    const s = await stat(path);
    const prev = this.known[key];
    const stamp: FileStamp =
      prev && prev.size === s.size && prev.mtimeMs === s.mtimeMs
        ? prev
        : { size: s.size, mtimeMs: s.mtimeMs, sha256: await sha256File(path) };
    this.stamps[key] = stamp;
    return stamp.sha256;
  }

  /** A digest of a file, of a folder (every file in it) or of a missing path. */
  async path(path: string): Promise<string> {
    if (await isDirectory(path)) {
      const parts: string[] = [];
      for (const f of await listFiles(path)) parts.push(`${f}:${await this.file(join(path, f))}`);
      return sha256(parts.join('\n'));
    }
    if (!existsSync(path)) return 'missing';
    return this.file(path);
  }
}

async function codeDigest(dirs: string[]): Promise<string> {
  const parts: string[] = [];
  for (const dir of dirs) {
    for (const f of await listFiles(dir)) {
      if (!/\.ts$/u.test(f) || /\.test\.ts$/u.test(f) || f.split(/[\\/]/u).includes('fixtures'))
        continue;
      parts.push(`${f}:${sha256(await readFile(join(dir, f)))}`);
    }
  }
  return sha256(parts.join('\n'));
}

async function fingerprint(stage: Stage, ctx: StageContext, hasher: Hasher): Promise<string> {
  const inputs: string[] = [];
  for (const p of stage.inputs(ctx))
    inputs.push(`${relative(ctx.paths.root, p)}=${await hasher.path(p)}`);
  const code = await codeDigest(stage.codeDir ? [LIB_DIR, stage.codeDir] : [LIB_DIR]);
  return sha256(
    stableJson({ stage: stage.name, params: stage.params?.(ctx) ?? null, code, inputs }),
  );
}

async function outputsIntact(stage: Stage, ctx: StageContext, state: StageState): Promise<boolean> {
  const hasher = new Hasher(ctx.paths.root, {});
  for (const p of stage.outputs(ctx)) {
    const key = relative(ctx.paths.root, p);
    const prev = state.files[key];
    if (!prev || !existsSync(p)) return false;
    const s = await stat(p);
    if (s.size !== prev.size) return false;
    if (s.mtimeMs !== prev.mtimeMs && (await hasher.file(p)) !== prev.sha256) return false;
  }
  return true;
}

/**
 * Runs one stage, or skips it when nothing it depends on changed. A file that is both an
 * input and an output (the lemma registry) is fingerprinted as it is after the run, so a
 * second run that changes nothing is skipped.
 */
export async function runStage(
  stage: Stage,
  ctx: StageContext,
  opts: { force?: boolean } = {},
): Promise<RunOutcome> {
  const started = performance.now();
  const prev = await readState(ctx.paths, stage.name);
  const before = new Hasher(ctx.paths.root, prev?.files ?? {});
  const fp = await fingerprint(stage, ctx, before);
  if (
    !opts.force &&
    !stage.alwaysRun &&
    prev &&
    prev.fingerprint === fp &&
    (await outputsIntact(stage, ctx, prev))
  ) {
    ctx.log(`${stage.name}: inputs unchanged since ${prev.ranAt}, skipped (use --force to rerun)`);
    return { stage: stage.name, skipped: true, fingerprint: fp, ms: performance.now() - started };
  }
  const result = await stage.run(ctx);
  const after = new Hasher(ctx.paths.root, before.stamps);
  const fpAfter = await fingerprint(stage, ctx, after);
  for (const p of stage.outputs(ctx))
    if (existsSync(p) && !(await isDirectory(p))) await after.file(p);
  const state: StageState = {
    stage: stage.name,
    fingerprint: fpAfter,
    ranAt: ctx.now().toISOString(),
    files: after.stamps,
    outputs: stage.outputs(ctx).map((p) => relative(ctx.paths.root, p)),
    result,
  };
  await writeFileAtomic(statePath(ctx.paths, stage.name), stableJson(state));
  return {
    stage: stage.name,
    skipped: false,
    fingerprint: fpAfter,
    result,
    ms: performance.now() - started,
  };
}

/** Resolves a path option against the directory the command was started from. */
export function resolveArg(value: ArgValue, base: string): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  return isAbsolute(value) ? value : join(base, value);
}
