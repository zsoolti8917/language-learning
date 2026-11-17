// SQL of the notes module (Drizzle). Owner: B1. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. Every query filters by the
// learner as well, so ownership holds twice (row level security is the second wall).
import type {
  LemmaStatus,
  LemmaStatusSource,
  NoteContent,
  NoteKind,
  NoteSource,
} from '@app/contracts';
import {
  card,
  form,
  lemma,
  lemmaSentence,
  note,
  review,
  sense,
  sentence,
  type Tx,
  userLemma,
} from '@app/db';
import { and, asc, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';

export type NoteRow = typeof note.$inferSelect;
export type CardRow = typeof card.$inferSelect;
export type ReviewRow = typeof review.$inferSelect;

// --- Reference data (schema ling) ------------------------------------------------------

export interface LemmaInfo {
  id: number;
  lemma: string;
  gender: string | null;
  topForms: { form: string; tag: string; share: number }[];
  glossEn: string;
}

/** The lemma with its first gloss ('' when it has none yet). */
export async function getLemmaInfo(tx: Tx, lemmaId: number): Promise<LemmaInfo | null> {
  const [row] = await tx
    .select({
      id: lemma.id,
      lemma: lemma.lemma,
      gender: lemma.gender,
      topForms: lemma.topForms,
    })
    .from(lemma)
    .where(eq(lemma.id, lemmaId));
  if (!row) return null;
  const [gloss] = await tx
    .select({ glossEn: sense.glossEn })
    .from(sense)
    .where(eq(sense.lemmaId, lemmaId))
    .orderBy(asc(sense.ord))
    .limit(1);
  return { ...row, topForms: row.topForms ?? [], glossEn: gloss?.glossEn ?? '' };
}

/** Every form of a lemma with its tags string. */
export async function getForms(tx: Tx, lemmaId: number): Promise<{ form: string; tags: string }[]> {
  return tx
    .select({ form: form.form, tags: form.tags })
    .from(form)
    .where(eq(form.lemmaId, lemmaId));
}

export interface LemmaSentenceRow {
  sentenceId: string;
  tokenIndex: number;
  form: string;
  tag: string;
  ord: number;
  textSk: string;
  textEn: string;
  tokens: { s: number; e: number }[];
}

/** The example sentences of a lemma in display order. */
export async function getLemmaSentences(tx: Tx, lemmaId: number): Promise<LemmaSentenceRow[]> {
  return tx
    .select({
      sentenceId: lemmaSentence.sentenceId,
      tokenIndex: lemmaSentence.tokenIndex,
      form: lemmaSentence.form,
      tag: lemmaSentence.tag,
      ord: lemmaSentence.ord,
      textSk: sentence.textSk,
      textEn: sentence.textEn,
      tokens: sentence.tokens,
    })
    .from(lemmaSentence)
    .innerJoin(sentence, eq(sentence.id, lemmaSentence.sentenceId))
    .where(eq(lemmaSentence.lemmaId, lemmaId))
    .orderBy(asc(lemmaSentence.ord), asc(lemmaSentence.sentenceId), asc(lemmaSentence.tokenIndex));
}

// --- Notes and cards ---------------------------------------------------------------------

export interface NewNote {
  id: string;
  userId: string;
  kind: NoteKind;
  lemmaId: number | null;
  exerciseId: string | null;
  textId: string | null;
  content: NoteContent;
  source: NoteSource;
  sourceRef: Record<string, unknown> | null;
  now: Date;
}

/** Inserts the note; false when an id or a unique index (word, exercise) already holds one. */
export async function insertNote(tx: Tx, n: NewNote): Promise<boolean> {
  const rows = await tx
    .insert(note)
    .values({
      id: n.id,
      userId: n.userId,
      kind: n.kind,
      lemmaId: n.lemmaId,
      exerciseId: n.exerciseId,
      textId: n.textId,
      content: n.content,
      source: n.source,
      sourceRef: n.sourceRef,
      createdAt: n.now,
      updatedAt: n.now,
    })
    .onConflictDoNothing()
    .returning({ id: note.id });
  return rows.length > 0;
}

export async function insertCard(
  tx: Tx,
  c: {
    id: string;
    userId: string;
    noteId: string;
    newOrd: number;
    schedulerState: Record<string, unknown>;
    schedulerVersion: string;
    now: Date;
  },
): Promise<void> {
  await tx
    .insert(card)
    .values({
      id: c.id,
      userId: c.userId,
      noteId: c.noteId,
      template: 'recall',
      state: 'new',
      dueAt: null,
      newOrd: c.newOrd,
      schedulerState: c.schedulerState,
      schedulerVersion: c.schedulerVersion,
      createdAt: c.now,
      updatedAt: c.now,
    })
    .onConflictDoNothing({ target: [card.noteId, card.template] });
}

/** A note of the learner by id, deleted ones included. */
export async function findNote(tx: Tx, userId: string, id: string): Promise<NoteRow | null> {
  const [row] = await tx
    .select()
    .from(note)
    .where(and(eq(note.userId, userId), eq(note.id, id)));
  return row ?? null;
}

/** The live word note of a lemma. */
export async function findWordNote(
  tx: Tx,
  userId: string,
  lemmaId: number,
): Promise<NoteRow | null> {
  const [row] = await tx
    .select()
    .from(note)
    .where(
      and(
        eq(note.userId, userId),
        eq(note.kind, 'word'),
        eq(note.lemmaId, lemmaId),
        isNull(note.deletedAt),
      ),
    );
  return row ?? null;
}

/** The live note of an exercise. */
export async function findExerciseNote(
  tx: Tx,
  userId: string,
  exerciseId: string,
): Promise<NoteRow | null> {
  const [row] = await tx
    .select()
    .from(note)
    .where(and(eq(note.userId, userId), eq(note.exerciseId, exerciseId), isNull(note.deletedAt)));
  return row ?? null;
}

export async function findCard(tx: Tx, userId: string, noteId: string): Promise<CardRow | null> {
  const [row] = await tx
    .select()
    .from(card)
    .where(and(eq(card.userId, userId), eq(card.noteId, noteId), eq(card.template, 'recall')));
  return row ?? null;
}

/** The last reviews of a card, newest first. */
export async function lastReviews(
  tx: Tx,
  userId: string,
  cardId: string,
  limit: number,
): Promise<ReviewRow[]> {
  return tx
    .select()
    .from(review)
    .where(and(eq(review.userId, userId), eq(review.cardId, cardId)))
    .orderBy(desc(review.answeredAt), desc(review.id))
    .limit(limit);
}

export async function updateNote(
  tx: Tx,
  userId: string,
  id: string,
  set: {
    suspended?: boolean;
    content?: NoteContent;
    lemmaId?: number | null;
    exerciseId?: string | null;
    deletedAt?: Date;
    now: Date;
  },
): Promise<void> {
  const { now, ...rest } = set;
  await tx
    .update(note)
    .set({ ...rest, updatedAt: now })
    .where(and(eq(note.userId, userId), eq(note.id, id)));
  if (set.suspended !== undefined) {
    await tx
      .update(card)
      .set({ suspended: set.suspended, updatedAt: now })
      .where(and(eq(card.userId, userId), eq(card.noteId, id)));
  }
}

export interface NoteListRow {
  note: NoteRow;
  state: string | null;
  dueAt: Date | null;
}

/** One page of live notes, newest first; `after` is the last row of the previous page. */
export async function listNotes(
  tx: Tx,
  userId: string,
  opts: {
    kind?: NoteKind;
    q?: string;
    after?: { createdAt: Date; id: string };
    limit: number;
  },
): Promise<NoteListRow[]> {
  const where: SQL[] = [eq(note.userId, userId), isNull(note.deletedAt)];
  if (opts.kind) where.push(eq(note.kind, opts.kind));
  if (opts.q) {
    const pattern = `%${opts.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const like = (key: string) => sql`(${note.content} ->> ${key}) ilike ${pattern}`;
    const any = or(
      like('lemma'),
      like('textSk'),
      like('cue'),
      like('glossEn'),
      like('sentenceSk'),
      like('sentenceEn'),
    );
    if (any) where.push(any);
  }
  if (opts.after) {
    const c = or(
      lt(note.createdAt, opts.after.createdAt),
      and(eq(note.createdAt, opts.after.createdAt), lt(note.id, opts.after.id)),
    );
    if (c) where.push(c);
  }
  return tx
    .select({ note, state: card.state, dueAt: card.dueAt })
    .from(note)
    .leftJoin(card, and(eq(card.noteId, note.id), eq(card.template, 'recall')))
    .where(and(...where))
    .orderBy(desc(note.createdAt), desc(note.id))
    .limit(opts.limit);
}

// --- Lemma status ------------------------------------------------------------------------

/**
 * Sets the status of every lemma in one statement. `known_at` is set when a lemma becomes
 * known (kept when it already was) and cleared for any other status.
 */
export async function upsertLemmaStatus(
  tx: Tx,
  userId: string,
  lemmaIds: number[],
  status: LemmaStatus,
  source: LemmaStatusSource,
  now: Date,
  onlyFrom?: readonly LemmaStatus[],
): Promise<void> {
  const ids = [...new Set(lemmaIds)];
  if (ids.length === 0) return;
  const knownAt = status === 'known' ? now : null;
  await tx
    .insert(userLemma)
    .values(ids.map((lemmaId) => ({ userId, lemmaId, status, source, knownAt, updatedAt: now })))
    .onConflictDoUpdate({
      target: [userLemma.userId, userLemma.lemmaId],
      set: {
        status,
        source,
        knownAt:
          status === 'known'
            ? sql`case when ${userLemma.status} = 'known' then coalesce(${userLemma.knownAt}, ${now.toISOString()}::timestamptz) else ${now.toISOString()}::timestamptz end`
            : null,
        updatedAt: now,
      },
      ...(onlyFrom ? { setWhere: inArray(userLemma.status, [...onlyFrom]) } : {}),
    });
}
