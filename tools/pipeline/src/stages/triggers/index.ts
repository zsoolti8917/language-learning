// Stage 6, triggers: the authored YAML files in content/authored/triggers/ → the trigger rows
// of the content set (docs/contracts.md, ling.trigger). Each row gets the id of its lemma and
// its rank from the morphology, and is checked against it:
// - a preposition's case must be one of the cases the morphology gives it (flags.cases), and
//   every case it gives must have a row; a mismatch fails the build;
// - every word of the example is a known form, the example holds a form of the trigger, and
//   the word it governs has a reading in the trigger's case.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Case,
  CaseSchema,
  type Pos,
  type TriggerKind,
  TriggerKindSchema,
  type TriggerRow,
} from '@app/contracts';
import { formKey } from '@app/ling';
import { parse } from 'yaml';
import { z } from 'zod';
import { existsSync, JsonlWriter, readJsonl, stableJson, writeFileAtomic } from '../../lib/files';
import { codeDirOf, type Stage, type StageContext } from '../../lib/runner';
import type { Check } from '../../lib/validate';
import {
  CASE_DIGITS,
  findLemma,
  loadMorphology,
  MORPH_OPTION,
  type MorphLemma,
  type Morphology,
  morphFiles,
  morphInputs,
  wordsOf,
} from './morphology';

export const AuthoredTriggerSchema = z
  .object({
    id: z.string().regex(/^[a-z]+-[a-z0-9-]+$/u),
    kind: TriggerKindSchema.optional(),
    lemma: z.string().min(1),
    case: CaseSchema,
    meaningEn: z.string().min(1),
    noteEn: z.string().min(1).optional(),
    exampleSk: z.string().min(1),
    exampleEn: z.string().min(1),
    contrastGroup: z.string().min(1).optional(),
    /** The spellings that count as this trigger in a sentence, when not every form does. */
    forms: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type AuthoredTrigger = z.infer<typeof AuthoredTriggerSchema> & { kind: TriggerKind };

export const TriggerFileSchema = z
  .object({ kind: TriggerKindSchema, triggers: z.array(AuthoredTriggerSchema) })
  .strict();

/** The id prefix of each kind (docs/contracts.md, "Ids"). */
export const ID_PREFIX: Record<TriggerKind, string> = {
  preposition: 'prep',
  verb: 'verb',
  numeral: 'num',
  quantifier: 'quant',
  question: 'q',
  adjective: 'adj',
  noun: 'noun',
  function: 'fn',
};

/** Parts of speech a trigger's lemma may have, in order of preference. */
export const LEMMA_POS: Record<TriggerKind, readonly Pos[]> = {
  preposition: ['prep'],
  verb: ['verb'],
  numeral: ['num'],
  quantifier: ['num', 'adv', 'pron', 'noun'],
  question: ['pron', 'adv', 'num'],
  adjective: ['adj'],
  noun: ['noun'],
  function: ['conj', 'part', 'adv', 'pron', 'other'],
};

/** Kinds whose trigger stands right before the words it governs. */
export const ADJACENT_KINDS: ReadonlySet<TriggerKind> = new Set([
  'preposition',
  'numeral',
  'quantifier',
  'noun',
  'adjective',
]);

export const authoredDir = (ctx: Pick<StageContext, 'paths'>, what: string) =>
  join(ctx.paths.content, 'authored', what);
const out = (ctx: Pick<StageContext, 'paths'>, f: string) => join(ctx.paths.build, 'triggers', f);
export const triggersOut = (ctx: Pick<StageContext, 'paths'>) => out(ctx, 'triggers.jsonl');

/** Every YAML file of a folder, in name order. */
export async function yamlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  return (await readdir(dir))
    .filter((f) => /\.ya?ml$/u.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export async function readAuthoredTriggers(dir: string): Promise<AuthoredTrigger[]> {
  const out: AuthoredTrigger[] = [];
  for (const file of await yamlFiles(dir)) {
    const parsed = TriggerFileSchema.safeParse(parse(await readFile(file, 'utf8')));
    if (!parsed.success)
      throw new Error(
        `${file}: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    for (const t of parsed.data.triggers) out.push({ ...t, kind: t.kind ?? parsed.data.kind });
  }
  return out;
}

/** The lemma of a trigger in the morphology. */
export function triggerLemma(m: Morphology, t: { lemma: string; kind: TriggerKind }) {
  return findLemma(m, t.lemma, LEMMA_POS[t.kind]);
}

/**
 * The spellings (formKey) that count as the trigger in a sentence: the `forms` of the YAML,
 * else for a question word its forms in the trigger's case (koho, komu), else every form.
 */
export function triggerSpellings(
  m: Morphology,
  t: { lemma: string; kind: TriggerKind; case: Case; forms?: string[] },
  lemma: MorphLemma | undefined,
): Set<string> {
  if (t.forms) return new Set(t.forms.map(formKey));
  const map = lemma ? m.forms.get(lemma.id) : undefined;
  if (!map) return new Set([formKey(t.lemma)]);
  const all = Object.keys(map);
  if (t.kind === 'question') {
    const digit = String(CASE_DIGITS[t.case]);
    const inCase = all.filter((f) =>
      map[f]?.some((tag) => /^[spx]\d/u.test(tag) && tag[1] === digit),
    );
    if (inCase.length > 0) return new Set(inCase);
  }
  return new Set(all.length > 0 ? all : [formKey(t.lemma)]);
}

/** A form to show for the trigger: the 1st person singular for a verb, else the lemma. */
export function triggerSay(
  m: Morphology,
  t: { lemma: string; kind: TriggerKind; case: Case; forms?: string[] },
  lemma: MorphLemma | undefined,
): string {
  const spellings = triggerSpellings(m, t, lemma);
  const map = lemma ? m.forms.get(lemma.id) : undefined;
  if (t.kind === 'verb' && map) {
    const first = Object.keys(map)
      .filter((f) => map[f]?.some((tag) => /^v:K.sa\+$/u.test(tag)))
      .sort()[0];
    if (first) return first;
  }
  const own = formKey(t.lemma);
  if (spellings.has(own)) return own;
  return [...spellings].sort()[0] ?? own;
}

const hasCase = (m: Morphology, word: string, c: Case) =>
  ((m.words.get(formKey(word))?.cases ?? 0) & (1 << CASE_DIGITS[c])) !== 0;

/** Problems of one trigger's example sentence against the morphology. */
export function exampleProblems(
  m: Morphology,
  t: AuthoredTrigger,
  lemma: MorphLemma | undefined,
): string[] {
  const problems: string[] = [];
  const words = wordsOf(t.exampleSk);
  const unknown = words.filter((w) => !m.words.has(formKey(w.w))).map((w) => w.w);
  if (unknown.length > 0) problems.push(`unknown words in the example: ${unknown.join(', ')}`);
  if (!lemma) return problems;
  const spellings = triggerSpellings(m, t, lemma);
  const at = words.findIndex((w) => spellings.has(formKey(w.w)));
  if (at < 0) {
    problems.push(`the example has no form of ${t.lemma}`);
    return problems;
  }
  if (ADJACENT_KINDS.has(t.kind)) {
    const next = words.slice(at + 1, at + 3);
    if (!next.some((w) => hasCase(m, w.w, t.case)))
      problems.push(
        `no ${t.case} after ${words[at]?.w} in the example (${next.map((w) => w.w).join(' ')})`,
      );
  } else if (t.kind === 'verb') {
    const others = words.filter((w) => !spellings.has(formKey(w.w)));
    if (!others.some((w) => hasCase(m, w.w, t.case)))
      problems.push(`no word of the example is in the ${t.case}`);
  }
  return problems;
}

export interface BuiltTriggers {
  rows: TriggerRow[];
  /** Problems that fail a complete build. */
  problems: string[];
  /** Notes that never fail it. */
  notes: string[];
}

/** Builds and checks the trigger rows. */
export function buildTriggers(m: Morphology, authored: readonly AuthoredTrigger[]): BuiltTriggers {
  const problems: string[] = [];
  const notes: string[] = [];
  const rows: TriggerRow[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, AuthoredTrigger[]>();
  const casesByLemma = new Map<number, Set<Case>>();
  for (const t of authored) {
    const w = `trigger ${t.id}`;
    if (seen.has(t.id)) problems.push(`${w}: duplicate id`);
    seen.add(t.id);
    if (!t.id.startsWith(`${ID_PREFIX[t.kind]}-`))
      problems.push(`${w}: a ${t.kind} id starts with "${ID_PREFIX[t.kind]}-"`);
    if (t.contrastGroup) groups.set(t.contrastGroup, [...(groups.get(t.contrastGroup) ?? []), t]);
    const lemma = triggerLemma(m, t);
    if (!lemma)
      (m.complete ? problems : notes).push(`${w}: no lemma "${t.lemma}" in the morphology`);
    else {
      const set = casesByLemma.get(lemma.id) ?? new Set<Case>();
      set.add(t.case);
      casesByLemma.set(lemma.id, set);
    }
    for (const p of exampleProblems(m, t, lemma))
      (m.complete ? problems : notes).push(`${w}: ${p}`);
    if (t.kind === 'preposition' && lemma) {
      const cases = lemma.flags.cases as Case[] | undefined;
      if (!cases) (m.complete ? problems : notes).push(`${w}: ${t.lemma} has no flags.cases`);
      else if (!cases.includes(t.case))
        problems.push(
          `${w}: ${t.lemma} takes ${cases.join(', ')} in the morphology, not the ${t.case}`,
        );
    }
    const row: TriggerRow = {
      id: t.id,
      kind: t.kind,
      lemma: t.lemma,
      case: t.case,
      meaningEn: t.meaningEn,
      exampleSk: t.exampleSk,
      exampleEn: t.exampleEn,
    };
    if (lemma) row.lemmaId = lemma.id;
    if (t.noteEn) row.noteEn = t.noteEn;
    if (t.contrastGroup) row.contrastGroup = t.contrastGroup;
    if (lemma?.freqRank) row.freqRank = lemma.freqRank;
    rows.push(row);
  }
  for (const [g, list] of groups) {
    if (list.length < 2) problems.push(`contrast group ${g} has only ${list[0]?.id}`);
    if (new Set(list.map((t) => t.lemma)).size > 1)
      problems.push(`contrast group ${g} mixes lemmas: ${list.map((t) => t.id).join(', ')}`);
    if (new Set(list.map((t) => t.case)).size < list.length)
      problems.push(`contrast group ${g} repeats a case: ${list.map((t) => t.id).join(', ')}`);
  }
  // Every case the morphology gives a preposition that has triggers needs its own row.
  for (const [id, cases] of casesByLemma) {
    const l = m.lemmas.get(id) as MorphLemma;
    if (l.pos !== 'prep') continue;
    for (const c of (l.flags.cases as Case[] | undefined) ?? [])
      if (!cases.has(c))
        problems.push(
          `preposition ${l.lemma} takes the ${c} in the morphology, but no trigger has it`,
        );
  }
  return { rows, problems, notes };
}

export async function runTriggers(ctx: StageContext): Promise<Record<string, unknown>> {
  const files = morphFiles(ctx);
  const authored = await readAuthoredTriggers(authoredDir(ctx, 'triggers'));
  const lemmaTexts = new Set(authored.map((t) => t.lemma));
  const m = await loadMorphology(files, {
    formsFor: (l) => lemmaTexts.has(l.lemma),
    words: true,
  });
  const built = buildTriggers(m, authored);
  for (const n of built.notes.slice(0, 20)) ctx.log(`triggers: warning ${n}`);
  for (const p of built.problems.slice(0, 50)) ctx.log(`triggers: ${p}`);
  const counts: Record<string, number> = {};
  for (const r of built.rows)
    counts[`${r.kind}.${r.case}`] = (counts[`${r.kind}.${r.case}`] ?? 0) + 1;
  const summary = {
    morphology: m.source,
    complete: m.complete,
    triggers: built.rows.length,
    byKind: Object.fromEntries(
      Object.keys(ID_PREFIX)
        .map((k) => [k, built.rows.filter((r) => r.kind === k).length])
        .filter(([, n]) => n !== 0),
    ),
    counts,
    problems: built.problems,
    notes: built.notes,
  };
  await writeFileAtomic(out(ctx, 'report.json'), stableJson(summary));
  await writeFileAtomic(out(ctx, 'report.md'), renderReport(summary));
  if (built.problems.length > 0)
    throw new Error(
      `triggers: ${built.problems.length} problems, see ${out(ctx, 'report.md')}: ${built.problems.slice(0, 3).join('; ')}`,
    );
  const w = await JsonlWriter.open(triggersOut(ctx));
  for (const r of built.rows) await w.write(r);
  await w.close();
  ctx.log(`triggers: ${built.rows.length} triggers written (${JSON.stringify(summary.byKind)})`);
  return { triggers: built.rows.length, byKind: summary.byKind, notes: built.notes.length };
}

function renderReport(s: {
  morphology: string;
  triggers: number;
  byKind: Record<string, number>;
  counts: Record<string, number>;
  problems: string[];
  notes: string[];
}): string {
  const cases: Case[] = ['nom', 'gen', 'dat', 'acc', 'loc', 'ins'];
  const lines = [
    '# Triggers report',
    '',
    `${s.triggers} triggers from content/authored/triggers, checked against \`${s.morphology}\`.`,
    '',
    `| Kind | ${cases.join(' | ')} | All |`,
    `|---|${cases.map(() => '---:').join('|')}|---:|`,
    ...Object.entries(s.byKind).map(
      ([k, n]) => `| ${k} | ${cases.map((c) => s.counts[`${k}.${c}`] ?? 0).join(' | ')} | ${n} |`,
    ),
    '',
  ];
  if (s.problems.length > 0) lines.push('## Problems', '', ...s.problems.map((p) => `- ${p}`), '');
  if (s.notes.length > 0) lines.push('## Warnings', '', ...s.notes.map((p) => `- ${p}`), '');
  return `${lines.join('\n')}\n`;
}

/**
 * The cases of every preposition trigger agree with flags.cases of its lemma in lemmas.jsonl:
 * each trigger's case is one of them, and each of them has a trigger. Without flags.cases (the
 * mini dataset) this is a warning, except in a complete build.
 */
export const triggerCasesCheck: Check = {
  id: 'c4.trigger-cases',
  description:
    'Every preposition trigger agrees with the cases of its lemma in the morphology (flags.cases)',
  async run(ctx) {
    const cases = new Map<number, string[]>();
    const lemmas = new Map<number, string>();
    for await (const { row } of ctx.raw('lemmas.jsonl')) {
      if (row.pos !== 'prep' || typeof row.id !== 'number') continue;
      lemmas.set(row.id, String(row.lemma));
      const flags = row.flags as { cases?: string[] } | undefined;
      if (flags?.cases) cases.set(row.id, flags.cases);
    }
    const seen = new Map<number, Set<string>>();
    for await (const { n, row } of ctx.rows('triggers.jsonl')) {
      if (row.kind !== 'preposition') continue;
      const w = `triggers.jsonl:${n} (${row.id})`;
      if (row.lemmaId === undefined) {
        (ctx.complete ? ctx.issue : ctx.warn)(`${w}: no lemmaId`);
        continue;
      }
      const set = seen.get(row.lemmaId) ?? new Set<string>();
      set.add(row.case);
      seen.set(row.lemmaId, set);
      const known = cases.get(row.lemmaId);
      if (!known)
        (ctx.complete ? ctx.issue : ctx.warn)(`${w}: lemma ${row.lemmaId} has no flags.cases`);
      else if (!known.includes(row.case))
        ctx.issue(
          `${w}: ${row.lemma} takes ${known.join(', ')} in the morphology, not the ${row.case}`,
        );
    }
    for (const [id, got] of seen)
      for (const c of cases.get(id) ?? [])
        if (!got.has(c))
          ctx.issue(`preposition ${lemmas.get(id)} (${id}) takes the ${c}, but no trigger has it`);
  },
};

export const triggersStage: Stage = {
  name: 'triggers',
  description: 'Prepositions, verbs, numerals and question words with their cases (authored YAML)',
  codeDir: codeDirOf(import.meta.url),
  options: { ...MORPH_OPTION },
  inputs: (ctx) => [authoredDir(ctx, 'triggers'), ...morphInputs(morphFiles(ctx))],
  outputs: (ctx) => [triggersOut(ctx), out(ctx, 'report.md'), out(ctx, 'report.json')],
  params: (ctx) => ({ morph: ctx.args.morph ?? null }),
  run: runTriggers,
  parts: [{ file: 'triggers.jsonl', path: (p) => join(p.build, 'triggers', 'triggers.jsonl') }],
  checks: [triggerCasesCheck],
};

/** Reads the trigger rows the stage wrote. */
export async function readTriggerRows(path: string): Promise<TriggerRow[]> {
  if (!existsSync(path)) throw new Error(`${path} does not exist; run the triggers stage first`);
  const rows: TriggerRow[] = [];
  for await (const r of readJsonl<TriggerRow>(path)) rows.push(r);
  return rows;
}
