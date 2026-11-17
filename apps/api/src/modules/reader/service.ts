// Logic of the reader module. Owner: B4. It takes ports and a transaction and knows nothing
// about HTTP. Functions that take `tx` run inside the handler's `withUser` transaction. The
// two flows that call another service (the analysis in the background, and the sentence
// translation) take a `ReaderEnv` instead and open their own short transactions around the
// call, so no network call ever runs while a transaction is open.
import { type AiGateway, currentVersion, isAiGatewayError, PROMPTS } from '@app/ai';
import {
  type LemmaStatus,
  LIMITS,
  type LibraryItem,
  type RequestOutput,
  type ResponseOf,
  type TextAnalysis,
  TextAnalysisSchema,
  type TextDetail,
  type TextSummary,
} from '@app/contracts';
import type { Database, Tx } from '@app/db';
import { tokenize } from '@app/ling';
import { isKnownStability } from '@app/srs';
import { z } from 'zod';
import { conflict, notFound, rateLimited } from '../../platform/errors';
import type { AnalyzerPort, Background, Clock } from '../../ports';
import * as repo from './repo';

/** What the flows outside one transaction need. */
export interface ReaderEnv {
  database: Database;
  clock: Clock;
  analyzer: AnalyzerPort;
  ai: AiGateway;
  background: Background;
}

const HOUR_MS = 3_600_000;
const TITLE_CHARS = 60;

// --- Statuses and coverage --------------------------------------------------------

/**
 * The learner's status of a lemma. `known` and `ignored` rows win; a word card whose stability
 * passed 21 days counts as known; a word note or a `learning` row is learning.
 */
export function lemmaStatusOf(state: repo.LemmaState | undefined): LemmaStatus {
  if (!state) return 'unknown';
  if (state.status === 'known' || state.status === 'ignored') return state.status;
  if (state.hasNote && isKnownStability(state.stability)) return 'known';
  if (state.status === 'learning' || state.hasNote) return 'learning';
  return state.status ?? 'unknown';
}

const UPPER = /^\p{Lu}/u;

/**
 * The share of word tokens (numbers included) the learner already understands: tokens whose
 * lemma is known or ignored, numbers, and names. A name is a lemma written with a capital
 * letter (Bratislava), or a word without a lemma that starts with a capital letter and does
 * not open its sentence (Peter). Null when the text has no word.
 */
export function computeCoverage(
  body: string,
  analysis: TextAnalysis,
  statusOf: (lemmaId: number) => LemmaStatus,
): number | null {
  let total = 0;
  let known = 0;
  for (const sentence of analysis.sentences) {
    let first = true;
    for (const t of sentence.tokens) {
      if (t.t === 'punct') continue;
      total += 1;
      const opens = first;
      first = false;
      if (t.t === 'num') {
        known += 1;
        continue;
      }
      if (t.l !== undefined) {
        const s = statusOf(t.l);
        const lemma = analysis.lemmas[String(t.l)]?.lemma ?? '';
        if (s === 'known' || s === 'ignored' || UPPER.test(lemma)) known += 1;
      } else if (!opens && UPPER.test(body.slice(t.s, t.e))) {
        known += 1;
      }
    }
  }
  return total === 0 ? null : known / total;
}

function lemmaIdsOf(analysis: TextAnalysis): number[] {
  const ids = new Set<number>();
  for (const k of Object.keys(analysis.lemmas)) ids.add(Number(k));
  for (const s of analysis.sentences) for (const t of s.tokens) if (t.l !== undefined) ids.add(t.l);
  return [...ids].filter((n) => Number.isInteger(n) && n > 0);
}

async function statusesFor(tx: Tx, lemmaIds: number[]): Promise<Map<number, LemmaStatus>> {
  const states = await repo.lemmaStates(tx, lemmaIds);
  const out = new Map<number, LemmaStatus>();
  for (const id of lemmaIds) out.set(id, lemmaStatusOf(states.get(id)));
  return out;
}

async function coverageOf(tx: Tx, body: string, analysis: TextAnalysis): Promise<number | null> {
  const statuses = await statusesFor(tx, lemmaIdsOf(analysis));
  return computeCoverage(body, analysis, (id) => statuses.get(id) ?? 'unknown');
}

// --- Shapes -----------------------------------------------------------------------

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toSummary(row: repo.TextRow): TextSummary {
  return {
    id: row.id,
    title: row.title,
    source: row.source as TextSummary['source'],
    sourceRef: row.sourceRef,
    status: row.status as TextSummary['status'],
    tokenCount: row.tokenCount,
    uniqueLemmaCount: row.uniqueLemmaCount,
    coverage: row.coverage === null ? null : Math.min(1, Math.max(0, row.coverage)),
    progress: row.progress ?? {},
    archived: row.archived,
    lastOpenedAt: iso(row.lastOpenedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A title from the first line of the body, when the learner gave none. */
export function titleFrom(body: string): string {
  const line = (body.split(/\r?\n/).find((l) => l.trim() !== '') ?? body)
    .trim()
    .replace(/\s+/g, ' ');
  const chars = [...line];
  return chars.length <= TITLE_CHARS
    ? line
    : `${chars
        .slice(0, TITLE_CHARS - 1)
        .join('')
        .trimEnd()}…`;
}

// --- Import -----------------------------------------------------------------------

export type CreateResult = { result: ResponseOf<'texts.create'>; repeated: boolean };

/**
 * Stores a pasted text as `processing`. A repeat with the same id and body returns the stored
 * status (`repeated`); the same id with another body is a conflict. At most
 * `LIMITS.textImportsPerHour` paste imports in the last hour.
 */
export async function createText(
  tx: Tx,
  userId: string,
  body: RequestOutput<'texts.create'>['body'],
  now: Date,
): Promise<CreateResult> {
  const existing = await repo.findText(tx, body.id);
  if (existing) return repeatOf(existing, body.body);

  const since = new Date(now.getTime() - HOUR_MS);
  const recent = await repo.countImportsSince(tx, since);
  if (recent.count >= LIMITS.textImportsPerHour) {
    const freeAt = (recent.oldest?.getTime() ?? now.getTime()) + HOUR_MS;
    const seconds = Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000));
    throw rateLimited(
      `At most ${LIMITS.textImportsPerHour} texts can be imported in an hour.`,
      seconds,
    );
  }

  const row = await repo.insertText(tx, {
    id: body.id,
    userId,
    title: body.title?.trim() || titleFrom(body.body),
    body: body.body,
    source: 'paste',
    sourceRef: null,
    status: 'processing',
    analysis: null,
    tokenCount: null,
    uniqueLemmaCount: null,
    coverage: null,
    now,
  });
  if (!row) throw conflict('This id is already taken.');
  return { result: { id: row.id, status: 'processing' }, repeated: false };
}

function repeatOf(existing: repo.TextRow, body: string): CreateResult {
  if (existing.source !== 'paste' || existing.body !== body)
    throw conflict('A text with this id exists with other content.');
  return {
    result: { id: existing.id, status: existing.status as TextSummary['status'] },
    repeated: true,
  };
}

/** The message a learner sees for a failed analysis; never internals. */
export function failureMessage(e: unknown): string {
  if (isAiGatewayError(e) && e.code === 'budget_exceeded')
    return 'The daily model budget is used up. Try the import again tomorrow.';
  return 'The text could not be analysed.';
}

/**
 * Analyses the text through `AnalyzerPort` and stores the result: `ready` with the analysis
 * and the coverage, or `failed` with a message. The text stays in both cases. The analyzer
 * call runs between two transactions.
 */
export async function analyseText(
  env: ReaderEnv,
  userId: string,
  textId: string,
  body: string,
): Promise<void> {
  try {
    const out = await env.analyzer.analyzeText(body, { userId });
    const analysis = TextAnalysisSchema.parse(out.analysis);
    await env.database.withUser(userId, async (tx) => {
      const coverage = await coverageOf(tx, body, analysis);
      await repo.markReady(tx, textId, {
        analysis,
        tokenCount: out.tokenCount,
        uniqueLemmaCount: Object.keys(out.lemmaCounts).length,
        coverage,
        now: env.clock.now(),
      });
    });
  } catch (e) {
    await env.database.withUser(userId, (tx) =>
      repo.markFailed(tx, textId, failureMessage(e), env.clock.now()),
    );
  }
}

/** Starts the analysis after the response; the platform keeps it alive (waitUntil). */
export function analyseInBackground(
  env: ReaderEnv,
  userId: string,
  textId: string,
  body: string,
): void {
  env.background.runInBackground(analyseText(env, userId, textId, body));
}

// --- Reading ----------------------------------------------------------------------

/** Where a saved phrase sits in the body: its capture sentence first, then the phrase itself. */
export function phraseSpan(
  body: string,
  content: {
    textSk: string;
    context?: { sentenceSk: string; blank: { start: number; end: number } };
  },
): { start: number; end: number } | null {
  const lower = body.toLocaleLowerCase('sk');
  const phrase = content.textSk.toLocaleLowerCase('sk');
  const ctx = content.context;
  if (ctx) {
    const at = body.indexOf(ctx.sentenceSk);
    if (at >= 0) {
      const span = { start: at + ctx.blank.start, end: at + ctx.blank.end };
      if (lower.slice(span.start, span.end) === phrase) return span;
    }
  }
  const at = lower.indexOf(phrase);
  return at >= 0 ? { start: at, end: at + phrase.length } : null;
}

/**
 * Opens a text: marks it opened, computes the coverage again from the learner's current word
 * statuses (and stores it when it changed), and adds the lemma statuses and saved phrases.
 */
export async function getText(tx: Tx, id: string, now: Date): Promise<TextDetail> {
  const row = await repo.findText(tx, id);
  if (!row) throw notFound('No such text.');
  const analysis = row.analysis ?? null;
  const lemmaStatus: Record<string, LemmaStatus> = {};
  let coverage: number | null | undefined;
  if (analysis) {
    const statuses = await statusesFor(tx, lemmaIdsOf(analysis));
    for (const [k, v] of statuses) lemmaStatus[String(k)] = v;
    const fresh = computeCoverage(row.body, analysis, (l) => statuses.get(l) ?? 'unknown');
    // The column is a `real`: compare with its precision, not exactly.
    const same =
      fresh === null || row.coverage === null
        ? fresh === row.coverage
        : Math.abs(fresh - row.coverage) < 1e-6;
    if (!same) coverage = fresh;
  }
  const opened = (await repo.markOpened(tx, id, now, coverage)) ?? row;
  const phrases = (await repo.phraseNotes(tx, id)).flatMap((n) => {
    const c = n.content as {
      kind?: string;
      textSk?: string;
      glossEn?: string;
      context?: { sentenceSk: string; blank: { start: number; end: number } };
    };
    if (c.kind !== 'phrase' || !c.textSk) return [];
    const content = { textSk: c.textSk, ...(c.context ? { context: c.context } : {}) };
    return [
      {
        noteId: n.id,
        textSk: c.textSk,
        glossEn: c.glossEn ?? '',
        span: phraseSpan(row.body, content),
      },
    ];
  });
  return {
    ...toSummary(opened),
    body: row.body,
    analysis,
    error: row.error,
    lemmaStatus,
    phrases,
  };
}

interface Cursor {
  at: Date;
  id: string;
}

function encodeCursor(row: repo.TextRow): string {
  const at = (row.lastOpenedAt ?? row.createdAt).toISOString();
  return Buffer.from(JSON.stringify([at, row.id])).toString('base64url');
}

const CursorSchema = z.tuple([z.iso.datetime(), z.uuid()]);

function decodeCursor(cursor: string | undefined): Cursor | null {
  if (!cursor) return null;
  try {
    const [at, id] = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    return { at: new Date(at), id };
  } catch {
    return null;
  }
}

/** The learner's texts, last opened first (never opened: by import time). */
export async function listTexts(
  tx: Tx,
  query: RequestOutput<'texts.list'>['query'],
): Promise<ResponseOf<'texts.list'>> {
  const rows = await repo.listTexts(tx, {
    archived: query.archived ?? false,
    limit: query.limit + 1,
    after: decodeCursor(query.cursor),
  });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
  };
}

/** Rename, save the reading position, archive or restore. */
export async function updateText(
  tx: Tx,
  id: string,
  body: RequestOutput<'texts.update'>['body'],
  now: Date,
): Promise<TextSummary> {
  const row = await repo.findText(tx, id);
  if (!row) throw notFound('No such text.');
  const patch: Parameters<typeof repo.updateText>[2] = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.progress !== undefined) {
    const sentences = row.analysis?.sentences.length;
    const s = body.progress.sentence;
    if (s !== undefined && sentences !== undefined && s >= sentences)
      throw conflict('The text has no such sentence.', { sentences });
    patch.progress = { ...row.progress, ...body.progress };
  }
  if (body.archived !== undefined) patch.archived = body.archived;
  const updated = await repo.updateText(tx, id, patch, now);
  if (!updated) throw notFound('No such text.');
  return toSummary(updated);
}

export async function deleteText(tx: Tx, id: string): Promise<void> {
  if (!(await repo.deleteText(tx, id))) throw notFound('No such text.');
}

// --- Sentence translation --------------------------------------------------------

/** The answer of the route `reader.translate`. */
export const TranslationSchema = z.object({ en: z.string().trim().min(1).max(2000) });

const inFlight = new Map<string, Promise<ResponseOf<'texts.translateSentence'>>>();

/** The user message of `reader.translate`: the sentence, with the one before it as context. */
export function translationRequest(body: string, analysis: TextAnalysis, n: number): string {
  const s = analysis.sentences[n];
  if (!s) throw new RangeError(`no sentence ${n}`);
  const prev = n > 0 ? analysis.sentences[n - 1] : undefined;
  const parts: string[] = [];
  if (prev) parts.push(`<context>${body.slice(prev.s, prev.e)}</context>`);
  parts.push(`<sentence>${body.slice(s.s, s.e)}</sentence>`);
  return parts.join('\n');
}

/**
 * The English translation of sentence `n`. A stored translation is returned without a model
 * call; otherwise `reader.translate` is asked once (outside any transaction) and the answer is
 * stored in the analysis. Requests for the same sentence that overlap share one call.
 */
export function translateSentence(
  env: ReaderEnv,
  userId: string,
  textId: string,
  n: number,
): Promise<ResponseOf<'texts.translateSentence'>> {
  const key = `${userId}:${textId}:${n}`;
  const running = inFlight.get(key);
  if (running) return running;
  const task = translateOnce(env, userId, textId, n).finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function translateOnce(
  env: ReaderEnv,
  userId: string,
  textId: string,
  n: number,
): Promise<ResponseOf<'texts.translateSentence'>> {
  const found = await env.database.withUser(userId, async (tx) => {
    const row = await repo.findText(tx, textId);
    if (!row) throw notFound('No such text.');
    if (row.status !== 'ready' || !row.analysis) throw conflict('The text is not analysed yet.');
    const sentence = row.analysis.sentences[n];
    if (!sentence) throw notFound('The text has no such sentence.');
    return { row, analysis: row.analysis, sentence };
  });
  if (found.sentence.en !== undefined) return { n, en: found.sentence.en };

  const prompt = currentVersion(PROMPTS['reader.translate']);
  const { data } = await env.ai.structured({
    route: 'reader.translate',
    userId,
    system: [...prompt.system],
    messages: [{ role: 'user', content: translationRequest(found.row.body, found.analysis, n) }],
    schema: TranslationSchema,
    maxTokens: 600,
  });

  return env.database.withUser(userId, async (tx) => {
    const row = await repo.findTextForUpdate(tx, textId);
    if (!row?.analysis) throw notFound('No such text.');
    const stored = row.analysis.sentences[n];
    if (!stored) throw notFound('The text has no such sentence.');
    if (stored.en !== undefined) return { n, en: stored.en };
    const analysis: TextAnalysis = {
      ...row.analysis,
      sentences: row.analysis.sentences.map((s, i) => (i === n ? { ...s, en: data.en } : s)),
    };
    await repo.saveAnalysis(tx, textId, analysis, env.clock.now());
    return { n, en: data.en };
  });
}

// --- Library ----------------------------------------------------------------------

function wordCount(body: string, analysis: TextAnalysis | null): number {
  if (analysis)
    return analysis.sentences.reduce(
      (n, s) => n + s.tokens.filter((t) => t.t === 'word').length,
      0,
    );
  return tokenize(body).filter((t) => t.t === 'word').length;
}

/** The starter library, each text with this learner's coverage and their copy, if any. */
export async function listLibrary(tx: Tx): Promise<ResponseOf<'library.list'>> {
  const texts = await repo.listLibrary(tx);
  const copies = await repo.libraryCopies(tx);
  const ids = new Set<number>();
  for (const t of texts) if (t.analysis) for (const id of lemmaIdsOf(t.analysis)) ids.add(id);
  const statuses = await statusesFor(tx, [...ids]);
  const statusOf = (id: number) => statuses.get(id) ?? 'unknown';
  return {
    items: texts.map((t): LibraryItem => {
      const copy = copies.get(t.id);
      return {
        id: t.id,
        title: t.title,
        level: t.level as LibraryItem['level'],
        tokenCount: wordCount(t.body, t.analysis),
        coverage: t.analysis ? computeCoverage(t.body, t.analysis, statusOf) : null,
        ...(copy ? { textId: copy.id } : {}),
      };
    }),
  };
}

export type AddResult = { result: ResponseOf<'library.add'>; analyse: boolean; body: string };

/**
 * Copies a library text into the learner's texts. With an analysis the copy is `ready` at
 * once; without one it is `processing` and the caller starts the import (`analyse`). A repeat
 * with the same id returns the stored status.
 */
export async function addLibraryText(
  tx: Tx,
  userId: string,
  libraryId: string,
  textId: string,
  now: Date,
): Promise<AddResult> {
  const lib = await repo.findLibraryText(tx, libraryId);
  if (!lib) throw notFound('No such library text.');
  const existing = await repo.findText(tx, textId);
  if (existing) {
    if (existing.source !== 'library' || existing.sourceRef !== libraryId)
      throw conflict('A text with this id exists with other content.');
    return {
      result: { id: existing.id, status: existing.status as TextSummary['status'] },
      analyse: false,
      body: existing.body,
    };
  }
  const analysis = lib.analysis ? TextAnalysisSchema.parse(lib.analysis) : null;
  const lemmaCounts = lib.lemmaCounts ?? null;
  const row = await repo.insertText(tx, {
    id: textId,
    userId,
    title: lib.title,
    body: lib.body,
    source: 'library',
    sourceRef: lib.id,
    status: analysis ? 'ready' : 'processing',
    analysis,
    tokenCount: analysis ? wordCount(lib.body, analysis) : null,
    uniqueLemmaCount: analysis
      ? lemmaCounts
        ? Object.keys(lemmaCounts).length
        : lemmaIdsOf(analysis).length
      : null,
    coverage: analysis ? await coverageOf(tx, lib.body, analysis) : null,
    now,
  });
  if (!row) throw conflict('This id is already taken.');
  return {
    result: { id: row.id, status: row.status as TextSummary['status'] },
    analyse: analysis === null,
    body: lib.body,
  };
}
