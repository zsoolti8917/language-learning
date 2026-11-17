// Logic of the notes module. Owner: B1. It takes ports and a transaction and knows
// nothing about HTTP. The real NotesPort (port.ts) and the /notes endpoints share it.
import {
  type Card,
  type CaseSentenceContent,
  CaseSentenceContentSchema,
  type CreateNote,
  type LemmaStatusSource,
  type Note,
  type NoteContent,
  type NoteDetail,
  type NoteKind,
  type NoteSource,
  type NoteSummary,
  type PhraseContent,
  PhraseContentSchema,
  type ResponseOf,
  type ReviewLogEntry,
  type UpdateNote,
  type WordContent,
  type WordVariant,
} from '@app/contracts';
import type { Tx } from '@app/db';
import { formKey, splitTags } from '@app/ling';
import { isSchedulerState, newState, SCHEDULER_VERSION, snapshotOf } from '@app/srs';
import { conflict, notFound, validationFailed } from '../../platform/errors';
import type {
  CaptureContext,
  CaseSentenceNoteInput,
  Clock,
  IdGenerator,
  PhraseNoteInput,
  WordNoteInput,
} from '../../ports';
import * as repo from './repo';

/** What the notes logic needs besides the transaction. */
export interface NotesEnv {
  clock: Clock;
  ids: IdGenerator;
}

/** A word note holds at most this many sentences. */
export const MAX_WORD_VARIANTS = 3;
/** `GET /notes/:id` shows this many of the last reviews. */
export const DETAIL_REVIEWS = 20;

// --- Queue order of new cards ----------------------------------------------------------

/**
 * New cards are shown by `new_ord`, lower first. Reader captures and manual notes come first,
 * then notes from the course and the tutor, then the common words track; inside a tier the
 * older note comes first. A tier is wider than any epoch millisecond value of this century.
 */
const NEW_ORD_TIER: Record<NoteSource, number> = {
  reader: 0,
  manual: 0,
  declension: 1,
  tutor: 1,
  words: 2,
};
const TIER_WIDTH = 1e13;

export function newOrdFor(source: NoteSource, now: Date): number {
  return (NEW_ORD_TIER[source] ?? 1) * TIER_WIDTH + now.getTime();
}

/** The lemma status source a word note's source maps to. */
const STATUS_SOURCE: Record<NoteSource, LemmaStatusSource> = {
  reader: 'reader',
  words: 'triage',
  manual: 'manual',
  declension: 'manual',
  tutor: 'manual',
};

// --- Word content -------------------------------------------------------------------------

const lower = (s: string) => formKey(s);

/** The capture as a variant, when its blank holds a form of the lemma. */
function captureVariant(
  context: CaptureContext,
  forms: { form: string; tags: string }[],
): WordVariant | null {
  const { sentenceSk, blank } = context;
  if (!(blank.start >= 0 && blank.end <= sentenceSk.length && blank.start < blank.end)) return null;
  const answer = sentenceSk.slice(blank.start, blank.end);
  const match = forms.find((f) => lower(f.form) === lower(answer));
  if (!match) return null;
  const tags = splitTags(match.tags);
  const tag =
    context.tag !== undefined && tags.includes(context.tag) ? context.tag : (tags[0] ?? '');
  return {
    sentenceSk,
    sentenceEn: context.sentenceEn ?? '',
    blank: { start: blank.start, end: blank.end },
    answer,
    tag,
  };
}

/**
 * The content of a word note: up to three example sentences that cover the lemma's most used
 * forms, one form each, in the order of `top_forms`; then other sentences of forms not yet
 * covered. The capture becomes a variant when its blank holds a form of the lemma that no
 * chosen sentence covers (it then replaces the last dataset sentence). With no sentence at
 * all, the capture is the only variant; without a capture either, the base form itself is.
 */
export async function buildWordContent(
  tx: Tx,
  lemmaId: number,
  context?: CaptureContext,
): Promise<WordContent | null> {
  const info = await repo.getLemmaInfo(tx, lemmaId);
  if (!info) return null;
  const [forms, sentences] = await Promise.all([
    repo.getForms(tx, lemmaId),
    repo.getLemmaSentences(tx, lemmaId),
  ]);

  const chosen: WordVariant[] = [];
  const usedSentences = new Set<string>();
  const covered = new Set<string>();
  const take = (row: repo.LemmaSentenceRow): boolean => {
    const tok = row.tokens[row.tokenIndex];
    if (!tok || usedSentences.has(row.sentenceId)) return false;
    const answer = row.textSk.slice(tok.s, tok.e);
    if (lower(answer) !== lower(row.form)) return false;
    chosen.push({
      sentenceId: row.sentenceId,
      sentenceSk: row.textSk,
      sentenceEn: row.textEn,
      blank: { start: tok.s, end: tok.e },
      answer,
      tag: row.tag,
    });
    usedSentences.add(row.sentenceId);
    covered.add(lower(row.form));
    return true;
  };

  for (const top of info.topForms) {
    if (chosen.length >= MAX_WORD_VARIANTS) break;
    if (covered.has(lower(top.form))) continue;
    const row = sentences.find(
      (r) =>
        r.tag === top.tag && lower(r.form) === lower(top.form) && !usedSentences.has(r.sentenceId),
    );
    if (row) take(row);
  }
  for (const row of sentences) {
    if (chosen.length >= MAX_WORD_VARIANTS) break;
    if (!covered.has(lower(row.form))) take(row);
  }

  const capture = context ? captureVariant(context, forms) : null;
  if (
    capture &&
    !covered.has(lower(capture.answer)) &&
    !chosen.some((v) => v.sentenceSk === capture.sentenceSk)
  ) {
    if (chosen.length >= MAX_WORD_VARIANTS) chosen.length = MAX_WORD_VARIANTS - 1;
    chosen.push(capture);
  }
  if (chosen.length === 0 && capture) chosen.push(capture);
  if (chosen.length === 0) {
    const base = forms.find((f) => f.form === info.lemma);
    chosen.push({
      sentenceSk: info.lemma,
      sentenceEn: info.glossEn,
      blank: { start: 0, end: info.lemma.length },
      answer: info.lemma,
      tag: base ? (splitTags(base.tags)[0] ?? '') : '',
    });
  }
  return { kind: 'word', lemmaId, lemma: info.lemma, glossEn: info.glossEn, variants: chosen };
}

// --- Creating notes -----------------------------------------------------------------------

type Created = { noteId: string; created: boolean };

/** A note the id already names: returned when it is of the same kind and still live. */
function sameNote(existing: repo.NoteRow, kind: NoteKind): Created {
  if (existing.deletedAt !== null) throw conflict('The note was deleted.', { id: existing.id });
  if (existing.kind !== kind)
    throw conflict('The id names a note of another kind.', { id: existing.id });
  return { noteId: existing.id, created: false };
}

async function insertWithCard(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  n: Omit<repo.NewNote, 'userId' | 'now'>,
): Promise<boolean> {
  const now = env.clock.now();
  const inserted = await repo.insertNote(tx, { ...n, userId, now });
  if (!inserted) return false;
  await repo.insertCard(tx, {
    id: env.ids.uuid(),
    userId,
    noteId: n.id,
    newOrd: newOrdFor(n.source, now),
    schedulerState: newState(now) as unknown as Record<string, unknown>,
    schedulerVersion: SCHEDULER_VERSION,
    now,
  });
  return true;
}

export async function createWordNote(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  input: WordNoteInput,
): Promise<Created> {
  if (input.id) {
    const existing = await repo.findNote(tx, userId, input.id);
    if (existing) return sameNote(existing, 'word');
  }
  const live = await repo.findWordNote(tx, userId, input.lemmaId);
  if (live) return { noteId: live.id, created: false };

  const content = await buildWordContent(tx, input.lemmaId, input.context);
  if (!content) throw notFound('No such lemma.');
  const id = input.id ?? env.ids.uuid();
  const ok = await insertWithCard(tx, env, userId, {
    id,
    kind: 'word',
    lemmaId: input.lemmaId,
    exerciseId: null,
    textId: input.textId ?? null,
    content,
    source: input.source,
    sourceRef: null,
  });
  if (!ok) {
    const again = await repo.findWordNote(tx, userId, input.lemmaId);
    if (again) return { noteId: again.id, created: false };
    throw conflict('The id is taken.', { id });
  }
  // A word with a note is being learned, unless the learner already knows it.
  await repo.upsertLemmaStatus(
    tx,
    userId,
    [input.lemmaId],
    'learning',
    STATUS_SOURCE[input.source],
    env.clock.now(),
    ['unknown', 'ignored'],
  );
  return { noteId: id, created: true };
}

export async function createPhraseNote(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  input: PhraseNoteInput,
): Promise<Created> {
  const content: PhraseContent = PhraseContentSchema.parse(input.content);
  if (input.id) {
    const existing = await repo.findNote(tx, userId, input.id);
    if (existing) return sameNote(existing, 'phrase');
  }
  const id = input.id ?? env.ids.uuid();
  const ok = await insertWithCard(tx, env, userId, {
    id,
    kind: 'phrase',
    lemmaId: null,
    exerciseId: null,
    textId: input.textId ?? null,
    content,
    source: input.source,
    sourceRef: null,
  });
  if (!ok) throw conflict('The id is taken.', { id });
  return { noteId: id, created: true };
}

export async function createCaseSentenceNote(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  input: CaseSentenceNoteInput,
): Promise<Created> {
  const content: CaseSentenceContent = CaseSentenceContentSchema.parse(input.content);
  if (input.id) {
    const existing = await repo.findNote(tx, userId, input.id);
    if (existing) return sameNote(existing, 'case_sentence');
  }
  const exerciseId = content.exerciseId ?? null;
  if (exerciseId) {
    const live = await repo.findExerciseNote(tx, userId, exerciseId);
    if (live) return { noteId: live.id, created: false };
  }
  const id = input.id ?? env.ids.uuid();
  const ok = await insertWithCard(tx, env, userId, {
    id,
    kind: 'case_sentence',
    lemmaId: content.lemmaId ?? null,
    exerciseId,
    textId: null,
    content,
    source: input.source,
    sourceRef: input.sourceRef ?? null,
  });
  if (!ok) {
    const again = exerciseId ? await repo.findExerciseNote(tx, userId, exerciseId) : null;
    if (again) return { noteId: again.id, created: false };
    throw conflict('The id is taken.', { id });
  }
  return { noteId: id, created: true };
}

export async function suspendNote(tx: Tx, env: NotesEnv, userId: string, noteId: string) {
  const existing = await repo.findNote(tx, userId, noteId);
  if (!existing || existing.deletedAt !== null) return;
  await repo.updateNote(tx, userId, noteId, { suspended: true, now: env.clock.now() });
}

// --- Shapes -------------------------------------------------------------------------------

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

export function toNote(row: repo.NoteRow): Note {
  return {
    id: row.id,
    kind: row.kind as NoteKind,
    lemmaId: row.lemmaId,
    exerciseId: row.exerciseId,
    textId: row.textId,
    content: row.content,
    source: row.source as NoteSource,
    sourceRef: row.sourceRef ?? null,
    suspended: row.suspended,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The card as the deck shows it. The scheduler's own state is the source of the numbers. */
export function toCard(row: repo.CardRow): Card {
  const base = {
    cardId: row.id,
    noteId: row.noteId,
    suspended: row.suspended,
    lastReviewAt: iso(row.lastReviewAt),
  };
  if (isSchedulerState(row.schedulerState)) {
    return { ...base, ...snapshotOf(row.schedulerState) };
  }
  return {
    ...base,
    state: row.state as Card['state'],
    dueAt: iso(row.dueAt),
    stability: row.stability,
    difficulty: row.difficulty,
    reps: row.reps,
    lapses: row.lapses,
    scheduler: row.schedulerState ?? null,
  };
}

function toLogEntry(row: repo.ReviewRow): ReviewLogEntry {
  return {
    id: row.id,
    answeredAt: row.answeredAt.toISOString(),
    rating: row.rating as ReviewLogEntry['rating'],
    grade: row.grade as ReviewLogEntry['grade'],
    overridden: row.overridden,
    typed: row.typed,
    expected: row.expected,
    variant: row.variant,
    durationMs: row.durationMs,
  };
}

/** What the deck shows for a note: the lemma, the phrase or the cue. */
function labelOf(content: NoteContent): { label: string; glossEn: string | null } {
  if (content.kind === 'word') return { label: content.lemma, glossEn: content.glossEn || null };
  if (content.kind === 'phrase') return { label: content.textSk, glossEn: content.glossEn || null };
  return { label: content.cue, glossEn: content.sentenceEn || null };
}

// --- Endpoints ----------------------------------------------------------------------------

/** A live note of the learner with its card and last reviews; not_found otherwise. */
export async function getNoteDetail(tx: Tx, userId: string, id: string): Promise<NoteDetail> {
  const row = await repo.findNote(tx, userId, id);
  if (!row || row.deletedAt !== null) throw notFound('No such note.');
  const cardRow = await repo.findCard(tx, userId, id);
  const reviews = cardRow ? await repo.lastReviews(tx, userId, cardRow.id, DETAIL_REVIEWS) : [];
  return {
    note: toNote(row),
    card: cardRow ? toCard(cardRow) : null,
    reviews: reviews.map(toLogEntry),
  };
}

/** `POST /notes`: creates the note (or finds the one it repeats) and returns it. */
export async function createNote(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  body: CreateNote,
): Promise<NoteDetail> {
  let r: Created;
  if (body.kind === 'word') {
    try {
      r = await createWordNote(tx, env, userId, {
        id: body.id,
        lemmaId: body.lemmaId,
        source: body.source,
        ...(body.textId ? { textId: body.textId } : {}),
        ...(body.context ? { context: body.context } : {}),
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'No such lemma.')
        throw validationFailed({ 'body.lemmaId': 'Unknown lemma.' });
      throw e;
    }
  } else if (body.kind === 'phrase') {
    r = await createPhraseNote(tx, env, userId, {
      id: body.id,
      source: body.source,
      content: body.content,
      ...(body.textId ? { textId: body.textId } : {}),
    });
  } else {
    r = await createCaseSentenceNote(tx, env, userId, {
      id: body.id,
      source: body.source,
      content: body.content,
    });
  }
  return getNoteDetail(tx, userId, r.noteId);
}

export async function updateNote(
  tx: Tx,
  env: NotesEnv,
  userId: string,
  id: string,
  body: UpdateNote,
): Promise<NoteDetail> {
  const row = await repo.findNote(tx, userId, id);
  if (!row || row.deletedAt !== null) throw notFound('No such note.');
  const set: Parameters<typeof repo.updateNote>[3] = { now: env.clock.now() };
  if (body.suspended !== undefined) set.suspended = body.suspended;
  const content = body.content;
  if (content) {
    if (content.kind !== row.kind)
      throw validationFailed({ 'body.content.kind': `The note is a ${row.kind} note.` });
    if (content.kind === 'word' && content.lemmaId !== row.lemmaId)
      throw conflict('A word note keeps its lemma.');
    if (content.kind === 'case_sentence') {
      const exerciseId = content.exerciseId ?? null;
      if (exerciseId && exerciseId !== row.exerciseId) {
        const other = await repo.findExerciseNote(tx, userId, exerciseId);
        if (other && other.id !== id) throw conflict('Another note holds this exercise.');
      }
      set.exerciseId = exerciseId;
      set.lemmaId = content.lemmaId ?? null;
    }
    set.content = content;
  }
  await repo.updateNote(tx, userId, id, set);
  return getNoteDetail(tx, userId, id);
}

/** Marks the note deleted, so it leaves the queue and the deck. A repeat is harmless. */
export async function deleteNote(tx: Tx, env: NotesEnv, userId: string, id: string) {
  const row = await repo.findNote(tx, userId, id);
  if (!row) throw notFound('No such note.');
  if (row.deletedAt !== null) return;
  const now = env.clock.now();
  await repo.updateNote(tx, userId, id, { deletedAt: now, now });
}

// --- List ---------------------------------------------------------------------------------

function encodeCursor(row: repo.NoteRow): string {
  return Buffer.from(JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      c?: unknown;
      i?: unknown;
    };
    if (typeof v.c === 'string' && typeof v.i === 'string' && !Number.isNaN(Date.parse(v.c)))
      return { createdAt: new Date(v.c), id: v.i };
  } catch {
    // fall through
  }
  throw validationFailed({ 'query.cursor': 'Invalid cursor.' });
}

export async function listNotes(
  tx: Tx,
  userId: string,
  query: {
    kind?: NoteKind | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit: number;
  },
): Promise<ResponseOf<'notes.list'>> {
  const rows = await repo.listNotes(tx, userId, {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.cursor ? { after: decodeCursor(query.cursor) } : {}),
    limit: query.limit + 1,
  });
  const page = rows.slice(0, query.limit);
  const items = page.map((r): NoteSummary => {
    const card =
      r.state === null
        ? { state: 'new' as const, dueAt: null }
        : { state: r.state as NoteSummary['state'], dueAt: iso(r.dueAt) };
    return {
      id: r.note.id,
      kind: r.note.kind as NoteKind,
      ...labelOf(r.note.content),
      lemmaId: r.note.lemmaId,
      source: r.note.source as NoteSource,
      suspended: r.note.suspended,
      ...card,
      createdAt: r.note.createdAt.toISOString(),
    };
  });
  const last = page[page.length - 1];
  return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last.note) : null };
}
