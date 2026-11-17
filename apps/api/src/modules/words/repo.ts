// SQL of the words module (Drizzle). Owner: B6. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts.
//
// Reference data (`ling`) is read here directly, inside the learner's transaction, as
// docs/contracts.md allows ("A module may read any table from its own repo.ts"). Learner
// rows (`user_lemma`, `note`) are only read: every write goes through NotesPort.
import type {
  Aspect,
  Gender,
  LemmaFlags,
  LemmaStatus,
  Pos,
  SenseSource,
  TopForm,
} from '@app/contracts';
import {
  form,
  lemma,
  lemmaSentence,
  note,
  queryRows,
  sense,
  sentence,
  type Tx,
  userLemma,
} from '@app/db';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

export interface BandCounts {
  total: number;
  known: number;
  learning: number;
  ignored: number;
}

/** Counts of the ranked lemmas in [fromRank, toRank] by the learner's status. */
export async function countBand(tx: Tx, fromRank: number, toRank: number): Promise<BandCounts> {
  const rows = await queryRows<{
    total: number | string;
    known: number | string;
    learning: number | string;
    ignored: number | string;
  }>(
    tx,
    sql`select count(*) as total,
          count(*) filter (where ul.status = 'known') as known,
          count(*) filter (where ul.status = 'learning') as learning,
          count(*) filter (where ul.status = 'ignored') as ignored
        from ling.lemma l
        left join app.user_lemma ul on ul.lemma_id = l.id and ul.user_id = (select auth.uid())
        where l.freq_rank between ${fromRank} and ${toRank}
          and coalesce((l.flags ->> 'retired')::boolean, false) = false`,
  );
  const r = rows[0];
  return {
    total: Number(r?.total ?? 0),
    known: Number(r?.known ?? 0),
    learning: Number(r?.learning ?? 0),
    ignored: Number(r?.ignored ?? 0),
  };
}

export interface WordRow {
  lemmaId: number;
  lemma: string;
  pos: Pos;
  rank: number;
  glossEn: string | null;
  status: LemmaStatus;
  topForms: TopForm[];
}

/**
 * One page of ranked lemmas in [fromRank, toRank], ordered by rank then id, starting after
 * `after`. `status` filters by the learner's status (`unknown` includes lemmas without a row).
 */
export async function listWords(
  tx: Tx,
  opts: {
    fromRank: number;
    toRank: number;
    status?: LemmaStatus | undefined;
    after?: { rank: number; id: number } | undefined;
    limit: number;
  },
): Promise<WordRow[]> {
  const statusExpr = sql`coalesce(ul.status, 'unknown')`;
  const conds = [
    sql`l.freq_rank between ${opts.fromRank} and ${opts.toRank}`,
    sql`coalesce((l.flags ->> 'retired')::boolean, false) = false`,
  ];
  if (opts.status) conds.push(sql`${statusExpr} = ${opts.status}`);
  if (opts.after) conds.push(sql`(l.freq_rank, l.id) > (${opts.after.rank}, ${opts.after.id})`);
  const rows = await queryRows<{
    lemma_id: number;
    lemma: string;
    pos: Pos;
    rank: number;
    gloss_en: string | null;
    status: LemmaStatus;
    top_forms: TopForm[];
  }>(
    tx,
    sql`select l.id as lemma_id, l.lemma, l.pos, l.freq_rank as rank, l.top_forms,
          ${statusExpr} as status,
          (select s.gloss_en from ling.sense s where s.lemma_id = l.id order by s.ord limit 1) as gloss_en
        from ling.lemma l
        left join app.user_lemma ul on ul.lemma_id = l.id and ul.user_id = (select auth.uid())
        where ${sql.join(conds, sql` and `)}
        order by l.freq_rank, l.id
        limit ${opts.limit}`,
  );
  return rows.map((r) => ({
    lemmaId: Number(r.lemma_id),
    lemma: r.lemma,
    pos: r.pos,
    rank: Number(r.rank),
    glossEn: r.gloss_en,
    status: r.status,
    topForms: r.top_forms ?? [],
  }));
}

/** The ids among `ids` that are lemmas of the dataset. */
export async function existingLemmaIds(tx: Tx, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.select({ id: lemma.id }).from(lemma).where(inArray(lemma.id, ids));
  return new Set(rows.map((r) => r.id));
}

export interface LemmaRow {
  id: number;
  key: string;
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  pattern: string | null;
  aspect: Aspect | null;
  freqRank: number | null;
  topForms: TopForm[];
  flags: LemmaFlags;
}

export async function getLemma(tx: Tx, id: number): Promise<LemmaRow | null> {
  const [row] = await tx.select().from(lemma).where(eq(lemma.id, id));
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    lemma: row.lemma,
    pos: row.pos as Pos,
    gender: row.gender as Gender | null,
    pattern: row.pattern,
    aspect: row.aspect as Aspect | null,
    freqRank: row.freqRank,
    topForms: row.topForms,
    flags: row.flags,
  };
}

export async function getSenses(tx: Tx, lemmaId: number) {
  const rows = await tx
    .select()
    .from(sense)
    .where(eq(sense.lemmaId, lemmaId))
    .orderBy(asc(sense.ord));
  return rows.map((s) => ({
    ord: s.ord,
    glossEn: s.glossEn,
    note: s.note,
    source: s.source as SenseSource,
    verified: s.verified,
  }));
}

export async function getForms(tx: Tx, lemmaId: number) {
  return tx
    .select({ form: form.form, tags: form.tags })
    .from(form)
    .where(eq(form.lemmaId, lemmaId))
    .orderBy(asc(form.form));
}

/** Example sentences of a lemma in their content order, with the token of the lemma. */
export async function getSentences(tx: Tx, lemmaId: number, limit: number) {
  const rows = await tx
    .select({
      id: sentence.id,
      textSk: sentence.textSk,
      textEn: sentence.textEn,
      tokens: sentence.tokens,
      tokenIndex: lemmaSentence.tokenIndex,
      form: lemmaSentence.form,
      tag: lemmaSentence.tag,
    })
    .from(lemmaSentence)
    .innerJoin(sentence, eq(sentence.id, lemmaSentence.sentenceId))
    .where(eq(lemmaSentence.lemmaId, lemmaId))
    .orderBy(asc(lemmaSentence.ord), asc(sentence.id), asc(lemmaSentence.tokenIndex))
    .limit(limit);
  return rows;
}

export async function getStatus(tx: Tx, lemmaId: number): Promise<LemmaStatus> {
  const [row] = await tx
    .select({ status: userLemma.status })
    .from(userLemma)
    .where(eq(userLemma.lemmaId, lemmaId));
  return (row?.status as LemmaStatus | undefined) ?? 'unknown';
}

/** The learner's live word note of the lemma (row level security limits it to the learner). */
export async function getWordNoteId(tx: Tx, lemmaId: number): Promise<string | null> {
  const [row] = await tx
    .select({ id: note.id })
    .from(note)
    .where(and(eq(note.kind, 'word'), eq(note.lemmaId, lemmaId), isNull(note.deletedAt)));
  return row?.id ?? null;
}
