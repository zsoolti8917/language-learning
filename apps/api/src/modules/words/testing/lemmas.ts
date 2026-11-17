// Generated ranked lemmas for tests. The mini dataset holds 72 lemmas ranked 1 to 72, too few
// for bands of 1,000 ranks and placement strata of 500, so tests add plain lemmas for the
// ranks after it: id 100000 + rank, lemma `w<rank>`, part of speech cycling noun, verb, adj,
// and one gloss `gloss <rank>`. They are written as the table owner, like a content load.
import type { Pos } from '@app/contracts';
import { lemma, sense } from '@app/db';
import type { TestDb } from '@app/testkit';

export const GENERATED_ID_BASE = 100_000;
const POS_CYCLE: Pos[] = ['noun', 'verb', 'adj'];

export function generatedGloss(rank: number): string {
  return `gloss ${rank}`;
}

/** Adds lemmas ranked `fromRank`..`toRank` (inclusive). */
export async function addRankedLemmas(db: TestDb, fromRank: number, toRank: number): Promise<void> {
  const lemmas = [];
  const senses = [];
  for (let rank = fromRank; rank <= toRank; rank++) {
    const id = GENERATED_ID_BASE + rank;
    const pos = POS_CYCLE[rank % POS_CYCLE.length] as Pos;
    lemmas.push({
      id,
      key: `w${rank}|${pos}|${pos === 'noun' ? 'n' : '-'}|1`,
      lemma: `w${rank}`,
      lemmaAscii: `w${rank}`,
      pos,
      gender: pos === 'noun' ? 'n' : null,
      freqRank: rank,
    });
    senses.push({ lemmaId: id, ord: 0, glossEn: generatedGloss(rank), source: 'manual' });
  }
  for (let i = 0; i < lemmas.length; i += 1000) {
    await db.db.insert(lemma).values(lemmas.slice(i, i + 1000));
    await db.db.insert(sense).values(senses.slice(i, i + 1000));
  }
}
