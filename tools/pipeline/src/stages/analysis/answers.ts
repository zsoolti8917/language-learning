// What makes an answer of the analysis routes usable, beyond its schema. The analyzer itself
// ignores a pick it cannot use and guesses instead; an offline writer should hear about it,
// so the offline gateway and `offline lint` both use these checks.
import type { Disambiguation } from '@app/api/modules/analyzer/model';
import { type GlossAnswer, MAX_GLOSSES } from '@app/api/modules/lexicon/service';

export const DISAMBIGUATE_ROUTE = 'reader.disambiguate';
export const GLOSS_ROUTE = 'reader.gloss';
export const ANALYSIS_ROUTES = [DISAMBIGUATE_ROUTE, GLOSS_ROUTE] as const;

/** The user message of `reader.disambiguate` (apps/api, modules/analyzer/model.ts). */
export interface DisambiguationInput {
  contexts: string[];
  words: {
    w: number;
    context: number;
    word: string;
    readings: {
      i: number;
      lemma: string;
      pos: string;
      case?: string;
      number?: string;
      gender?: string;
      verbTag?: string;
    }[];
  }[];
}

/** The user message of `reader.gloss` (apps/api, modules/lexicon/service.ts). */
export interface GlossInput {
  lemmas: { lemmaId: number; lemma: string; pos: string; gender?: string; aspect?: string }[];
  sentence?: string;
}

/** Every word has exactly one pick, and the pick is one of its readings. */
export function disambiguationProblems(input: DisambiguationInput, answer: Disambiguation) {
  const problems: string[] = [];
  const words = new Map(input.words.map((w) => [w.w, w]));
  const seen = new Set<number>();
  for (const p of answer.picks) {
    const w = words.get(p.w);
    if (!w) problems.push(`a pick for word ${p.w}, which the request does not ask`);
    else if (seen.has(p.w)) problems.push(`word ${p.w} ("${w.word}") is picked twice`);
    else if (!w.readings.some((r) => r.i === p.c))
      problems.push(`word ${p.w} ("${w.word}") has no reading ${p.c}`);
    seen.add(p.w);
  }
  for (const w of input.words)
    if (!seen.has(w.w)) problems.push(`no pick for word ${w.w} ("${w.word}")`);
  return problems;
}

/** Every lemma has exactly one entry of one to three glosses. */
export function glossProblems(input: GlossInput, answer: GlossAnswer): string[] {
  const problems: string[] = [];
  const lemmas = new Map(input.lemmas.map((l) => [l.lemmaId, l]));
  const seen = new Set<number>();
  for (const g of answer.glosses) {
    const l = lemmas.get(g.lemmaId);
    if (!l) problems.push(`glosses for lemma ${g.lemmaId}, which the request does not ask`);
    else if (seen.has(g.lemmaId)) problems.push(`lemma ${g.lemmaId} (${l.lemma}) is glossed twice`);
    else if (g.glosses.length > MAX_GLOSSES)
      problems.push(`lemma ${g.lemmaId} (${l.lemma}) has more than ${MAX_GLOSSES} glosses`);
    else if (new Set(g.glosses.map((x) => x.toLowerCase())).size < g.glosses.length)
      problems.push(`lemma ${g.lemmaId} (${l.lemma}) has the same gloss twice`);
    seen.add(g.lemmaId);
  }
  for (const l of input.lemmas)
    if (!seen.has(l.lemmaId)) problems.push(`no glosses for lemma ${l.lemmaId} (${l.lemma})`);
  return problems;
}

/** The problems of a parsed answer of either route, given the request's user message. */
export function answerProblems(route: string, user: string, data: unknown): string[] {
  if (route === DISAMBIGUATE_ROUTE)
    return disambiguationProblems(JSON.parse(user) as DisambiguationInput, data as Disambiguation);
  if (route === GLOSS_ROUTE)
    return glossProblems(JSON.parse(user) as GlossInput, data as GlossAnswer);
  return [];
}
