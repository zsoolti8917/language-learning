// The few places where the lemmas of the app differ from the SNK lemmatization. Each one
// keeps a decision of the mini dataset (docs/handoff/F9.md), so the 72 mini lemmas keep
// their keys and therefore their ids.
import type { LemmaFlags } from '@app/contracts';
import type { MappedEntry } from './snk';

/**
 * The lemma an SNK entry is filed under in the app.
 * - `tá` and `to` (pronoun readings) join `ten`, so the demonstrative has all its genders.
 * - The plural of `človek` is the suppletive `ľudia`, a plural only lemma of its own.
 */
export function redirectLemma(lemma: string, m: MappedEntry): string {
  if (m.pos === 'pron' && (lemma === 'tá' || lemma === 'to')) return 'ten';
  if (m.pos === 'noun' && lemma === 'človek' && m.tag.startsWith('p')) return 'ľudia';
  return lemma;
}

export interface LemmaOverride {
  flags?: LemmaFlags;
  /** No pattern, whatever the rules say. */
  noPattern?: boolean;
}

/** Flags set by hand, keyed by lemma key. */
export const LEMMA_OVERRIDES: Readonly<Record<string, LemmaOverride>> = {
  'človek|noun|m_anim|1': { flags: { irregular: true } },
  'ľudia|noun|m_anim|1': { flags: { irregular: true }, noPattern: true },
};
