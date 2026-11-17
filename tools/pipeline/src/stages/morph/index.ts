// Stage 2, morph: the SNK morphological database → lemmas.jsonl, forms.jsonl, the lemma
// registry and a quality report (docs/work-packages.md, C1).
import { join } from 'node:path';
import type { LemmaRow } from '@app/contracts';
import {
  existsSync,
  readJsonl,
  sha256File,
  stableJson,
  writeFileAtomic,
  writeJsonl,
} from '../../lib/files';
import { readLines } from '../../lib/lines';
import { LemmaRegistry, loadRegistry, saveRegistry } from '../../lib/registry';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import { buildMorphology, type FormOut, lemmaRow } from './build';
import { compareForms } from './compare';
import { measureFormsTable } from './measure';
import { type MorphReport, NOUN_COVERAGE_TARGET, nounSummary, renderReport } from './report';

export const SNK_SOURCE = 'snk-morphology';
export const SNK_FILE = 'ma-2015-02-05.txt.xz';

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'morph', f);
const base = () => process.env.INIT_CWD ?? process.cwd();

function inputFile(ctx: StageContext): string {
  return resolveArg(ctx.args.input, base()) ?? join(ctx.paths.raw, SNK_SOURCE, SNK_FILE);
}

function miniDir(ctx: StageContext): string | null {
  if (ctx.args.mini === 'none') return null;
  const dir = resolveArg(ctx.args.mini, base()) ?? ctx.paths.mini;
  return existsSync(join(dir, 'forms.jsonl')) ? dir : null;
}

function measureMode(ctx: StageContext): 'off' | 'sample' | 'full' {
  const m = ctx.args.measure ?? 'sample';
  if (m !== 'off' && m !== 'sample' && m !== 'full')
    throw new Error(`--measure must be off, sample or full, not "${String(m)}"`);
  return m;
}

/** The registry, or one seeded with the mini dataset's ids when the file does not exist yet. */
async function openRegistry(ctx: StageContext): Promise<LemmaRegistry> {
  const reg = await loadRegistry(ctx.paths.registry);
  if (reg) return reg;
  const mini = miniDir(ctx);
  const entries: [number, string][] = [];
  if (mini)
    for await (const l of readJsonl<LemmaRow>(join(mini, 'lemmas.jsonl')))
      entries.push([l.id, l.key]);
  ctx.log(`morph: no registry yet, starting one from ${entries.length} mini dataset lemmas`);
  return new LemmaRegistry(entries.sort((a, b) => a[0] - b[0]));
}

export async function runMorph(ctx: StageContext): Promise<Record<string, unknown>> {
  const input = inputFile(ctx);
  if (!existsSync(input))
    throw new Error(
      `morph: ${input} does not exist. Run "pnpm run pipeline fetch --source ${SNK_SOURCE}" first, or pass --input.`,
    );
  const t0 = performance.now();
  const registry = await openRegistry(ctx);
  ctx.log(`morph: reading ${input}`);
  const result = await buildMorphology(readLines(input), registry);
  const tRead = performance.now();
  await writeJsonl(out(ctx, 'lemmas.jsonl'), result.lemmas.map(lemmaRow));
  await writeJsonl(out(ctx, 'forms.jsonl'), result.forms);
  await saveRegistry(ctx.paths.registry, registry);
  const tWrite = performance.now();

  const mode = measureMode(ctx);
  const sampleSize = Number(ctx.args.sample ?? 100000);
  const size =
    mode === 'off'
      ? null
      : await measureFormsTable(
          result.lemmas,
          result.forms,
          mode === 'sample' ? { sample: sampleSize } : {},
        );

  const mini = miniDir(ctx);
  const report: MorphReport = {
    input: {
      file: input.startsWith(ctx.paths.root) ? input.slice(ctx.paths.root.length + 1) : input,
      sha256: await sha256File(input),
    },
    stats: (({ newIds: _, ...rest }) => rest)(result.stats),
    totals: { lemmas: result.lemmas.length, forms: result.forms.length },
    nouns: nounSummary(result.nouns),
    formsTable: size ? { ...size, ms: 0 } : null,
    mini: { compared: false, lemmaKeyMismatches: [], formDiffs: [] },
    registry: { size: registry.size, retired: result.stats.retired },
  };
  if (mini) {
    const miniForms: FormOut[] = [];
    for await (const f of readJsonl<FormOut>(join(mini, 'forms.jsonl'))) miniForms.push(f);
    report.mini.compared = true;
    report.mini.formDiffs = compareForms(miniForms, result.forms);
    for await (const l of readJsonl<LemmaRow>(join(mini, 'lemmas.jsonl'))) {
      const built = registry.keyOf(l.id) ?? null;
      const live = result.lemmas.find((x) => x.id === l.id);
      if (built !== l.key || !live || live.flags.retired)
        report.mini.lemmaKeyMismatches.push({
          id: l.id,
          mini: l.key,
          built: live?.flags.retired ? `${built} (retired)` : built,
        });
    }
  }
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(report));
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(report));
  const ms = (a: number, b: number) => Math.round(b - a);
  const summary = {
    lemmas: result.lemmas.length,
    forms: result.forms.length,
    newIds: registry.added,
    nounCoverage: Number(report.nouns.coveredShare.toFixed(4)),
    formsTableMB: size ? Number((size.estimatedBytes / 1024 / 1024).toFixed(1)) : null,
    miniDiffs: report.mini.formDiffs.length,
    ms: {
      read: ms(t0, tRead),
      write: ms(tRead, tWrite),
      measure: size?.ms ?? 0,
      total: ms(t0, performance.now()),
    },
  };
  ctx.log(`morph: ${JSON.stringify(summary)}`);
  ctx.log(`morph: report in ${out(ctx, 'report.md')}`);
  return summary;
}

/** Prepositions carry the cases they govern in flags.cases (C4 checks its triggers against them). */
export const prepCasesCheck: Check = {
  id: 'morph.prep-cases',
  description: 'Every preposition lists the cases it governs in flags.cases',
  async run(ctx) {
    for await (const { n, row } of ctx.raw('lemmas.jsonl')) {
      if (row.pos !== 'prep') continue;
      const flags = (row.flags ?? {}) as { cases?: unknown; retired?: boolean };
      if (flags.retired) continue;
      const ok = Array.isArray(flags.cases) && flags.cases.length > 0;
      if (ok) continue;
      const msg = `lemmas.jsonl:${n}: preposition "${String(row.lemma)}" has no flags.cases`;
      if (ctx.complete) ctx.issue(msg);
      else ctx.warn(msg);
    }
  },
};

const MIN_NOUNS_FOR_SHARE = 1000;

/** At least 95 % of nouns have a pattern or the irregular flag (sets of 1,000 nouns or more). */
export const nounPatternsCheck: Check = {
  id: 'morph.noun-patterns',
  description: `At least ${NOUN_COVERAGE_TARGET * 100} % of nouns have a pattern or the irregular flag`,
  async run(ctx) {
    let total = 0;
    let covered = 0;
    for await (const { row } of ctx.rows('lemmas.jsonl')) {
      if (row.pos !== 'noun' || row.flags.retired) continue;
      total++;
      if (row.pattern || row.flags.irregular) covered++;
    }
    if (total === 0 || covered / total >= NOUN_COVERAGE_TARGET) return;
    const msg = `only ${covered} of ${total} nouns (${((covered / total) * 100).toFixed(1)} %) have a pattern or the irregular flag`;
    // A share means little on a handful of nouns (a test sample): there it is only a warning.
    if (total >= MIN_NOUNS_FOR_SHARE) ctx.issue(msg);
    else ctx.warn(msg);
  },
};

export const morphStage: Stage = {
  name: 'morph',
  description: 'SNK morphology → lemmas.jsonl, forms.jsonl, lemma registry, quality report',
  sources: [`${SNK_SOURCE}/${SNK_FILE}`],
  codeDir: codeDirOf(import.meta.url),
  options: {
    input: { type: 'string' },
    measure: { type: 'string' },
    sample: { type: 'string' },
    mini: { type: 'string' },
  },
  inputs: (ctx) => {
    const mini = miniDir(ctx);
    return [
      inputFile(ctx),
      ctx.paths.registry,
      ...(mini ? [join(mini, 'forms.jsonl'), join(mini, 'lemmas.jsonl')] : []),
    ];
  },
  outputs: (ctx) => [
    out(ctx, 'lemmas.jsonl'),
    out(ctx, 'forms.jsonl'),
    out(ctx, 'report.md'),
    out(ctx, 'report.json'),
    ctx.paths.registry,
  ],
  params: (ctx) => ({ measure: measureMode(ctx), sample: ctx.args.sample ?? null }),
  run: runMorph,
  parts: [
    { file: 'lemmas.jsonl', path: (p) => join(p.build, 'morph', 'lemmas.jsonl') },
    { file: 'forms.jsonl', path: (p) => join(p.build, 'morph', 'forms.jsonl') },
  ],
  checks: [prepCasesCheck, nounPatternsCheck],
};
