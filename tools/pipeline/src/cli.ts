// `pnpm run pipeline <stage> [options]`: runs one stage of the content pipeline.
//   pnpm run pipeline list                 the stages and their options
//   pnpm run pipeline <stage> --force      rerun even when the inputs did not change
// Note the `run`: pnpm 12 has a built-in command `pnpm pipeline`, which shadows the root script.
import { parseArgs } from 'node:util';
import { findRoot, pathsFor } from './lib/paths';
import { runStage, type StageContext } from './lib/runner';
import { STAGES, stageByName } from './stages';

function usage(): string {
  const lines = ['Usage: pnpm run pipeline <stage> [--force] [options]', '', 'Stages:'];
  for (const s of STAGES) {
    const opts = Object.entries(s.options ?? {})
      .map(([k, o]) => `--${k}${o.type === 'string' ? ' <value>' : ''}`)
      .join(' ');
    lines.push(`  ${s.name.padEnd(10)} ${s.description}`);
    if (opts) lines.push(`  ${''.padEnd(10)} ${opts}`);
  }
  return lines.join('\n');
}

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name === 'list' || name === 'help' || name === '--help') {
    console.log(usage());
    return name ? 0 : 1;
  }
  const stage = stageByName(name);
  if (!stage) {
    console.error(`unknown stage "${name}"\n\n${usage()}`);
    return 1;
  }
  const { values } = parseArgs({
    args: rest,
    options: { force: { type: 'boolean' }, ...(stage.options ?? {}) },
    allowPositionals: false,
  });
  const ctx: StageContext = {
    paths: pathsFor(findRoot()),
    args: values,
    log: (m) => console.log(m),
    now: () => new Date(),
    stages: STAGES,
  };
  const outcome = await runStage(stage, ctx, { force: values.force === true });
  console.log(
    `${stage.name}: ${outcome.skipped ? 'skipped' : 'done'} in ${(outcome.ms / 1000).toFixed(1)} s`,
  );
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
