// SQL of the analyzer module (Drizzle). Owner: B3. Only this file of the module runs SQL;
// it maps snake_case columns to the camelCase shapes of contracts. The analyzer reads
// reference data only (schema `ling`), so callers run these in `withSystem`.
import type { Case, Gender, Pos, TopForm, TriggerKind } from '@app/contracts';
import { lemma, type Tx, trigger } from '@app/db';
import { inArray } from 'drizzle-orm';

/** The lemma facts the analyzer needs: the lemma map and the frequency of a reading. */
export interface LemmaFacts {
  id: number;
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  freqRank: number | null;
  topForms: TopForm[];
}

/** One row of `ling.trigger`, as the rules use it. */
export interface TriggerFacts {
  id: string;
  kind: TriggerKind;
  lemma: string;
  lemmaId: number | null;
  case: Case;
}

/** The lemmas with these ids, in one query. Unknown ids are left out. */
export async function lemmasByIds(tx: Tx, ids: readonly number[]): Promise<LemmaFacts[]> {
  if (ids.length === 0) return [];
  const rows = await tx
    .select({
      id: lemma.id,
      lemma: lemma.lemma,
      pos: lemma.pos,
      gender: lemma.gender,
      freqRank: lemma.freqRank,
      topForms: lemma.topForms,
    })
    .from(lemma)
    .where(inArray(lemma.id, [...ids]));
  return rows.map((r) => ({
    id: r.id,
    lemma: r.lemma,
    pos: r.pos as Pos,
    gender: (r.gender as Gender | null) ?? null,
    freqRank: r.freqRank,
    topForms: r.topForms ?? [],
  }));
}

/** Every trigger row (a few hundred at most). */
export async function allTriggers(tx: Tx): Promise<TriggerFacts[]> {
  const rows = await tx
    .select({
      id: trigger.id,
      kind: trigger.kind,
      lemma: trigger.lemma,
      lemmaId: trigger.lemmaId,
      gCase: trigger.gCase,
    })
    .from(trigger);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as TriggerKind,
    lemma: r.lemma,
    lemmaId: r.lemmaId,
    case: r.gCase as Case,
  }));
}
