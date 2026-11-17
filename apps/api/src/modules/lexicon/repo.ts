// SQL of the lexicon module (Drizzle). Owner: B2. Only this file of the module runs SQL.
// Every read goes to schema `ling`, which the login role may read; the one write (run time
// glosses) goes to `ling.sense`, which `app_api` may insert into.
import { form, lemma, type Queryable, sense } from '@app/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

/** A row of `ling.lemma` with the columns the API returns. */
export type LemmaRow = typeof lemma.$inferSelect;

/** A form with the lemma columns a `FormCandidate` needs. */
export interface FormLemmaRow {
  lemmaId: number;
  form: string;
  formAscii: string;
  tags: string;
  lemma: string;
  pos: string;
  gender: string | null;
  freqRank: number | null;
}

export type SenseRow = typeof sense.$inferSelect;

/**
 * Postgres takes at most 65 535 parameters per statement. Batches above this size are split;
 * below it (every realistic text) the lookup is one statement.
 */
export const MAX_KEYS_PER_QUERY = 10_000;

const formLemmaColumns = {
  lemmaId: form.lemmaId,
  form: form.form,
  formAscii: form.formAscii,
  tags: form.tags,
  lemma: lemma.lemma,
  pos: lemma.pos,
  gender: lemma.gender,
  freqRank: lemma.freqRank,
};

/** Every form whose folded spelling is one of `keys`, with its lemma. One statement. */
export function selectFormsByAscii(q: Queryable, keys: readonly string[]): Promise<FormLemmaRow[]> {
  return q
    .select(formLemmaColumns)
    .from(form)
    .innerJoin(lemma, eq(lemma.id, form.lemmaId))
    .where(inArray(form.formAscii, [...keys]));
}

/** Every form of one lemma. */
export function selectFormsOfLemma(
  q: Queryable,
  lemmaId: number,
): Promise<{ form: string; tags: string }[]> {
  return q
    .select({ form: form.form, tags: form.tags })
    .from(form)
    .where(eq(form.lemmaId, lemmaId))
    .orderBy(asc(form.form));
}

export async function selectLemma(q: Queryable, lemmaId: number): Promise<LemmaRow | null> {
  const rows = await q.select().from(lemma).where(eq(lemma.id, lemmaId)).limit(1);
  return rows[0] ?? null;
}

export function selectLemmas(q: Queryable, lemmaIds: readonly number[]): Promise<LemmaRow[]> {
  if (lemmaIds.length === 0) return Promise.resolve([]);
  return q
    .select()
    .from(lemma)
    .where(inArray(lemma.id, [...lemmaIds]));
}

/** Lemmas whose folded base form is `ascii`, most frequent first. */
export function selectLemmasByAscii(
  q: Queryable,
  ascii: string,
  pos?: string,
): Promise<LemmaRow[]> {
  return q
    .select()
    .from(lemma)
    .where(
      pos === undefined
        ? eq(lemma.lemmaAscii, ascii)
        : and(eq(lemma.lemmaAscii, ascii), eq(lemma.pos, pos)),
    )
    .orderBy(sql`${lemma.freqRank} asc nulls last`, asc(lemma.id));
}

/** The senses of the lemmas, in `ord` order per lemma. */
export function selectSenses(q: Queryable, lemmaIds: readonly number[]): Promise<SenseRow[]> {
  if (lemmaIds.length === 0) return Promise.resolve([]);
  return q
    .select()
    .from(sense)
    .where(inArray(sense.lemmaId, [...lemmaIds]))
    .orderBy(asc(sense.lemmaId), asc(sense.ord));
}

/**
 * Stores run time glosses (source `runtime`, not verified). A lemma that gained senses in the
 * meantime (another request, a content load) keeps them: rows that exist are left alone.
 */
export async function insertRuntimeGlosses(
  q: Queryable,
  rows: readonly { lemmaId: number; ord: number; glossEn: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await q
    .insert(sense)
    .values(rows.map((r) => ({ ...r, source: 'runtime', verified: false })))
    .onConflictDoNothing();
}
