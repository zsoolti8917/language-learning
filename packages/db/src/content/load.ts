// loadContent(db, folder): validates a content set with the contract schemas, then upserts
// it into schema `ling` in one transaction and records the content version.
//
// Rules (docs/contracts.md, schema ling): loads are upserts and never delete a lemma, a
// sentence or an exercise. Rows that did not change are not written at all, so a second
// load of the same set changes nothing. Only the children of a loaded parent that
// vanished from it (lesson steps of a lesson, lemma links of a sentence) are removed.
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  CONTENT_FILES,
  type ContentFileName,
  type ExerciseRow,
  type FormRow,
  foldAscii,
  type LemmaRow,
  type LessonRow,
  type LibraryRow,
  MANIFEST_FILE,
  type Manifest,
  ManifestSchema,
  type PatternRow,
  type ScenarioRow,
  type SenseRow,
  type SentenceRow,
  type TriggerRow,
} from '@app/contracts';
import { desc, getTableColumns, getTableName, type SQL, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { Database, Db, Tx } from '../client';
import * as ling from '../schema/ling';

export interface LoadResult {
  version: string;
  /** Rows read per file, keyed by file name without extension. */
  rows: Record<string, number>;
  /** False when this exact version was already the latest one loaded. */
  versionWritten: boolean;
}

export class ContentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`content set is invalid (${issues.length} issues):\n${issues.slice(0, 20).join('\n')}`);
    this.name = 'ContentValidationError';
  }
}

const MAX_ISSUES = 200;

type Line = { n: number; value: unknown };

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function* readJsonl(path: string): AsyncGenerator<Line | { n: number; error: string }> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  let n = 0;
  for await (const raw of rl) {
    n++;
    const line = raw.trim();
    if (line === '') continue;
    try {
      yield { n, value: JSON.parse(line) };
    } catch (e) {
      yield { n, error: `not JSON: ${(e as Error).message}` };
    }
  }
}

/** Parsed rows of one file, streamed. Throws on the first invalid row (validated before). */
async function* rowsOf<F extends ContentFileName>(
  folder: string,
  file: F,
): AsyncGenerator<RowOf<F>> {
  const path = join(folder, file);
  if (!(await exists(path))) return;
  const schema = CONTENT_FILES[file];
  for await (const l of readJsonl(path)) {
    if ('error' in l) throw new Error(`${file}:${l.n}: ${l.error}`);
    yield schema.parse(l.value) as RowOf<F>;
  }
}

type RowOf<F extends ContentFileName> = {
  'lemmas.jsonl': LemmaRow;
  'forms.jsonl': FormRow;
  'senses.jsonl': SenseRow;
  'sentences.jsonl': SentenceRow;
  'triggers.jsonl': TriggerRow;
  'patterns.jsonl': PatternRow;
  'lessons.jsonl': LessonRow;
  'exercises.jsonl': ExerciseRow;
  'scenarios.jsonl': ScenarioRow;
  'library.jsonl': LibraryRow;
}[F];

const baseName = (file: string) => file.replace(/\.jsonl?$/u, '');

/** Validates every row of every file and the manifest. Returns the manifest and counts. */
export async function validateContent(
  folder: string,
): Promise<{ manifest: Manifest; rows: Record<string, number> }> {
  const issues: string[] = [];
  const push = (s: string) => {
    if (issues.length < MAX_ISSUES) issues.push(s);
  };
  let manifest: Manifest | null = null;
  const manifestPath = join(folder, MANIFEST_FILE);
  if (!(await exists(manifestPath))) push(`${MANIFEST_FILE}: missing`);
  else {
    try {
      const parsed = ManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, 'utf8')));
      if (parsed.success) manifest = parsed.data;
      else push(`${MANIFEST_FILE}: ${parsed.error.message}`);
    } catch (e) {
      push(`${MANIFEST_FILE}: not JSON: ${(e as Error).message}`);
    }
  }
  const rows: Record<string, number> = {};
  for (const file of Object.keys(CONTENT_FILES) as ContentFileName[]) {
    const path = join(folder, file);
    let count = 0;
    if (await exists(path)) {
      const schema = CONTENT_FILES[file];
      for await (const l of readJsonl(path)) {
        count++;
        if ('error' in l) {
          push(`${file}:${l.n}: ${l.error}`);
          continue;
        }
        const r = schema.safeParse(l.value);
        if (!r.success)
          for (const issue of r.error.issues)
            push(`${file}:${l.n}: ${issue.path.join('.') || '(row)'}: ${issue.message}`);
      }
    }
    rows[baseName(file)] = count;
  }
  if (manifest)
    for (const [name, expected] of Object.entries(manifest.counts)) {
      if (name in rows && rows[name] !== expected)
        push(
          `${MANIFEST_FILE}: counts.${name} is ${expected}, but the file has ${rows[name]} rows`,
        );
    }
  if (issues.length > 0 || !manifest) throw new ContentValidationError(issues);
  return { manifest, rows };
}

// --- Upserts -----------------------------------------------------------------

/**
 * Inserts rows; on a key conflict updates the row only when a column differs, so an
 * unchanged row is never rewritten.
 */
async function upsert(tx: Tx, table: PgTable, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const { primaryKeys, columns: cols } = getTableConfig(table);
  const pk = primaryKeys[0]?.columns ?? cols.filter((c) => c.primary);
  const pkNames = new Set(pk.map((c) => c.name));
  const name = getTableName(table);
  const rest = Object.values(getTableColumns(table)).filter((c) => !pkNames.has(c.name));
  const set: Record<string, SQL> = {};
  for (const [key, c] of Object.entries(getTableColumns(table)))
    if (!pkNames.has(c.name)) set[key] = sql.raw(`excluded."${c.name}"`);
  const mine = rest.map((c) => `"${name}"."${c.name}"`).join(', ');
  const theirs = rest.map((c) => `excluded."${c.name}"`).join(', ');
  const perBatch = Math.max(1, Math.floor(20000 / cols.length));
  for (let i = 0; i < rows.length; i += perBatch) {
    await tx
      .insert(table)
      .values(rows.slice(i, i + perBatch))
      .onConflictDoUpdate({
        target: pk,
        set,
        setWhere: sql.raw(`row(${mine}) is distinct from row(${theirs})`),
      });
  }
}

/** Streams a file into a table in batches. */
async function loadFile<F extends ContentFileName>(
  tx: Tx,
  folder: string,
  file: F,
  table: PgTable,
  map: (row: RowOf<F>) => Record<string, unknown>,
  after?: (batch: RowOf<F>[]) => Promise<void>,
): Promise<void> {
  const BATCH = 2000;
  let batch: RowOf<F>[] = [];
  const flush = async () => {
    await upsert(tx, table, batch.map(map));
    if (after) await after(batch);
    batch = [];
  };
  for await (const row of rowsOf(folder, file)) {
    batch.push(row);
    if (batch.length >= BATCH) await flush();
  }
  if (batch.length > 0) await flush();
}

const n = <T>(v: T | undefined): T | null => (v === undefined ? null : v);

const mapLemma = (r: LemmaRow) => ({
  id: r.id,
  key: r.key,
  lemma: r.lemma,
  lemmaAscii: foldAscii(r.lemma),
  pos: r.pos,
  gender: n(r.gender),
  pattern: n(r.pattern),
  aspect: n(r.aspect),
  freqRank: n(r.freqRank),
  topForms: r.topForms,
  flags: r.flags,
});

const mapForm = (r: FormRow) => ({
  lemmaId: r.lemmaId,
  form: r.form,
  formAscii: foldAscii(r.form),
  tags: r.tags,
});

const mapSense = (r: SenseRow) => ({
  lemmaId: r.lemmaId,
  ord: r.ord,
  glossEn: r.glossEn,
  note: n(r.note),
  source: r.source,
  verified: r.verified,
});

const mapSentence = (r: SentenceRow) => ({
  id: r.id,
  textSk: r.textSk,
  textEn: r.textEn,
  tokens: r.tokens,
  difficulty: r.difficulty,
  source: r.source,
  sourceRef: n(r.sourceRef),
  license: r.license,
  audioPath: n(r.audioPath),
  verified: r.verified,
});

const mapTrigger = (r: TriggerRow) => ({
  id: r.id,
  kind: r.kind,
  lemma: r.lemma,
  lemmaId: n(r.lemmaId),
  gCase: r.case,
  meaningEn: r.meaningEn,
  noteEn: n(r.noteEn),
  exampleSk: r.exampleSk,
  exampleEn: r.exampleEn,
  contrastGroup: n(r.contrastGroup),
  freqRank: n(r.freqRank),
});

const mapPattern = (r: PatternRow) => ({
  id: r.id,
  labelSk: r.labelSk,
  pos: r.pos,
  gender: n(r.gender),
  modelLemmaId: n(r.modelLemmaId),
  everydayModelLemmaId: n(r.everydayModelLemmaId),
  endings: r.endings,
  notesEn: n(r.notesEn),
});

const mapLesson = (r: LessonRow) => ({
  id: r.id,
  course: r.course,
  ord: r.ord,
  titleEn: r.titleEn,
  titleSk: r.titleSk,
  gCase: n(r.case),
  gNumber: n(r.number),
  focus: r.focus,
  summaryMd: r.summaryMd,
  prerequisites: r.prerequisites,
});

const mapExercise = (r: ExerciseRow) => ({
  id: r.id,
  kind: r.kind,
  sentenceSk: r.sentenceSk,
  sentenceEn: r.sentenceEn,
  target: r.target,
  gCase: r.case,
  gNumber: r.number,
  gGender: r.gender,
  pattern: n(r.pattern),
  triggerId: n(r.triggerId),
  options: n(r.options),
  lessonId: n(r.lessonId),
  difficulty: r.difficulty,
  source: r.source,
  verified: r.verified,
  flags: r.flags,
});

const mapScenario = (r: ScenarioRow) => ({
  id: r.id,
  mode: r.mode,
  titleEn: r.titleEn,
  titleSk: r.titleSk,
  goalEn: r.goalEn,
  settingSk: r.settingSk,
  tutorRole: r.tutorRole,
  targetCases: r.targetCases,
  targetTriggers: r.targetTriggers,
  level: r.level,
  openingSk: r.openingSk,
  successCriteria: r.successCriteria,
  vocabHint: r.vocabHint,
  ord: r.ord,
});

const mapLibrary = (r: LibraryRow) => ({
  id: r.id,
  title: r.title,
  body: r.body,
  level: r.level,
  analysis: n(r.analysis),
  lemmaCounts: n(r.lemmaCounts),
  source: r.source,
  license: r.license,
  ord: r.ord,
});

/** Children of the loaded sentences: their lemma links. Stale links are removed. */
async function loadLinks(tx: Tx, sentences: SentenceRow[]): Promise<void> {
  const links = sentences.flatMap((s) =>
    s.links.map((l) => ({
      lemmaId: l.lemmaId,
      sentenceId: s.id,
      tokenIndex: l.tokenIndex,
      form: l.form,
      tag: l.tag,
      ord: l.ord,
    })),
  );
  const keys = JSON.stringify(links.map((l) => [l.lemmaId, l.sentenceId, l.tokenIndex]));
  const ids = JSON.stringify(sentences.map((s) => s.id));
  await tx.execute(sql`
    delete from ling.lemma_sentence ls
    where ls.sentence_id in (select jsonb_array_elements_text(${ids}::jsonb))
      and not exists (
        select 1 from jsonb_array_elements(${keys}::jsonb) k
        where (k->>0)::int = ls.lemma_id and k->>1 = ls.sentence_id and (k->>2)::int = ls.token_index
      )`);
  await upsert(tx, ling.lemmaSentence, links);
}

/** Children of the loaded lessons: their steps. Steps beyond the new list are removed. */
async function loadSteps(tx: Tx, lessons: LessonRow[]): Promise<void> {
  const steps = lessons.flatMap((l) =>
    l.steps.map((s) => ({ lessonId: l.id, ord: s.ord, kind: s.kind, content: s.content })),
  );
  const keys = JSON.stringify(steps.map((s) => [s.lessonId, s.ord]));
  const ids = JSON.stringify(lessons.map((l) => l.id));
  await tx.execute(sql`
    delete from ling.lesson_step st
    where st.lesson_id in (select jsonb_array_elements_text(${ids}::jsonb))
      and not exists (
        select 1 from jsonb_array_elements(${keys}::jsonb) k
        where k->>0 = st.lesson_id and (k->>1)::int = st.ord
      )`);
  await upsert(tx, ling.lessonStep, steps);
}

function isDatabase(x: Database | Db): x is Database {
  return typeof (x as Database).withUser === 'function' && 'db' in x;
}

/**
 * Validates and loads a content set folder. Run it as the owner of the tables (the
 * migration role), never as `app_api`.
 */
export async function loadContent(target: Database | Db, folder: string): Promise<LoadResult> {
  const db = isDatabase(target) ? target.db : target;
  const { manifest, rows } = await validateContent(folder);
  const versionWritten = await db.transaction(async (tx) => {
    await loadFile(tx, folder, 'lemmas.jsonl', ling.lemma, mapLemma);
    await loadFile(tx, folder, 'forms.jsonl', ling.form, mapForm);
    await loadFile(tx, folder, 'senses.jsonl', ling.sense, mapSense);
    await loadFile(tx, folder, 'sentences.jsonl', ling.sentence, mapSentence, (b) =>
      loadLinks(tx, b),
    );
    await loadFile(tx, folder, 'triggers.jsonl', ling.trigger, mapTrigger);
    await loadFile(tx, folder, 'patterns.jsonl', ling.pattern, mapPattern);
    await loadFile(tx, folder, 'lessons.jsonl', ling.lesson, mapLesson, (b) => loadSteps(tx, b));
    await loadFile(tx, folder, 'exercises.jsonl', ling.exercise, mapExercise);
    await loadFile(tx, folder, 'scenarios.jsonl', ling.scenario, mapScenario);
    await loadFile(tx, folder, 'library.jsonl', ling.libraryText, mapLibrary);
    return writeVersion(tx, manifest);
  });
  return { version: manifest.version, rows, versionWritten };
}

async function writeVersion(tx: Tx, manifest: Manifest): Promise<boolean> {
  const builtAt = new Date(manifest.builtAt);
  const [latest] = await tx
    .select()
    .from(ling.contentVersion)
    .orderBy(desc(ling.contentVersion.id))
    .limit(1);
  if (
    latest &&
    latest.version === manifest.version &&
    latest.builtAt.getTime() === builtAt.getTime() &&
    canonical(latest.sources) === canonical(manifest.sources) &&
    canonical(latest.counts) === canonical(manifest.counts)
  )
    return false;
  await tx.insert(ling.contentVersion).values({
    version: manifest.version,
    builtAt,
    sources: manifest.sources,
    counts: manifest.counts,
  });
  return true;
}

/** JSON with sorted object keys: jsonb does not keep key order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : x,
  );
}

/** The latest loaded content version, or null. */
export async function currentContentVersion(
  q: Db | Tx,
): Promise<{ version: string; builtAt: Date; loadedAt: Date } | null> {
  const [row] = await q
    .select({
      version: ling.contentVersion.version,
      builtAt: ling.contentVersion.builtAt,
      loadedAt: ling.contentVersion.loadedAt,
    })
    .from(ling.contentVersion)
    .orderBy(desc(ling.contentVersion.id))
    .limit(1);
  return row ?? null;
}
