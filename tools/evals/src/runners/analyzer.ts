// The analyzer eval: treebank sentences go through the analyzer as imported texts (ten
// sentences per text, as a learner pastes a paragraph), and every word's lemma and case are
// compared with the treebank's checked ones. The analyzer runs as the API runs it
// (modules/analyzer/service.ts), with the morphology, lemma facts and triggers in memory.
import type { AiGateway } from '@app/ai';
import { analyzeText } from '@app/api/modules/analyzer/service';
import type { Case, ReadingMethod } from '@app/contracts';
import { readTag } from '@app/ling';
import type { AnalyzerCase } from '../datasets/types';
import type { Lexicon } from '../lexicon';
import { silentDictionary } from '../lexicon';
import { CASE_BEARING_UPOS } from '../ud/features';
import { mapPool } from './pool';
import { EVAL_USER_ID } from './tutor';

/** How a word's reading was chosen; `none` when the word is unknown to the data. */
export type Method = ReadingMethod | 'none';

export interface ScoredWord {
  caseId: string;
  form: string;
  upos: string;
  goldLemma: string;
  goldCase?: Case | undefined;
  lemma?: string | undefined;
  case?: Case | undefined;
  method: Method;
  /** The analyzer has a token with exactly this word's span. */
  aligned: boolean;
  lemmaOk: boolean;
  /** Undefined when the word has no gold case to score. */
  caseOk?: boolean | undefined;
}

export interface AnalyzerRunOptions {
  gateway: AiGateway;
  lexicon: Lexicon;
  /** Sentences per imported text. */
  perText: number;
  concurrency: number;
}

const lower = (s: string) => s.normalize('NFC').toLowerCase();

/**
 * Lemmas the treebank and the morphology data name differently by convention, not by error:
 * the treebank files *to* and *tá* under their own lemma and the data under *ten*; the plural
 * *ľudia* is its own lemma in the data; the data makes negated verbs lemmas of their own
 * (*nemať*), the treebank files them under the positive verb.
 */
const SAME_LEMMA: ReadonlyMap<string, string> = new Map([
  ['to', 'ten'],
  ['tá', 'ten'],
  ['človek', 'ľudia'],
]);

export function sameLemma(predicted: string, gold: string, upos: string): boolean {
  const p = lower(predicted);
  const g = lower(gold);
  if (p === g) return true;
  if (SAME_LEMMA.get(g) === p || SAME_LEMMA.get(p) === g) return true;
  return (upos === 'VERB' || upos === 'AUX') && p === `ne${g}`;
}

/** Words whose case is scored: nominal words with a gold case (prepositions carry none). */
export function scoresCase(w: { upos: string; case?: Case | undefined }): boolean {
  return w.case !== undefined && CASE_BEARING_UPOS.has(w.upos);
}

export async function runAnalyzerText(
  cases: readonly AnalyzerCase[],
  opts: AnalyzerRunOptions,
): Promise<ScoredWord[]> {
  let body = '';
  const bases: number[] = [];
  for (const c of cases) {
    if (body) body += ' ';
    bases.push(body.length);
    body += c.text;
  }
  const morphology = opts.lexicon.morphology();
  const { analysis } = await analyzeText(
    {
      morphology,
      dictionary: silentDictionary(),
      ai: opts.gateway,
      lemmas: async (ids) => opts.lexicon.lemmaFacts(ids),
      triggers: async () => opts.lexicon.triggerFacts(),
    },
    body,
    { userId: EVAL_USER_ID },
  );
  const tokens = new Map<string, (typeof analysis.sentences)[number]['tokens'][number]>();
  for (const s of analysis.sentences) for (const t of s.tokens) tokens.set(`${t.s}:${t.e}`, t);

  const out: ScoredWord[] = [];
  cases.forEach((c, i) => {
    const base = bases[i] as number;
    for (const w of c.words) {
      const t = tokens.get(`${w.s + base}:${w.e + base}`);
      const scored: ScoredWord = {
        caseId: c.id,
        form: w.form,
        upos: w.upos,
        goldLemma: w.lemma,
        goldCase: w.case,
        method: 'none',
        aligned: t !== undefined,
        lemmaOk: false,
      };
      if (t?.l !== undefined) {
        scored.lemma = analysis.lemmas[String(t.l)]?.lemma;
        scored.method = t.m ?? 'none';
        if (t.tag) scored.case = readTag(t.tag).case;
      }
      scored.lemmaOk = scored.lemma !== undefined && sameLemma(scored.lemma, w.lemma, w.upos);
      if (scoresCase(w)) scored.caseOk = scored.case === w.case;
      out.push(scored);
    }
  });
  return out;
}

export async function runAnalyzerEval(
  cases: readonly AnalyzerCase[],
  opts: AnalyzerRunOptions,
): Promise<ScoredWord[]> {
  const groups: AnalyzerCase[][] = [];
  for (let i = 0; i < cases.length; i += opts.perText)
    groups.push(cases.slice(i, i + opts.perText));
  const results = await mapPool(groups, opts.concurrency, (g) => runAnalyzerText(g, opts));
  return results.flat();
}
