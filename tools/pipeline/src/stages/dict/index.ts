// Stage 4, dict: English glosses from the Wiktionary extract, up to three short senses per
// lemma; ranked lemmas without an entry are filled through the route `content.glosses`
// (docs/work-packages.md, C2). Model glosses live in content/generated/glosses.jsonl (in
// git), so a rebuild needs no model call; they enter senses.jsonl with source `generated`.
//
//   pnpm run pipeline dict                      Wiktionary + the glosses already generated
//   pnpm run pipeline dict --fill dry-run       + request count and cost of the missing ones
//   pnpm run pipeline dict --fill live          + sends them (refuses above $5 without --max-spend)
//   pnpm run pipeline dict --fill mock          + scripted glosses, written to the build folder
//   pnpm run pipeline dict --fill offline       + answers written outside the API (docs/content-build.md)
import { join } from 'node:path';
import type { SenseRow } from '@app/contracts';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, resolveArg, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import { FILL_OPTIONS, fillAlwaysRuns, fillModeOf, runOptionsOf } from '../../model/options';
import { formatUsd } from '../../model/pricing';
import {
  GLOSS_GROUP_SIZE,
  type GlossRequest,
  type GlossWord,
  glossesTask,
} from '../../model/prompts/content-glosses';
import { type BatchJob, type BatchOutcome, runBatch } from '../../model/runner';
import type { FreqLemma } from '../freq/rank';
import {
  type DictEntry,
  type KaikkiEntry,
  matchEntries,
  parseEntry,
  type Sense,
} from './wiktionary';

export const KAIKKI_SOURCE = 'kaikki-wiktionary';
export const KAIKKI_FILE = 'kaikki.org-dictionary-Slovak.jsonl';

/** One generated gloss row in content/generated/glosses.jsonl. */
export interface GeneratedGloss {
  key: string;
  lemmaId: number;
  lemma: string;
  pos: string;
  glosses: string[];
  source: 'generated';
  route: string;
  promptVersion: number;
  model: string;
  requestHash: string;
}

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'dict', f);
const base = () => process.env.INIT_CWD ?? process.cwd();

/** content/generated/glosses.jsonl; mock fills go to the build folder so git stays clean. */
export function glossesPath(ctx: StageContext): string {
  const custom = resolveArg(ctx.args.glosses, base());
  if (custom) return custom;
  if (fillModeOf(ctx) === 'mock') return out(ctx, 'glosses.mock.jsonl');
  return join(ctx.paths.content, 'generated', 'glosses.jsonl');
}

function inputsOf(ctx: StageContext) {
  return {
    kaikki: join(ctx.paths.raw, KAIKKI_SOURCE, KAIKKI_FILE),
    lemmas: join(ctx.paths.build, 'morph', 'lemmas.jsonl'),
    ranks: join(ctx.paths.build, 'freq', 'lemmas.jsonl'),
  };
}

function intArg(ctx: StageContext, name: string, fallback: number): number {
  const v = ctx.args[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a whole number`);
  return n;
}

interface RankRow {
  id: number;
  freqRank: number;
  topForms?: { form: string }[];
}

export async function readGlosses(path: string): Promise<GeneratedGloss[]> {
  const rows: GeneratedGloss[] = [];
  if (!existsSync(path)) return rows;
  for await (const r of readJsonl<GeneratedGloss>(path)) rows.push(r);
  return rows;
}

const BANDS = [1000, 3000, 5000];

export interface Coverage {
  band: number;
  ranked: number;
  wiktionary: number;
  generated: number;
  missing: number;
}

export async function runDict(ctx: StageContext): Promise<Record<string, unknown>> {
  const files = inputsOf(ctx);
  for (const [name, path] of Object.entries(files))
    if (!existsSync(path))
      throw new Error(
        `dict: ${path} (${name}) does not exist. Run fetch --source ${KAIKKI_SOURCE}, morph and freq first.`,
      );
  const mode = fillModeOf(ctx);
  const fillLimit = intArg(ctx, 'fill-limit', 5000);
  const sample = intArg(ctx, 'sample', 0);

  // Lemmas and ranks.
  const lemmas = new Map<number, FreqLemma>();
  for await (const l of readJsonl<FreqLemma>(files.lemmas))
    if (!l.flags?.retired) lemmas.set(l.id, l);
  const ranks = new Map<number, RankRow>();
  for await (const r of readJsonl<RankRow>(files.ranks)) ranks.set(r.id, r);

  // Wiktionary.
  const entries: DictEntry[] = [];
  let kaikkiRows = 0;
  for await (const e of readJsonl<KaikkiEntry>(files.kaikki)) {
    kaikkiRows++;
    const d = parseEntry(e);
    if (d) entries.push(d);
  }
  const { senses: wikt, how } = matchEntries(lemmas.values(), entries);
  ctx.log(`dict: ${entries.length} usable entries of ${kaikkiRows}; ${wikt.size} lemmas matched`);

  // Generated glosses already made, by key.
  const gpath = glossesPath(ctx);
  const generated = new Map<string, GeneratedGloss>();
  for (const g of await readGlosses(gpath)) generated.set(g.key, g);
  const idByKey = new Map<string, number>();
  for (const l of lemmas.values()) idByKey.set(l.key, l.id);

  // The gaps: ranked lemmas within the fill limit with neither kind of gloss.
  const ranked = [...ranks.values()].sort((a, b) => a.freqRank - b.freqRank);
  let gaps = ranked.filter((r) => {
    const l = lemmas.get(r.id);
    return l && r.freqRank <= fillLimit && !wikt.has(r.id) && !generated.has(l.key);
  });
  if (sample > 0) gaps = gaps.slice(0, sample);

  let fill: BatchOutcome<GlossRequest, unknown> | null = null;
  const options = runOptionsOf(ctx, 'dict');
  if (options && gaps.length > 0) {
    const words: GlossWord[] = gaps.map((r) => {
      const l = lemmas.get(r.id) as FreqLemma;
      const forms = [...new Set((r.topForms ?? []).map((f) => f.form))].filter(
        (f) => f !== l.lemma,
      );
      return {
        key: l.key,
        lemma: l.lemma,
        pos: l.pos,
        ...(l.gender ? { gender: l.gender } : {}),
        ...(l.aspect ? { aspect: l.aspect } : {}),
        ...(forms.length > 0 ? { forms } : {}),
      };
    });
    const jobs: BatchJob<GlossRequest>[] = [];
    for (let i = 0; i < words.length; i += GLOSS_GROUP_SIZE)
      jobs.push({
        id: `g${i / GLOSS_GROUP_SIZE}`,
        input: { words: words.slice(i, i + GLOSS_GROUP_SIZE) },
      });
    const outcome = await runBatch(glossesTask, jobs, options);
    fill = outcome as BatchOutcome<GlossRequest, unknown>;
    let added = 0;
    for (const r of outcome.results)
      for (const item of r.output.items) {
        const id = idByKey.get(item.key);
        const l = id === undefined ? undefined : lemmas.get(id);
        if (!l) continue;
        generated.set(item.key, {
          key: l.key,
          lemmaId: l.id,
          lemma: l.lemma,
          pos: l.pos,
          glosses: item.glosses.map((g) => g.trim()),
          source: 'generated',
          route: glossesTask.route,
          promptVersion: glossesTask.promptVersion,
          model: r.model,
          requestHash: r.hash,
        });
        added++;
      }
    if (added > 0) {
      const rows = [...generated.values()].sort((a, b) => a.lemmaId - b.lemmaId);
      const w = await JsonlWriter.open(gpath);
      for (const row of rows) await w.write(row);
      await w.close();
      ctx.log(`dict: ${added} generated glosses added to ${gpath}`);
    }
  } else if (gaps.length > 0) {
    ctx.log(
      `dict: ${gaps.length} ranked lemmas have no gloss; --fill dry-run estimates the model fill`,
    );
  }

  // senses.jsonl: Wiktionary first; a generated gloss only where Wiktionary has none.
  const w = await JsonlWriter.open(out(ctx, 'senses.jsonl'));
  const source = new Map<number, 'wiktionary' | 'generated'>();
  const ids = [...lemmas.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const list: Sense[] | undefined = wikt.get(id);
    if (list) {
      source.set(id, 'wiktionary');
      for (const [ord, s] of list.entries()) {
        const row: SenseRow = {
          lemmaId: id,
          ord,
          glossEn: s.glossEn,
          source: 'wiktionary',
          verified: false,
        };
        if (s.note) row.note = s.note;
        await w.write(row);
      }
      continue;
    }
    const g = generated.get((lemmas.get(id) as FreqLemma).key);
    if (!g) continue;
    source.set(id, 'generated');
    for (const [ord, glossEn] of g.glosses.entries())
      await w.write({
        lemmaId: id,
        ord,
        glossEn,
        source: 'generated',
        verified: false,
      } satisfies SenseRow);
  }
  await w.close();

  const coverage: Coverage[] = BANDS.map((band) => {
    const inBand = ranked.filter((r) => r.freqRank <= band);
    const wk = inBand.filter((r) => source.get(r.id) === 'wiktionary').length;
    const gen = inBand.filter((r) => source.get(r.id) === 'generated').length;
    return {
      band,
      ranked: inBand.length,
      wiktionary: wk,
      generated: gen,
      missing: inBand.length - wk - gen,
    };
  });
  const missingTop = ranked
    .filter((r) => !source.has(r.id))
    .slice(0, 50)
    .map((r) => `${r.freqRank} ${lemmas.get(r.id)?.lemma} (${lemmas.get(r.id)?.pos})`);
  const looseCount = [...how.values()].filter((h) => h === 'loose').length;
  const summary = {
    kaikkiEntries: kaikkiRows,
    usableEntries: entries.length,
    lemmasWithWiktionary: wikt.size,
    looseMatches: looseCount,
    lemmasWithGenerated: [...source.values()].filter((s) => s === 'generated').length,
    senses: w.count,
    coverage,
    fill: fill
      ? {
          mode,
          gaps: gaps.length,
          requests: fill.requests,
          cached: fill.cached,
          sent: fill.sent,
          answered: fill.results.length,
          failed: fill.failures.length,
          estimate: fill.estimate,
          actualUsd: fill.actualUsd,
        }
      : { mode, gaps: gaps.length },
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson({ ...summary, missingTop }));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary, missingTop));
  for (const c of coverage)
    ctx.log(
      `dict: top ${c.band}: ${c.wiktionary} Wiktionary, ${c.generated} generated, ${c.missing} without a gloss`,
    );
  return summary;
}

function renderReport(
  s: {
    kaikkiEntries: number;
    usableEntries: number;
    lemmasWithWiktionary: number;
    looseMatches: number;
    senses: number;
    coverage: Coverage[];
    fill: Record<string, unknown>;
  },
  missingTop: string[],
): string {
  const lines = [
    '# Dictionary report',
    '',
    `Wiktionary extract: ${s.kaikkiEntries.toLocaleString('en')} entries, ${s.usableEntries.toLocaleString('en')} with usable senses; ${s.lemmasWithWiktionary.toLocaleString('en')} lemmas matched (${s.looseMatches} by spelling across function word classes). ${s.senses.toLocaleString('en')} sense rows written.`,
    '',
    '| Top | Ranked | Wiktionary | Generated | Without a gloss |',
    '|---:|---:|---:|---:|---:|',
    ...s.coverage.map(
      (c) =>
        `| ${c.band.toLocaleString('en')} | ${c.ranked} | ${c.wiktionary} (${((c.wiktionary / Math.max(1, c.ranked)) * 100).toFixed(1)} %) | ${c.generated} | ${c.missing} |`,
    ),
    '',
    '## Model fill',
    '',
  ];
  const f = s.fill as {
    mode: string;
    gaps: number;
    estimate?: {
      requests: number;
      usd: number;
      worstUsd: number;
      inputTokens: number;
      outputTokens: number;
      model: string;
    };
  };
  lines.push(`Mode \`${f.mode}\`, ${f.gaps} lemmas to fill.`);
  if (f.estimate)
    lines.push(
      '',
      `Estimate: ${f.estimate.requests} requests on ${f.estimate.model}, ${f.estimate.inputTokens.toLocaleString('en')} input and ${f.estimate.outputTokens.toLocaleString('en')} output tokens, ${formatUsd(f.estimate.usd)} at batch prices (at most ${formatUsd(f.estimate.worstUsd)}).`,
    );
  if (missingTop.length > 0)
    lines.push(
      '',
      '## First ranked lemmas without a gloss',
      '',
      missingTop.map((m) => `- ${m}`).join('\n'),
    );
  return `${lines.join('\n')}\n`;
}

/** In a complete build, a lemma ranked this high without a gloss fails the set (I2's target). */
export const GLOSS_REQUIRED_RANK = 3000;

/**
 * Every ranked lemma has a gloss: in a complete build a missing gloss within the top
 * GLOSS_REQUIRED_RANK is an issue, anything else a warning. No generated gloss is verified.
 */
export const glossCoverageCheck: Check = {
  id: 'dict.glosses',
  description: `Every ranked lemma has a gloss (required for the top ${GLOSS_REQUIRED_RANK} in a complete build); generated glosses are never marked verified`,
  async run(ctx) {
    if (!ctx.has('senses.jsonl')) {
      ctx.warn('no senses.jsonl');
      return;
    }
    const glossed = new Set<number>();
    for await (const { n, row } of ctx.rows('senses.jsonl')) {
      glossed.add(row.lemmaId);
      if (row.source === 'generated' && row.verified)
        ctx.issue(
          `senses.jsonl:${n}: a generated gloss of lemma ${row.lemmaId} is marked verified`,
        );
    }
    const required: string[] = [];
    const other: string[] = [];
    for await (const { row } of ctx.rows('lemmas.jsonl')) {
      if (row.freqRank === undefined || glossed.has(row.id)) continue;
      const list = ctx.complete && row.freqRank <= GLOSS_REQUIRED_RANK ? required : other;
      list.push(`${row.lemma} (${row.freqRank})`);
    }
    const say = (list: string[]) =>
      `${list.length} ranked lemmas have no gloss, e.g. ${list.slice(0, 10).join(', ')}`;
    if (required.length > 0) ctx.issue(`${say(required)}; run dict --fill (dry-run first)`);
    if (other.length > 0) ctx.warn(say(other));
  },
};

export const dictStage: Stage = {
  name: 'dict',
  description:
    'Wiktionary glosses, plus a model fill (content.glosses) for ranked lemmas without one',
  sources: [`${KAIKKI_SOURCE}/${KAIKKI_FILE}`],
  codeDir: codeDirOf(import.meta.url),
  options: {
    ...FILL_OPTIONS,
    'fill-limit': { type: 'string' },
    sample: { type: 'string' },
    glosses: { type: 'string' },
  },
  // The glosses file is an input that a fill also writes; the runner fingerprints it after
  // the run, so a run that added glosses is skipped next time.
  inputs: (ctx) => [...Object.values(inputsOf(ctx)), glossesPath(ctx)],
  outputs: (ctx) => ['senses.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  params: (ctx) => ({
    fill: fillModeOf(ctx),
    fillLimit: ctx.args['fill-limit'] ?? null,
    sample: ctx.args.sample ?? null,
    maxSpend: ctx.args['max-spend'] ?? null,
    // A dry run, a live fill and an offline fill always reach the model step, even when
    // nothing else changed.
    at: fillAlwaysRuns(ctx) ? ctx.now().toISOString() : null,
  }),
  run: runDict,
  parts: [{ file: 'senses.jsonl', path: (p) => join(p.build, 'dict', 'senses.jsonl') }],
  checks: [glossCoverageCheck],
};
