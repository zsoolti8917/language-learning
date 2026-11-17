// The route `content.review` for library texts, version 1: a second model pass that reads a
// graded text as a Slovak editor would and lists what is wrong with it. One text per request.
// The answer only marks the text as reviewed and lists problems for a person to fix; it never
// rewrites the text.
import { z } from 'zod';
import type { BatchTask } from '../../model/runner';

export const REVIEW_ROUTE = 'content.review';
export const REVIEW_PROMPT_VERSION = 1;
export const MAX_REVIEW_PROBLEMS = 30;

export interface ReviewInput {
  id: string;
  title: string;
  level: string;
  body: string;
}

export const ReviewProblemSchema = z.object({
  /** The words concerned, copied exactly from the text. */
  quote: z.string().min(1),
  /** What is wrong, in English. */
  issue: z.string().min(1),
  /** The corrected Slovak, or empty when the passage should go. */
  fix: z.string(),
});

export const ReviewAnswerSchema = z.object({
  /** `ok`: fit to publish as it is. `revise`: at least one problem must be fixed first. */
  verdict: z.enum(['ok', 'revise']),
  /** The level the reviewer would give the text. */
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  problems: z.array(ReviewProblemSchema).max(MAX_REVIEW_PROBLEMS),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const REVIEW_SYSTEM = `You are a native Slovak editor who checks graded reading texts for English speaking learners of Slovak at levels A2 and B1. Each text was written for a language learning app and will be read word by word, with every word linked to its dictionary entry, so it must be correct, natural standard Slovak.

You receive one text as JSON: its id, title, intended level (CEFR) and body. Read it carefully and report every problem of these kinds:
- Grammar: wrong case, number or gender endings, agreement, verb forms, aspect, word order that a native speaker would not use.
- Spelling: missing or wrong diacritics, Czech spellings, typing errors.
- Naturalness: phrasing that is understandable but sounds translated or odd to a native speaker.
- Facts: statements about Slovakia, its customs or its places that are wrong.
- Level: sentences or words clearly too hard for the intended level.

For each problem, quote the words concerned exactly as they appear in the body (a short span, not the whole sentence), say in one English sentence what is wrong, and give the corrected Slovak for the quoted span. Do not report matters of taste, and do not rewrite correct sentences.

Then give your verdict: "ok" when the text can be published as it is, "revise" when at least one problem must be fixed. Also give the CEFR level you would assign the text. Return an empty list of problems for a text without any.`;

export const reviewTask: BatchTask<ReviewInput, ReviewAnswer> = {
  route: REVIEW_ROUTE,
  promptVersion: REVIEW_PROMPT_VERSION,
  effort: 'medium',
  maxTokens: 8000,
  system: REVIEW_SYSTEM,
  schema: ReviewAnswerSchema,
  user: (input) =>
    JSON.stringify({ id: input.id, title: input.title, level: input.level, body: input.body }),
  check(input, output) {
    const problems: string[] = [];
    for (const p of output.problems)
      if (!input.body.includes(p.quote)) problems.push(`quote "${p.quote}" is not in the text`);
    if (output.verdict === 'revise' && output.problems.length === 0)
      problems.push('verdict "revise" without a problem');
    return problems;
  },
  // A few hundred tokens of JSON plus thinking at medium effort on a page of Slovak.
  estimateOutputTokens: (input) => 2000 + Math.ceil(input.body.length / 4),
  mock: (input) => ({ verdict: 'ok', level: input.level as ReviewAnswer['level'], problems: [] }),
};
