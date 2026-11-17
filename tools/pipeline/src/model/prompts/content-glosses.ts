// The route `content.glosses`, version 1: short English glosses for Slovak headwords that
// the Wiktionary extract lacks. One request carries up to GLOSS_GROUP_SIZE words, so the
// stable system prompt is paid for once per group, not once per word.
import { z } from 'zod';
import type { BatchTask } from '../runner';

export const GLOSSES_ROUTE = 'content.glosses';
export const GLOSSES_PROMPT_VERSION = 1;
export const GLOSS_GROUP_SIZE = 25;
export const MAX_GLOSSES = 3;
export const MAX_GLOSS_LENGTH = 60;

export interface GlossWord {
  /** The lemma key, such as `mesto|noun|n|1`. The model echoes it back. */
  key: string;
  lemma: string;
  pos: string;
  gender?: string;
  aspect?: string;
  /** The most used forms, to tell homographs apart. */
  forms?: string[];
}

export interface GlossRequest {
  words: GlossWord[];
}

export const GlossAnswerSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      glosses: z.array(z.string().trim().min(1).max(MAX_GLOSS_LENGTH)).min(1).max(MAX_GLOSSES),
    }),
  ),
});
export type GlossAnswer = z.infer<typeof GlossAnswerSchema>;

export const GLOSSES_SYSTEM = `You write the English glosses of a Slovak learner's dictionary. The learners are English speakers at levels A1 to B1, and each gloss appears on a flash card and in a reader's word sheet.

You receive a JSON list of Slovak headwords. Each has a key, the lemma, its part of speech, and for some a gender, an aspect and its most used forms. For every headword, return its key unchanged and one to three glosses.

Rules for glosses:
- Give the most common everyday meaning first. Add a second or third gloss only for a clearly different common meaning, never a synonym of the first.
- Each gloss is one to six English words, lower case except proper nouns and "I". No Slovak, no grammar labels, no explanations, no full stop.
- Verbs start with "to" ("to do", "to go"). For a perfective verb gloss the completed action ("to finish", "to buy").
- Nouns take no article. Adjectives are given as adjectives, adverbs as adverbs.
- Pronouns, prepositions, conjunctions and particles get their usual English equivalents ("this, that", "on, onto", "because").
- If the word is a rare form, a name or an abbreviation, gloss what it most likely means in everyday Slovak; if you cannot tell, give your best short guess rather than leaving it out.

Return every key of the list exactly once and no other key.`;

function describe(w: GlossWord): Record<string, unknown> {
  const out: Record<string, unknown> = { key: w.key, lemma: w.lemma, pos: w.pos };
  if (w.gender) out.gender = w.gender;
  if (w.aspect) out.aspect = w.aspect;
  if (w.forms && w.forms.length > 0) out.forms = w.forms;
  return out;
}

export const glossesTask: BatchTask<GlossRequest, GlossAnswer> = {
  route: GLOSSES_ROUTE,
  promptVersion: GLOSSES_PROMPT_VERSION,
  effort: 'low',
  maxTokens: 8000,
  system: GLOSSES_SYSTEM,
  schema: GlossAnswerSchema,
  user: (input) => JSON.stringify(input.words.map(describe)),
  check(input, output) {
    const asked = new Set(input.words.map((w) => w.key));
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const item of output.items) {
      if (!asked.has(item.key)) problems.push(`unknown key "${item.key}"`);
      else if (seen.has(item.key)) problems.push(`key "${item.key}" answered twice`);
      seen.add(item.key);
    }
    for (const k of asked) if (!seen.has(k)) problems.push(`key "${k}" not answered`);
    return problems;
  },
  // About 25 tokens of JSON per word, plus a few hundred tokens of thinking at low effort.
  estimateOutputTokens: (input) => 300 + 25 * input.words.length,
  mock: (input) => ({
    items: input.words.map((w) => ({ key: w.key, glosses: [`[mock] ${w.lemma}`] })),
  }),
};
