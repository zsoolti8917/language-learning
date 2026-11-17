// Stage 11, validate: assembles content/build/set/ from the parts every stage declares, writes
// its manifest, and checks it: the core checks of lib/validate.ts plus every stage's own.
// With --dir it checks an existing set folder instead (for example the mini dataset).
import { join } from 'node:path';
import { existsSync, stableJson, writeFileAtomic } from '../../lib/files';
import { loadRegistry } from '../../lib/registry';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import { assembleSet, type ManifestSource, type SetPart } from '../../lib/set';
import { readSourceRecord, sourceById } from '../../lib/sources';
import { type Check, CORE_CHECKS, type ValidationResult, validateSet } from '../../lib/validate';

const report = (ctx: StageContext, f: string) => join(ctx.paths.build, 'validate', f);

function customDir(ctx: StageContext): string | undefined {
  return resolveArg(ctx.args.dir, process.env.INIT_CWD ?? process.cwd());
}

/** Every part of every registered stage, in stage order. */
export function allParts(stages: readonly Stage[]): SetPart[] {
  return stages.flatMap((s) => s.parts ?? []);
}

/** Every check: the core ones, then each stage's own. */
export function allChecks(stages: readonly Stage[]): Check[] {
  return [...CORE_CHECKS, ...stages.flatMap((s) => s.checks ?? [])];
}

/**
 * The manifest's sources: each file a contributing stage reads, as fetch recorded it.
 * A stage names a whole source (`snk-morphology`) or one file (`snk-morphology/ma.txt.xz`).
 */
export async function manifestSources(
  ctx: StageContext,
  stages: readonly Stage[],
): Promise<ManifestSource[]> {
  const out: ManifestSource[] = [];
  for (const stage of stages) {
    const parts = (stage.parts ?? []).filter((p) => existsSync(p.path(ctx.paths)));
    if (parts.length === 0) continue;
    for (const ref of stage.sources ?? []) {
      const [id, only] = ref.split('/') as [string, string | undefined];
      const source = sourceById(id);
      const record = await readSourceRecord(ctx.paths.raw, id);
      for (const f of source.files) {
        if (only && f.name !== only) continue;
        const r = record?.files.find((x) => x.name === f.name);
        out.push({
          name: `${source.name}: ${f.name}`,
          url: f.url,
          checksum: r ? `sha256:${r.sha256}` : f.sha256 ? `sha256:${f.sha256}` : '',
          license: source.license,
        });
      }
    }
  }
  return out;
}

export function renderValidation(
  dir: string,
  r: ValidationResult,
  checks: readonly Check[],
): string {
  const lines = [
    '# Validation report',
    '',
    `Set: \`${dir}\`. Result: **${r.ok ? 'pass' : 'fail'}**.`,
    '',
    '| Check | Issues | What it checks |',
    '|---|---:|---|',
    ...checks.map((c) => `| ${c.id} | ${r.issueCounts[c.id] ?? 0} | ${c.description} |`),
    '',
  ];
  if (r.issues.length > 0)
    lines.push('## Issues', '', ...r.issues.map((i) => `- ${i.check}: ${i.message}`), '');
  if (r.warnings.length > 0)
    lines.push('## Warnings', '', ...r.warnings.map((i) => `- ${i.check}: ${i.message}`), '');
  return lines.join('\n');
}

export async function runValidate(ctx: StageContext): Promise<Record<string, unknown>> {
  const custom = customDir(ctx);
  let dir = ctx.paths.set;
  let counts: Record<string, number> | undefined;
  let version: string | undefined;
  if (custom) dir = custom;
  else {
    const assembled = await assembleSet({
      paths: ctx.paths,
      parts: allParts(ctx.stages),
      outDir: ctx.paths.set,
      sources: await manifestSources(ctx, ctx.stages),
      now: ctx.now(),
    });
    counts = assembled.counts;
    version = assembled.manifest.version;
    ctx.log(
      `validate: set ${version} ${assembled.changed ? 'written' : 'unchanged'}: ${JSON.stringify(counts)}`,
    );
  }
  const checks = allChecks(ctx.stages);
  const registry = ctx.args['no-registry'] ? null : await loadRegistry(ctx.paths.registry);
  const complete = custom ? ctx.args.complete === true : true;
  const result = await validateSet(dir, checks, { registry, complete });
  await writeFileAtomic(report(ctx, 'report.md'), renderValidation(dir, result, checks));
  await writeFileAtomic(report(ctx, 'report.json'), stableJson({ dir, ...result, ms: undefined }));
  for (const w of result.warnings.slice(0, 20))
    ctx.log(`validate: warning ${w.check}: ${w.message}`);
  for (const i of result.issues.slice(0, 50)) ctx.log(`validate: ${i.check}: ${i.message}`);
  ctx.log(`validate: ${result.ok ? 'pass' : 'FAIL'} (${JSON.stringify(result.ms)} ms per check)`);
  if (!result.ok)
    throw new Error(
      `validate: ${Object.values(result.issueCounts).reduce((a, b) => a + b, 0)} issues, see ${report(ctx, 'report.md')}`,
    );
  return { dir, version, counts, warnings: result.warnings.length };
}

export const validateStage: Stage = {
  name: 'validate',
  description: 'Assembles content/build/set from every stage and checks it',
  codeDir: codeDirOf(import.meta.url),
  options: {
    dir: { type: 'string' },
    complete: { type: 'boolean' },
    'no-registry': { type: 'boolean' },
  },
  inputs: (ctx) => {
    const custom = customDir(ctx);
    if (custom) return [custom, ctx.paths.registry];
    return [...allParts(ctx.stages).map((p) => p.path(ctx.paths)), ctx.paths.registry];
  },
  outputs: (ctx) => [
    ...(customDir(ctx) ? [] : [join(ctx.paths.set, 'manifest.json')]),
    report(ctx, 'report.md'),
  ],
  params: (ctx) => ({
    dir: customDir(ctx) ?? null,
    complete: ctx.args.complete ?? null,
    noRegistry: ctx.args['no-registry'] ?? null,
  }),
  run: runValidate,
};
