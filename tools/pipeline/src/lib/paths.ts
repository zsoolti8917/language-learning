// Where the pipeline reads and writes (docs/architecture.md, "Where files live").
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Paths {
  /** The repository root. */
  root: string;
  /** `content/` */
  content: string;
  /** `content/raw/`: downloaded sources, one folder per source id. Not in git. */
  raw: string;
  /** `content/build/`: stage outputs, one folder per stage. Not in git. */
  build: string;
  /** `content/build/set/`: the assembled content set that `validate` checks and `load` loads. */
  set: string;
  /** `content/build/.state/`: the stage runner's fingerprints. */
  state: string;
  /** `content/registry/lemma-ids.tsv` */
  registry: string;
  /** `content/SOURCES.md` */
  sourcesMd: string;
  /** `packages/testkit/mini/`: the mini dataset. */
  mini: string;
}

export function pathsFor(root: string): Paths {
  const content = join(root, 'content');
  const build = join(content, 'build');
  return {
    root,
    content,
    raw: join(content, 'raw'),
    build,
    set: join(build, 'set'),
    state: join(build, '.state'),
    registry: join(content, 'registry', 'lemma-ids.tsv'),
    sourcesMd: join(content, 'SOURCES.md'),
    mini: join(root, 'packages', 'testkit', 'mini'),
  };
}

/** The repository root: `PIPELINE_ROOT` when set, else the folder holding pnpm-workspace.yaml. */
export function findRoot(from: string = dirname(fileURLToPath(import.meta.url))): string {
  const env = process.env.PIPELINE_ROOT;
  if (env) return resolve(env);
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no pnpm-workspace.yaml above ${from}`);
    dir = up;
  }
}
