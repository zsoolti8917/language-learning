// The validation framework: a content set folder is checked by a list of checks. The core
// checks below cover the content schemas, unique ids, links between files and the lemma
// registry; every stage can add checks of its own (Stage.checks), and validate runs them all.
import { join } from 'node:path';
import {
  CONTENT_FILES,
  type ContentFileName,
  type FormRow,
  type LemmaRow,
  type LessonRow,
  type Pos,
} from '@app/contracts';
import { ContentValidationError, validateContent } from '@app/db';
import { splitTags, tryParseTag } from '@app/ling';
import type { z } from 'zod';
import { existsSync, readJsonl } from './files';
import type { LemmaRegistry } from './registry';

export type RowOf<F extends ContentFileName> = z.output<(typeof CONTENT_FILES)[F]>;

/** What a check sees of the set it checks. */
export interface CheckContext {
  dir: string;
  /** True when the file exists in the set. */
  has(file: ContentFileName): boolean;
  /** Rows parsed with their content schema, with their line number. Invalid rows are skipped. */
  rows<F extends ContentFileName>(file: F): AsyncGenerator<{ n: number; row: RowOf<F> }>;
  /** Rows as written, before parsing (keys the schema does not know are kept). */
  raw(file: ContentFileName): AsyncGenerator<{ n: number; row: Record<string, unknown> }>;
  /** Ids of the set, built once and shared by every check. */
  index(): Promise<SetIndex>;
  /** The lemma registry, when the run has one. */
  registry: LemmaRegistry | null;
  /** True when the set claims to hold every lemma of the registry (the full build). */
  complete: boolean;
  /** Reports a problem: the set fails. */
  issue(message: string): void;
  /** Reports something worth a look: the set still passes. */
  warn(message: string): void;
}

export interface Check {
  /** Short id, such as 'links' or 'morph.prep-cases'. */
  id: string;
  description: string;
  run(ctx: CheckContext): Promise<void>;
}

export interface SetIndex {
  lemmas: Map<number, { key: string; pos: Pos; lemma: string }>;
  patterns: Set<string>;
  triggers: Set<string>;
  lessons: Set<string>;
  exercises: Set<string>;
  sentences: Set<string>;
}

export interface CheckIssue {
  check: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: CheckIssue[];
  warnings: CheckIssue[];
  /** Issues per check, including the ones beyond the kept limit. */
  issueCounts: Record<string, number>;
  ms: Record<string, number>;
}

const MAX_KEPT = 200;

export async function validateSet(
  dir: string,
  checks: readonly Check[],
  opts: { registry?: LemmaRegistry | null; complete?: boolean } = {},
): Promise<ValidationResult> {
  const issues: CheckIssue[] = [];
  const warnings: CheckIssue[] = [];
  const issueCounts: Record<string, number> = {};
  const ms: Record<string, number> = {};
  let index: Promise<SetIndex> | null = null;
  let current = '';

  const has = (file: ContentFileName) => existsSync(join(dir, file));
  async function* raw(file: ContentFileName) {
    if (!has(file)) return;
    let n = 0;
    for await (const row of readJsonl<Record<string, unknown>>(join(dir, file))) {
      n++;
      yield { n, row };
    }
  }
  async function* rows<F extends ContentFileName>(file: F) {
    const schema = CONTENT_FILES[file];
    for await (const { n, row } of raw(file)) {
      const r = schema.safeParse(row);
      if (r.success) yield { n, row: r.data as RowOf<F> };
    }
  }
  const ctx: CheckContext = {
    dir,
    has,
    rows,
    raw,
    registry: opts.registry ?? null,
    complete: opts.complete ?? false,
    index: () => {
      index ??= buildIndex(rows);
      return index;
    },
    issue: (message) => {
      issueCounts[current] = (issueCounts[current] ?? 0) + 1;
      if (issues.length < MAX_KEPT) issues.push({ check: current, message });
    },
    warn: (message) => {
      if (warnings.length < MAX_KEPT) warnings.push({ check: current, message });
    },
  };
  for (const check of checks) {
    current = check.id;
    const t = performance.now();
    try {
      await check.run(ctx);
    } catch (e) {
      ctx.issue(`check failed to run: ${(e as Error).message}`);
    }
    ms[check.id] = Math.round(performance.now() - t);
  }
  return { ok: Object.keys(issueCounts).length === 0, issues, warnings, issueCounts, ms };
}

async function buildIndex(
  rows: <F extends ContentFileName>(file: F) => AsyncGenerator<{ n: number; row: RowOf<F> }>,
): Promise<SetIndex> {
  const idx: SetIndex = {
    lemmas: new Map(),
    patterns: new Set(),
    triggers: new Set(),
    lessons: new Set(),
    exercises: new Set(),
    sentences: new Set(),
  };
  for await (const { row } of rows('lemmas.jsonl'))
    idx.lemmas.set(row.id, { key: row.key, pos: row.pos, lemma: row.lemma });
  for await (const { row } of rows('patterns.jsonl')) idx.patterns.add(row.id);
  for await (const { row } of rows('triggers.jsonl')) idx.triggers.add(row.id);
  for await (const { row } of rows('lessons.jsonl')) idx.lessons.add(row.id);
  for await (const { row } of rows('exercises.jsonl')) idx.exercises.add(row.id);
  for await (const { row } of rows('sentences.jsonl')) idx.sentences.add(row.id);
  return idx;
}

// --- Core checks ---------------------------------------------------------------------------

/** Every row parses with its content schema; the manifest parses and its counts match. */
export const schemaCheck: Check = {
  id: 'schema',
  description: 'Every row parses with its content schema, and the manifest counts match',
  async run(ctx) {
    try {
      await validateContent(ctx.dir);
    } catch (e) {
      if (e instanceof ContentValidationError) for (const i of e.issues) ctx.issue(i);
      else throw e;
    }
  },
};

/** Primary keys are unique in every file. */
export const uniqueCheck: Check = {
  id: 'unique',
  description: 'Ids and keys are unique in every file',
  async run(ctx) {
    const seen = async <F extends ContentFileName>(file: F, keyOf: (r: RowOf<F>) => string[]) => {
      const sets: Set<string>[] = [];
      for await (const { n, row } of ctx.rows(file)) {
        keyOf(row).forEach((k, i) => {
          sets[i] ??= new Set();
          const s = sets[i] as Set<string>;
          if (s.has(k)) ctx.issue(`${file}:${n}: duplicate ${k}`);
          else s.add(k);
        });
      }
    };
    await seen('lemmas.jsonl', (r) => [`id ${r.id}`, `key ${r.key}`]);
    await seen('forms.jsonl', (r: FormRow) => [`form ${r.lemmaId} ${r.form}`]);
    await seen('senses.jsonl', (r) => [`sense ${r.lemmaId}/${r.ord}`]);
    await seen('sentences.jsonl', (r) => [`id ${r.id}`]);
    await seen('triggers.jsonl', (r) => [`id ${r.id}`]);
    await seen('patterns.jsonl', (r) => [`id ${r.id}`]);
    await seen('lessons.jsonl', (r: LessonRow) => {
      const ords = r.steps.map((s) => s.ord);
      if (new Set(ords).size !== ords.length)
        ctx.issue(`lessons.jsonl: ${r.id} repeats a step ord`);
      return [`id ${r.id}`];
    });
    await seen('exercises.jsonl', (r) => [`id ${r.id}`]);
    await seen('scenarios.jsonl', (r) => [`id ${r.id}`]);
    await seen('library.jsonl', (r) => [`id ${r.id}`]);
  },
};

/** Every id that points at another row finds it. */
export const linksCheck: Check = {
  id: 'links',
  description: 'Every lemma, pattern, trigger, lesson, exercise and sentence id resolves',
  async run(ctx) {
    const idx = await ctx.index();
    const lemma = (where: string, id: number | undefined) => {
      if (id !== undefined && !idx.lemmas.has(id))
        ctx.issue(`${where}: lemma ${id} is not in lemmas.jsonl`);
    };
    const ref = (where: string, set: Set<string>, what: string, id: string | undefined) => {
      if (id !== undefined && !set.has(id)) ctx.issue(`${where}: ${what} "${id}" does not exist`);
    };
    const patternsKnown = ctx.has('patterns.jsonl');
    const missingPatterns = new Map<string, number>();
    for await (const { n, row } of ctx.rows('lemmas.jsonl')) {
      if (row.pattern === undefined) continue;
      if (patternsKnown) ref(`lemmas.jsonl:${n}`, idx.patterns, 'pattern', row.pattern);
      else missingPatterns.set(row.pattern, (missingPatterns.get(row.pattern) ?? 0) + 1);
    }
    if (missingPatterns.size > 0)
      ctx.warn(
        `no patterns.jsonl in the set, so lemma patterns are unchecked: ${[...missingPatterns.keys()].sort().join(', ')}`,
      );
    for await (const { n, row } of ctx.rows('forms.jsonl')) {
      if (!idx.lemmas.has(row.lemmaId)) lemma(`forms.jsonl:${n}`, row.lemmaId);
    }
    for await (const { n, row } of ctx.rows('senses.jsonl'))
      lemma(`senses.jsonl:${n}`, row.lemmaId);
    for await (const { n, row } of ctx.rows('sentences.jsonl')) {
      const w = `sentences.jsonl:${n} (${row.id})`;
      for (const t of row.tokens) {
        lemma(w, t.lemmaId);
        if (t.e < t.s || t.e > row.textSk.length)
          ctx.issue(`${w}: token ${t.s}-${t.e} outside the text`);
      }
      for (const l of row.links) {
        lemma(w, l.lemmaId);
        const tok = row.tokens[l.tokenIndex];
        if (!tok) ctx.issue(`${w}: link to token ${l.tokenIndex}, which does not exist`);
        else if (row.textSk.slice(tok.s, tok.e) !== l.form)
          ctx.issue(`${w}: link form "${l.form}" is not the text of token ${l.tokenIndex}`);
      }
    }
    for await (const { n, row } of ctx.rows('triggers.jsonl'))
      lemma(`triggers.jsonl:${n}`, row.lemmaId);
    for await (const { n, row } of ctx.rows('patterns.jsonl')) {
      lemma(`patterns.jsonl:${n}`, row.modelLemmaId);
      lemma(`patterns.jsonl:${n}`, row.everydayModelLemmaId);
    }
    for await (const { n, row } of ctx.rows('lessons.jsonl')) {
      const w = `lessons.jsonl:${n} (${row.id})`;
      for (const p of row.prerequisites) ref(w, idx.lessons, 'lesson', p);
      for (const t of row.focus.triggerIds) ref(w, idx.triggers, 'trigger', t);
      for (const s of row.steps) {
        const c = s.content;
        if (c.kind === 'triggers') for (const t of c.triggerIds) ref(w, idx.triggers, 'trigger', t);
        else if (c.kind !== 'explain')
          for (const x of c.exerciseIds) ref(w, idx.exercises, 'exercise', x);
      }
    }
    for await (const { n, row } of ctx.rows('exercises.jsonl')) {
      const w = `exercises.jsonl:${n} (${row.id})`;
      for (const id of row.target.lemmaIds) lemma(w, id);
      ref(w, idx.triggers, 'trigger', row.triggerId);
      ref(w, idx.lessons, 'lesson', row.lessonId);
      if (patternsKnown) ref(w, idx.patterns, 'pattern', row.pattern);
      if (row.target.end > row.sentenceSk.length || row.target.start > row.target.end)
        ctx.issue(`${w}: target ${row.target.start}-${row.target.end} outside the sentence`);
    }
    for await (const { n, row } of ctx.rows('scenarios.jsonl'))
      for (const t of row.targetTriggers) ref(`scenarios.jsonl:${n}`, idx.triggers, 'trigger', t);
    for await (const { n, row } of ctx.rows('library.jsonl')) {
      const w = `library.jsonl:${n} (${row.id})`;
      for (const id of Object.keys(row.lemmaCounts ?? {})) lemma(w, Number(id));
      if (row.analysis) {
        for (const id of Object.keys(row.analysis.lemmas)) lemma(w, Number(id));
        for (const s of row.analysis.sentences)
          for (const t of s.tokens) {
            lemma(w, t.l);
            if (t.trig?.id) ref(w, idx.triggers, 'trigger', t.trig.id);
          }
      }
    }
  },
};

const NOUN_TAG = /^[sp][1-7]$/u;
const AGREE_TAG = /^(?:[sp][1-7][mifn]|x[1-7])$/u;

/** Form tags fit the part of speech of their lemma (docs/contracts.md, "Form tags"). */
export const tagsCheck: Check = {
  id: 'tags',
  description: 'Every form tag parses and fits the part of speech of its lemma',
  async run(ctx) {
    const idx = await ctx.index();
    const fits = (pos: Pos, tag: string): boolean => {
      switch (pos) {
        case 'noun':
          return NOUN_TAG.test(tag);
        case 'adj':
        case 'pron':
        case 'num':
          return AGREE_TAG.test(tag);
        case 'verb':
          return tag.startsWith('v:');
        default:
          return false;
      }
    };
    for await (const { n, row } of ctx.rows('forms.jsonl')) {
      const l = idx.lemmas.get(row.lemmaId);
      if (!l) continue;
      for (const tag of splitTags(row.tags)) {
        if (!tryParseTag(tag)) ctx.issue(`forms.jsonl:${n}: tag "${tag}" does not parse`);
        else if (!fits(l.pos, tag))
          ctx.issue(
            `forms.jsonl:${n}: tag "${tag}" does not fit a ${l.pos} (${row.form}, lemma ${row.lemmaId})`,
          );
      }
    }
  },
};

/** Lemma ids agree with the registry; in a complete set, no registered id disappears. */
export const registryCheck: Check = {
  id: 'registry',
  description: 'Lemma ids and keys agree with content/registry/lemma-ids.tsv, and none disappears',
  async run(ctx) {
    const reg = ctx.registry;
    if (!reg) {
      ctx.warn('no lemma registry given, so lemma ids are unchecked');
      return;
    }
    const seen = new Set<number>();
    for await (const { n, row } of ctx.rows('lemmas.jsonl')) {
      seen.add(row.id);
      const key = reg.keyOf(row.id);
      if (key === undefined)
        ctx.issue(`lemmas.jsonl:${n}: id ${row.id} (${row.key}) is not in the registry`);
      else if (key !== row.key)
        ctx.issue(
          `lemmas.jsonl:${n}: id ${row.id} has key "${row.key}", the registry says "${key}"`,
        );
    }
    if (ctx.complete)
      for (const [id, key] of reg.entries())
        if (!seen.has(id)) ctx.issue(`registry id ${id} (${key}) is missing from lemmas.jsonl`);
  },
};

/** The checks every set gets, in order. */
export const CORE_CHECKS: readonly Check[] = [
  schemaCheck,
  uniqueCheck,
  linksCheck,
  tagsCheck,
  registryCheck,
];

/** A lemma row as written, flags included (a type guard for raw rows). */
export function isLemmaLike(
  row: Record<string, unknown>,
): row is LemmaRow & Record<string, unknown> {
  return typeof row.id === 'number' && typeof row.key === 'string';
}
