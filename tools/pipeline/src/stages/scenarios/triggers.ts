// Trigger ids as scenarios name them (docs/contracts.md, "Ids"): kind, word, and the case when a
// word has two, such as `prep-do`, `prep-na-acc`, `verb-pomahat`, `q-s-kym`. A scenario's
// target triggers must follow that convention and exist in the mini dataset or in C4's list.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CASES, type Case, type TriggerKind } from '@app/contracts';
import { parse as parseYaml } from 'yaml';
import { existsSync, readJsonl } from '../../lib/files';

/** The id prefix of each trigger kind. */
export const TRIGGER_PREFIX: Record<TriggerKind, string> = {
  preposition: 'prep',
  verb: 'verb',
  numeral: 'num',
  quantifier: 'quant',
  question: 'q',
  adjective: 'adj',
  noun: 'noun',
  function: 'fn',
};

/** Lower case ASCII segments joined by hyphens, after a known kind prefix. */
export const TRIGGER_ID = new RegExp(
  `^(?:${Object.values(TRIGGER_PREFIX).join('|')})(?:-[a-z0-9]+)+$`,
  'u',
);

export interface KnownTrigger {
  id: string;
  kind?: TriggerKind;
  case?: Case;
  /** Where it was found, for messages. */
  from: string;
}

/** Problems of one trigger id against the convention and, when known, its row. */
export function triggerIdProblems(id: string, known?: KnownTrigger): string[] {
  const problems: string[] = [];
  if (!TRIGGER_ID.test(id)) {
    problems.push(
      `trigger "${id}" does not follow the id convention (kind-word[-case], e.g. prep-na-acc)`,
    );
    return problems;
  }
  if (!known) return problems;
  if (known.kind && !id.startsWith(`${TRIGGER_PREFIX[known.kind]}-`))
    problems.push(
      `trigger "${id}" is a ${known.kind}, so its id starts with ${TRIGGER_PREFIX[known.kind]}-`,
    );
  const last = id.slice(id.lastIndexOf('-') + 1);
  if (known.case && (CASES as readonly string[]).includes(last) && last !== known.case)
    problems.push(`trigger "${id}" ends in -${last} but governs the ${known.case}`);
  return problems;
}

const isCase = (x: unknown): x is Case =>
  typeof x === 'string' && (CASES as readonly string[]).includes(x);

function toKnown(row: Record<string, unknown>, from: string): KnownTrigger | null {
  if (typeof row.id !== 'string' || !TRIGGER_ID.test(row.id)) return null;
  const kind = Object.keys(TRIGGER_PREFIX).includes(String(row.kind))
    ? (row.kind as TriggerKind)
    : undefined;
  const c = row.case ?? row.gCase ?? row.g_case;
  return { id: row.id, ...(kind ? { kind } : {}), ...(isCase(c) ? { case: c } : {}), from };
}

/** The rows of a triggers.jsonl file. */
export async function readTriggerRows(path: string, from: string): Promise<KnownTrigger[]> {
  const out: KnownTrigger[] = [];
  if (!existsSync(path)) return out;
  for await (const row of readJsonl<Record<string, unknown>>(path)) {
    const k = toKnown(row, from);
    if (k) out.push(k);
  }
  return out;
}

function collect(value: unknown, from: string, out: KnownTrigger[]): void {
  if (Array.isArray(value)) {
    for (const v of value) collect(v, from, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const k = toKnown(value as Record<string, unknown>, from);
  if (k) out.push(k);
  else for (const v of Object.values(value)) collect(v, from, out);
}

/**
 * C4's authored triggers: every object with a trigger-like `id` in the YAML files of the folder
 * (any depth). C4 owns their format; this reads only id, kind and case.
 */
export async function readAuthoredTriggers(dir: string): Promise<KnownTrigger[]> {
  const out: KnownTrigger[] = [];
  if (!existsSync(dir)) return out;
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.ya?ml$/u.test(e.name)) collect(parseYaml(await readFile(p, 'utf8')), p, out);
    }
  };
  await walk(dir);
  return out;
}

/** Merges lists by id; the first list that names an id wins. */
export function triggerMap(...lists: KnownTrigger[][]): Map<string, KnownTrigger> {
  const m = new Map<string, KnownTrigger>();
  for (const list of lists) for (const t of list) if (!m.has(t.id)) m.set(t.id, t);
  return m;
}
