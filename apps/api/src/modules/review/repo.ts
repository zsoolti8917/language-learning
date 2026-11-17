// SQL of the review module (Drizzle). Owner: B1. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. Every query filters by the
// learner as well, so ownership holds twice (row level security is the second wall).
import type { Case, TriggerKind } from '@app/contracts';
import {
  card,
  form,
  lemma,
  note,
  profile,
  queryRows,
  review,
  type Tx,
  trigger,
  userLemma,
} from '@app/db';
import { and, asc, eq, inArray, isNull, lte, type SQL, sql } from 'drizzle-orm';
import type { LingData } from './items';

export type CardRow = typeof card.$inferSelect;
export type NoteRow = typeof note.$inferSelect;
export type NewReview = typeof review.$inferInsert;

export interface ReviewSettings {
  timezone: string;
  dayStartHour: number;
  dailyNewLimit: number;
  dailyReviewLimit: number;
  desiredRetention: number;
  strictDiacritics: boolean;
}

export async function getSettings(tx: Tx, userId: string): Promise<ReviewSettings> {
  const [p] = await tx
    .select({
      timezone: profile.timezone,
      dayStartHour: profile.dayStartHour,
      dailyNewLimit: profile.dailyNewLimit,
      dailyReviewLimit: profile.dailyReviewLimit,
      desiredRetention: profile.desiredRetention,
      strictDiacritics: profile.strictDiacritics,
    })
    .from(profile)
    .where(eq(profile.userId, userId));
  return (
    p ?? {
      timezone: 'Europe/Bratislava',
      dayStartHour: 4,
      dailyNewLimit: 10,
      dailyReviewLimit: 80,
      desiredRetention: 0.9,
      strictDiacritics: false,
    }
  );
}

// --- Queue --------------------------------------------------------------------------------

export type QueueGroup = 'learning' | 'review' | 'new';

/** Live cards: neither the card nor the note is suspended, and the note is not deleted. */
function groupWhere(userId: string, group: QueueGroup, now: Date): SQL {
  const live = and(
    eq(card.userId, userId),
    eq(card.suspended, false),
    eq(note.suspended, false),
    isNull(note.deletedAt),
  ) as SQL;
  switch (group) {
    case 'learning':
      return and(
        live,
        inArray(card.state, ['learning', 'relearning']),
        lte(card.dueAt, now),
      ) as SQL;
    case 'review':
      return and(live, eq(card.state, 'review'), lte(card.dueAt, now)) as SQL;
    case 'new':
      return and(live, eq(card.state, 'new')) as SQL;
  }
}

function groupOrder(group: QueueGroup) {
  return group === 'new'
    ? [sql`${card.newOrd} asc nulls last`, asc(card.createdAt), asc(card.id)]
    : [asc(card.dueAt), asc(card.id)];
}

export async function countGroup(
  tx: Tx,
  userId: string,
  group: QueueGroup,
  now: Date,
): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(groupWhere(userId, group, now));
  return Number(row?.n ?? 0);
}

export async function listGroup(
  tx: Tx,
  userId: string,
  group: QueueGroup,
  now: Date,
  limit: number,
): Promise<{ card: CardRow; note: NoteRow }[]> {
  if (limit <= 0) return [];
  return tx
    .select({ card, note })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(groupWhere(userId, group, now))
    .orderBy(...groupOrder(group))
    .limit(limit);
}

/**
 * What the learner did in the learner day [start, end), as Today (B7) counts it: new cards
 * started (cards whose first review falls in the day) and reviews done (reviews in the day of
 * cards first reviewed before it).
 */
export async function doneInDay(
  tx: Tx,
  userId: string,
  day: { start: Date; end: Date },
): Promise<{ newDone: number; reviewDone: number }> {
  const start = day.start.toISOString();
  const end = day.end.toISOString();
  const [row] = await queryRows<{ new_done: number; review_done: number }>(
    tx,
    sql`with first as (
          select card_id, min(answered_at) as first_at
          from app.review where user_id = ${userId}::uuid group by card_id
        )
        select
          (select count(*)::int from first
            where first_at >= ${start}::timestamptz and first_at < ${end}::timestamptz) as new_done,
          (select count(*)::int from app.review r join first f on f.card_id = r.card_id
            where r.user_id = ${userId}::uuid
              and r.answered_at >= ${start}::timestamptz
              and r.answered_at < ${end}::timestamptz
              and f.first_at < ${start}::timestamptz) as review_done`,
  );
  return { newDone: Number(row?.new_done ?? 0), reviewDone: Number(row?.review_done ?? 0) };
}

// --- Reference data -----------------------------------------------------------------------

export async function loadLing(
  tx: Tx,
  need: { lemmaIds: number[]; triggerIds: string[] },
): Promise<LingData> {
  const data: LingData = { lemmas: new Map(), forms: new Map(), triggers: new Map() };
  if (need.lemmaIds.length > 0) {
    const [lemmas, forms] = await Promise.all([
      tx
        .select({ id: lemma.id, gender: lemma.gender, pattern: lemma.pattern })
        .from(lemma)
        .where(inArray(lemma.id, need.lemmaIds)),
      tx
        .select({ lemmaId: form.lemmaId, form: form.form, tags: form.tags })
        .from(form)
        .where(inArray(form.lemmaId, need.lemmaIds)),
    ]);
    for (const l of lemmas) data.lemmas.set(l.id, { gender: l.gender, pattern: l.pattern });
    for (const f of forms) {
      const list = data.forms.get(f.lemmaId) ?? [];
      list.push({ form: f.form, tags: f.tags });
      data.forms.set(f.lemmaId, list);
    }
  }
  if (need.triggerIds.length > 0) {
    const rows = await tx
      .select({ id: trigger.id, kind: trigger.kind, lemma: trigger.lemma, gCase: trigger.gCase })
      .from(trigger)
      .where(inArray(trigger.id, need.triggerIds));
    for (const t of rows)
      data.triggers.set(t.id, {
        kind: t.kind as TriggerKind,
        lemma: t.lemma,
        case: t.gCase as Case,
      });
  }
  return data;
}

// --- Answers ------------------------------------------------------------------------------

export async function findReviews(
  tx: Tx,
  userId: string,
  ids: string[],
): Promise<{ id: string; cardId: string; grade: string; rating: number }[]> {
  if (ids.length === 0) return [];
  return tx
    .select({ id: review.id, cardId: review.cardId, grade: review.grade, rating: review.rating })
    .from(review)
    .where(and(eq(review.userId, userId), inArray(review.id, ids)));
}

/** The learner's cards with their notes, locked for the rest of the transaction. */
export async function lockCards(
  tx: Tx,
  userId: string,
  cardIds: string[],
): Promise<{ card: CardRow; note: NoteRow }[]> {
  if (cardIds.length === 0) return [];
  return tx
    .select({ card, note })
    .from(card)
    .innerJoin(note, eq(note.id, card.noteId))
    .where(and(eq(card.userId, userId), inArray(card.id, cardIds)))
    .orderBy(asc(card.id))
    .for('update');
}

export async function getCards(tx: Tx, userId: string, cardIds: string[]): Promise<CardRow[]> {
  if (cardIds.length === 0) return [];
  return tx
    .select()
    .from(card)
    .where(and(eq(card.userId, userId), inArray(card.id, cardIds)));
}

/** The whole log of a card. */
export async function cardLog(
  tx: Tx,
  userId: string,
  cardId: string,
): Promise<{ id: string; answeredAt: Date; rating: number }[]> {
  return tx
    .select({ id: review.id, answeredAt: review.answeredAt, rating: review.rating })
    .from(review)
    .where(and(eq(review.userId, userId), eq(review.cardId, cardId)))
    .orderBy(asc(review.answeredAt), asc(review.id));
}

/** Inserts reviews; returns the ids that were new (a repeated id is skipped). */
export async function insertReviews(tx: Tx, rows: NewReview[]): Promise<Set<string>> {
  if (rows.length === 0) return new Set();
  const inserted = await tx
    .insert(review)
    .values(rows)
    .onConflictDoNothing({ target: review.id })
    .returning({ id: review.id });
  return new Set(inserted.map((r) => r.id));
}

export async function updateCard(
  tx: Tx,
  userId: string,
  cardId: string,
  set: Partial<
    Pick<
      CardRow,
      | 'state'
      | 'dueAt'
      | 'stability'
      | 'difficulty'
      | 'reps'
      | 'lapses'
      | 'lastReviewAt'
      | 'schedulerState'
      | 'schedulerVersion'
      | 'variantCursor'
      | 'updatedAt'
    >
  >,
): Promise<void> {
  await tx
    .update(card)
    .set(set)
    .where(and(eq(card.userId, userId), eq(card.id, cardId)));
}

/** Lemmas among `lemmaIds` that the learner does not have as known yet. */
export async function notYetKnown(tx: Tx, userId: string, lemmaIds: number[]): Promise<number[]> {
  if (lemmaIds.length === 0) return [];
  const known = await tx
    .select({ lemmaId: userLemma.lemmaId })
    .from(userLemma)
    .where(
      and(
        eq(userLemma.userId, userId),
        inArray(userLemma.lemmaId, lemmaIds),
        eq(userLemma.status, 'known'),
      ),
    );
  const k = new Set(known.map((r) => r.lemmaId));
  return lemmaIds.filter((id) => !k.has(id));
}
