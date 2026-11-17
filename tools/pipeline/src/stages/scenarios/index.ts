// Stage 9, scenarios: the tutor's scenarios and case coach sets (docs/work-packages.md, C5).
// One YAML file per scenario in content/authored/scenarios/, named after its id, holds every
// field of ling.scenario as the content file has it (camelCase). The stage parses them,
// checks them and writes content/build/scenarios/scenarios.jsonl.
//
// Rules: 3 or 4 success criteria with distinct ids, at least 3 vocabulary hints, target cases
// and target triggers without repeats, and every trigger following the id convention and found
// in the mini dataset or in C4's list (content/authored/triggers/), with its case among the
// target cases. The starter set is 8 goal based scenarios and 4 case coach sets.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ScenarioRow, ScenarioRowSchema } from '@app/contracts';
import { parse as parseYaml } from 'yaml';
import { existsSync, JsonlWriter, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import type { Check, CheckContext } from '../../lib/validate';
import { scenarioSlovak, setVocabulary } from '../library/setvocab';
import { profileText } from '../library/vocab';
import {
  type KnownTrigger,
  readAuthoredTriggers,
  readTriggerRows,
  triggerIdProblems,
  triggerMap,
} from './triggers';

export const SCENARIO_TARGET = { scenario: 8, case_coach: 4 } as const;
export const SCENARIO_LEVELS = ['A2', 'B1'] as const;
export const MIN_CRITERIA = 3;
export const MAX_CRITERIA = 4;
export const MIN_VOCAB_HINTS = 3;

const out = (ctx: StageContext, f: string) => join(ctx.paths.build, 'scenarios', f);

export function scenariosDir(ctx: StageContext): string {
  return join(ctx.paths.content, 'authored', 'scenarios');
}
/** C4's authored triggers. */
export function authoredTriggersDir(ctx: StageContext): string {
  return join(ctx.paths.content, 'authored', 'triggers');
}
export function miniTriggersPath(ctx: StageContext): string {
  return join(ctx.paths.mini, 'triggers.jsonl');
}

/** The triggers a scenario may name: the mini dataset's, then C4's. */
export async function knownTriggers(
  miniPath: string,
  authoredDir: string,
): Promise<Map<string, KnownTrigger>> {
  return triggerMap(
    await readTriggerRows(miniPath, 'the mini dataset'),
    await readAuthoredTriggers(authoredDir),
  );
}

/** Parses one authored scenario file. Throws with the file name when it is malformed. */
export function parseScenario(file: string, content: string): ScenarioRow {
  let data: unknown;
  try {
    data = parseYaml(content);
  } catch (e) {
    throw new Error(`${file}: not YAML: ${(e as Error).message}`);
  }
  const r = ScenarioRowSchema.strict().safeParse(data);
  if (!r.success)
    throw new Error(
      `${file}: ${r.error.issues.map((i) => `${i.path.join('.') || 'scenario'}: ${i.message}`).join('; ')}`,
    );
  if (file.replace(/\.ya?ml$/u, '') !== r.data.id)
    throw new Error(`${file}: the file name must be the id, ${r.data.id}.yaml`);
  return r.data;
}

export async function readScenarios(dir: string): Promise<ScenarioRow[]> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const files = (await readdir(dir)).filter((f) => /\.ya?ml$/u.test(f)).sort();
  const rows: ScenarioRow[] = [];
  for (const f of files) rows.push(parseScenario(f, await readFile(join(dir, f), 'utf8')));
  return rows;
}

const dupes = <T>(xs: readonly T[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/**
 * The problems of one scenario. `shape` covers the counts the starter set promises (criteria,
 * hints, level); the trigger rules always apply. `triggers` is null when no list is at hand.
 */
export function scenarioProblems(
  row: ScenarioRow,
  triggers: ReadonlyMap<string, KnownTrigger> | null,
): { shape: string[]; triggers: string[] } {
  const shape: string[] = [];
  const trig: string[] = [];
  const n = row.successCriteria.length;
  if (n < MIN_CRITERIA || n > MAX_CRITERIA)
    shape.push(`${n} success criteria, not ${MIN_CRITERIA} or ${MAX_CRITERIA}`);
  for (const d of dupes(row.successCriteria.map((c) => c.id)))
    shape.push(`success criterion id "${d}" is used twice`);
  for (const c of row.successCriteria)
    if (c.textEn.trim() === '') shape.push(`success criterion "${c.id}" has no text`);
  if (row.vocabHint.length < MIN_VOCAB_HINTS)
    shape.push(`${row.vocabHint.length} vocabulary hints, fewer than ${MIN_VOCAB_HINTS}`);
  if (!(SCENARIO_LEVELS as readonly string[]).includes(row.level))
    shape.push(`level ${row.level}, not ${SCENARIO_LEVELS.join(' or ')}`);
  if (row.targetCases.length === 0) shape.push('no target cases');
  for (const d of dupes(row.targetCases)) shape.push(`target case ${d} is listed twice`);
  if (row.targetTriggers.length === 0) trig.push('no target triggers');
  for (const d of dupes(row.targetTriggers)) trig.push(`target trigger ${d} is listed twice`);
  for (const id of row.targetTriggers) {
    const known = triggers?.get(id);
    trig.push(...triggerIdProblems(id, known));
    if (!triggers) continue;
    if (!known) trig.push(`trigger "${id}" is neither in the mini dataset nor in C4's list`);
    else if (known.case && !row.targetCases.includes(known.case))
      trig.push(`trigger "${id}" governs the ${known.case}, which is not a target case`);
  }
  return { shape, triggers: trig };
}

/** Problems across the set: repeated ids and ords, and the 8 + 4 the starter set needs. */
export function setProblems(rows: readonly ScenarioRow[]): string[] {
  const problems: string[] = [];
  for (const d of dupes(rows.map((r) => r.id))) problems.push(`scenario id ${d} is used twice`);
  for (const d of dupes(rows.map((r) => r.ord))) problems.push(`scenario ord ${d} is used twice`);
  for (const [mode, want] of Object.entries(SCENARIO_TARGET)) {
    const have = rows.filter((r) => r.mode === mode).length;
    if (have < want)
      problems.push(`${have} scenarios of mode ${mode}; the starter set needs ${want}`);
  }
  return problems;
}

export async function runScenarios(ctx: StageContext): Promise<Record<string, unknown>> {
  const rows = (await readScenarios(scenariosDir(ctx))).sort((a, b) => a.ord - b.ord);
  const triggers = await knownTriggers(miniTriggersPath(ctx), authoredTriggersDir(ctx));
  const problems: string[] = [];
  for (const r of rows) {
    const p = scenarioProblems(r, triggers);
    for (const m of [...p.shape, ...p.triggers]) problems.push(`${r.id}: ${m}`);
  }
  problems.push(...setProblems(rows));
  const summary = {
    scenarios: rows.length,
    modes: Object.fromEntries(
      Object.keys(SCENARIO_TARGET).map((m) => [m, rows.filter((r) => r.mode === m).length]),
    ),
    knownTriggers: triggers.size,
    triggerSources: [...new Set([...triggers.values()].map((t) => t.from))],
    problems,
    rows: rows.map((r) => ({
      id: r.id,
      mode: r.mode,
      level: r.level,
      targetCases: r.targetCases,
      targetTriggers: r.targetTriggers,
      criteria: r.successCriteria.length,
    })),
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(summary));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary));
  if (problems.length > 0) {
    for (const p of problems) ctx.log(`scenarios: ${p}`);
    throw new Error(`scenarios: ${problems.length} problems, see ${out(ctx, 'report.md')}`);
  }
  const w = await JsonlWriter.open(out(ctx, 'scenarios.jsonl'));
  for (const r of rows) await w.write(r);
  await w.close();
  ctx.log(
    `scenarios: ${rows.length} scenarios (${JSON.stringify(summary.modes)}), ${triggers.size} known triggers`,
  );
  return { scenarios: rows.length, modes: summary.modes };
}

function renderReport(s: {
  scenarios: number;
  knownTriggers: number;
  triggerSources: string[];
  problems: string[];
  rows: {
    id: string;
    mode: string;
    level: string;
    targetCases: string[];
    targetTriggers: string[];
    criteria: number;
  }[];
}): string {
  const lines = [
    '# Scenarios report',
    '',
    `${s.scenarios} scenarios. Target triggers checked against ${s.knownTriggers} known triggers (${s.triggerSources.join(', ') || 'none'}).`,
    '',
    '| Id | Mode | Level | Cases | Triggers | Criteria |',
    '|---|---|---|---|---|---:|',
    ...s.rows.map(
      (r) =>
        `| ${r.id} | ${r.mode} | ${r.level} | ${r.targetCases.join(', ')} | ${r.targetTriggers.join(', ')} | ${r.criteria} |`,
    ),
    '',
  ];
  if (s.problems.length > 0) lines.push('## Problems', '', ...s.problems.map((p) => `- ${p}`), '');
  return `${lines.join('\n')}\n`;
}

// --- Checks --------------------------------------------------------------------------------

const target = (ctx: CheckContext, message: string) =>
  ctx.complete ? ctx.issue(message) : ctx.warn(message);

/**
 * The scenario rules on the assembled set. Trigger rules are always issues; the counts the
 * starter set promises are issues in a complete build only (the mini dataset has two short
 * scenarios). Triggers are looked up in the set's triggers.jsonl.
 */
export const scenarioRulesCheck: Check = {
  id: 'scenarios.rules',
  description: `Trigger ids follow the convention and govern a target case; ${MIN_CRITERIA} or ${MAX_CRITERIA} success criteria; ${SCENARIO_TARGET.scenario} scenarios and ${SCENARIO_TARGET.case_coach} case coach sets`,
  async run(ctx) {
    if (!ctx.has('scenarios.jsonl')) {
      target(ctx, 'no scenarios.jsonl in the set');
      return;
    }
    let triggers: Map<string, KnownTrigger> | null = null;
    if (ctx.has('triggers.jsonl')) {
      triggers = new Map();
      for await (const { row } of ctx.rows('triggers.jsonl'))
        triggers.set(row.id, {
          id: row.id,
          kind: row.kind,
          case: row.case,
          from: 'triggers.jsonl',
        });
    } else
      ctx.warn(
        'no triggers.jsonl in the set: only the id convention of target triggers is checked',
      );
    const rows: ScenarioRow[] = [];
    for await (const { n, row } of ctx.rows('scenarios.jsonl')) {
      rows.push(row);
      const p = scenarioProblems(row, triggers);
      for (const m of p.triggers) ctx.issue(`scenarios.jsonl:${n} (${row.id}): ${m}`);
      for (const m of p.shape) target(ctx, `scenarios.jsonl:${n} (${row.id}): ${m}`);
    }
    for (const m of setProblems(rows)) target(ctx, `scenarios.jsonl: ${m}`);
  },
};

/** The Slovak a learner reads in a scenario (titles, setting, opening, hints) is made of known forms. */
export const scenarioSlovakCheck: Check = {
  id: 'scenarios.slovak',
  description:
    'Every word of the Slovak title, setting, opening line and vocabulary hints is a known form',
  async run(ctx) {
    if (!ctx.has('scenarios.jsonl')) return;
    const { index, lemmas } = await setVocabulary(ctx);
    for await (const { n, row } of ctx.raw('scenarios.jsonl')) {
      const unknown = new Set<string>();
      for (const text of scenarioSlovak(row))
        for (const u of profileText(text, index, lemmas).unknown) unknown.add(u);
      if (unknown.size > 0)
        target(
          ctx,
          `scenarios.jsonl:${n} (${String(row.id)}): not a known form: ${[...unknown].join(', ')}`,
        );
    }
  },
};

export const scenariosStage: Stage = {
  name: 'scenarios',
  description: 'Tutor scenarios and case coach sets from authored YAML',
  codeDir: codeDirOf(import.meta.url),
  inputs: (ctx) => [scenariosDir(ctx), miniTriggersPath(ctx), authoredTriggersDir(ctx)],
  outputs: (ctx) => ['scenarios.jsonl', 'report.md', 'report.json'].map((f) => out(ctx, f)),
  run: runScenarios,
  parts: [{ file: 'scenarios.jsonl', path: (p) => join(p.build, 'scenarios', 'scenarios.jsonl') }],
  checks: [scenarioRulesCheck, scenarioSlovakCheck],
};
