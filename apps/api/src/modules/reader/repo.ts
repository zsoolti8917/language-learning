// SQL of the reader module (Drizzle). Owner: B4. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. Every function runs on a
// transaction the caller opened (`withUser`), so row level security limits it to the learner.
import type {
  LemmaStatus,
  TextAnalysis,
  TextProgress,
  TextSource,
  TextStatus,
} from '@app/contracts';
import { appText, card, libraryText, note, type Tx, userLemma } from '@app/db';
import { and, asc, count, desc, eq, gt, inArray, isNull, max, min, sql } from 'drizzle-orm';

export type TextRow = typeof appText.$inferSelect;
export type LibraryRow = typeof libraryText.$inferSelect;

// --- Texts ------------------------------------------------------------------------

export async function findText(tx: Tx, id: string): Promise<TextRow | null> {
  const [row] = await tx.select().from(appText).where(eq(appText.id, id));
  return row ?? null;
}

/** The text, locked until the transaction ends (translation write back). */
export async function findTextForUpdate(tx: Tx, id: string): Promise<TextRow | null> {
  const [row] = await tx.select().from(appText).where(eq(appText.id, id)).for('update');
  return row ?? null;
}

export interface NewText {
  id: string;
  userId: string;
  title: string;
  body: string;
  source: TextSource;
  sourceRef: string | null;
  status: TextStatus;
  analysis: TextAnalysis | null;
  tokenCount: number | null;
  uniqueLemmaCount: number | null;
  coverage: number | null;
  now: Date;
}

/**
 * Inserts the text unless its id exists. Returns the new row, or null when the id was taken
 * (by this learner or, invisible under row level security, by another one).
 */
export async function insertText(tx: Tx, t: NewText): Promise<TextRow | null> {
  const rows = await tx
    .insert(appText)
    .values({
      id: t.id,
      userId: t.userId,
      title: t.title,
      body: t.body,
      source: t.source,
      sourceRef: t.sourceRef,
      status: t.status,
      analysis: t.analysis,
      analysisVersion: t.analysis ? t.analysis.v : null,
      tokenCount: t.tokenCount,
      uniqueLemmaCount: t.uniqueLemmaCount,
      coverage: t.coverage,
      coverageAt: t.coverage === null ? null : t.now,
      createdAt: t.now,
      updatedAt: t.now,
    })
    .onConflictDoNothing({ target: appText.id })
    .returning();
  return rows[0] ?? null;
}

/** Paste imports of the learner since `since`, with the oldest one's time. */
export async function countImportsSince(
  tx: Tx,
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await tx
    .select({ n: count(), oldest: min(appText.createdAt) })
    .from(appText)
    .where(and(eq(appText.source, 'paste'), gt(appText.createdAt, since)));
  return { count: Number(row?.n ?? 0), oldest: row?.oldest ?? null };
}

export async function markReady(
  tx: Tx,
  id: string,
  r: {
    analysis: TextAnalysis;
    tokenCount: number;
    uniqueLemmaCount: number;
    coverage: number | null;
    now: Date;
  },
): Promise<void> {
  await tx
    .update(appText)
    .set({
      status: 'ready',
      error: null,
      analysis: r.analysis,
      analysisVersion: r.analysis.v,
      tokenCount: r.tokenCount,
      uniqueLemmaCount: r.uniqueLemmaCount,
      coverage: r.coverage,
      coverageAt: r.coverage === null ? null : r.now,
      updatedAt: r.now,
    })
    .where(and(eq(appText.id, id), eq(appText.status, 'processing')));
}

export async function markFailed(tx: Tx, id: string, error: string, now: Date): Promise<void> {
  await tx
    .update(appText)
    .set({ status: 'failed', error, updatedAt: now })
    .where(and(eq(appText.id, id), eq(appText.status, 'processing')));
}

/** Marks the text opened, and stores the coverage when it was computed again. */
export async function markOpened(
  tx: Tx,
  id: string,
  now: Date,
  coverage?: number | null,
): Promise<TextRow | null> {
  const [row] = await tx
    .update(appText)
    .set({
      lastOpenedAt: now,
      ...(coverage !== undefined ? { coverage, coverageAt: now } : {}),
    })
    .where(eq(appText.id, id))
    .returning();
  return row ?? null;
}

export async function updateText(
  tx: Tx,
  id: string,
  patch: { title?: string; progress?: TextProgress; archived?: boolean },
  now: Date,
): Promise<TextRow | null> {
  const [row] = await tx
    .update(appText)
    .set({ ...patch, updatedAt: now })
    .where(eq(appText.id, id))
    .returning();
  return row ?? null;
}

export async function saveAnalysis(
  tx: Tx,
  id: string,
  analysis: TextAnalysis,
  now: Date,
): Promise<void> {
  await tx.update(appText).set({ analysis, updatedAt: now }).where(eq(appText.id, id));
}

export async function deleteText(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.delete(appText).where(eq(appText.id, id)).returning({ id: appText.id });
  return rows.length > 0;
}

/** Sort key of the list: the last opening, or the import for a text never opened. */
const listedAt = sql<Date>`coalesce(${appText.lastOpenedAt}, ${appText.createdAt})`;

export async function listTexts(
  tx: Tx,
  opts: { archived: boolean; limit: number; after: { at: Date; id: string } | null },
): Promise<TextRow[]> {
  // Row comparison matches the order (both descending).
  const after = opts.after
    ? sql`(${listedAt}, ${appText.id}) < (${opts.after.at.toISOString()}::timestamptz, ${opts.after.id}::uuid)`
    : undefined;
  return tx
    .select()
    .from(appText)
    .where(and(eq(appText.archived, opts.archived), after))
    .orderBy(desc(listedAt), desc(appText.id))
    .limit(opts.limit);
}

/** The learner's copies of library texts: library id → newest text. */
export async function libraryCopies(tx: Tx): Promise<Map<string, TextRow>> {
  const rows = await tx
    .select()
    .from(appText)
    .where(eq(appText.source, 'library'))
    .orderBy(asc(appText.createdAt));
  const out = new Map<string, TextRow>();
  for (const r of rows) if (r.sourceRef) out.set(r.sourceRef, r);
  return out;
}

// --- Learner state ------------------------------------------------------------------

export interface LemmaState {
  /** `app.user_lemma.status`, when the learner has a row. */
  status?: LemmaStatus;
  /** True when the learner has a word note (not deleted) for the lemma. */
  hasNote: boolean;
  /** The highest stability of the word note's cards. */
  stability: number | null;
}

/** The learner's state of each lemma: their `user_lemma` row and their word note's cards. */
export async function lemmaStates(tx: Tx, lemmaIds: number[]): Promise<Map<number, LemmaState>> {
  const out = new Map<number, LemmaState>();
  if (lemmaIds.length === 0) return out;
  const statuses = await tx
    .select({ lemmaId: userLemma.lemmaId, status: userLemma.status })
    .from(userLemma)
    .where(inArray(userLemma.lemmaId, lemmaIds));
  const notes = await tx
    .select({ lemmaId: note.lemmaId, stability: max(card.stability) })
    .from(note)
    .leftJoin(card, eq(card.noteId, note.id))
    .where(and(eq(note.kind, 'word'), isNull(note.deletedAt), inArray(note.lemmaId, lemmaIds)))
    .groupBy(note.lemmaId);
  for (const s of statuses)
    out.set(s.lemmaId, { status: s.status as LemmaStatus, hasNote: false, stability: null });
  for (const n of notes) {
    if (n.lemmaId === null) continue;
    const cur = out.get(n.lemmaId) ?? { hasNote: false, stability: null };
    out.set(n.lemmaId, { ...cur, hasNote: true, stability: n.stability ?? null });
  }
  return out;
}

export interface PhraseNoteRow {
  id: string;
  content: unknown;
}

/** Phrase notes the learner saved from this text, oldest first. */
export async function phraseNotes(tx: Tx, textId: string): Promise<PhraseNoteRow[]> {
  return tx
    .select({ id: note.id, content: note.content })
    .from(note)
    .where(and(eq(note.textId, textId), eq(note.kind, 'phrase'), isNull(note.deletedAt)))
    .orderBy(asc(note.createdAt), asc(note.id));
}

// --- Library ----------------------------------------------------------------------

export async function listLibrary(tx: Tx): Promise<LibraryRow[]> {
  return tx.select().from(libraryText).orderBy(asc(libraryText.ord), asc(libraryText.id));
}

export async function findLibraryText(tx: Tx, id: string): Promise<LibraryRow | null> {
  const [row] = await tx.select().from(libraryText).where(eq(libraryText.id, id));
  return row ?? null;
}
