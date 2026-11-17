// The two model routes of the exercises stage, kept beside the stage (docs/work-packages.md,
// "Stages that call the model keep their prompts in their own folder"):
// - `content.exercises` v1 writes one short sentence around each given gap;
// - `content.exercises.review` v1 is the second pass that reads each finished exercise.
// The model never chooses a form: every gap's form comes from the morphology, and the rule
// checks in rules.ts verify each answer before the review sees it.
import { z } from 'zod';
import type { BatchTask } from '../../model/runner';

export const EXERCISES_ROUTE = 'content.exercises';
export const EXERCISES_PROMPT_VERSION = 1;
export const REVIEW_ROUTE = 'content.exercises.review';
export const REVIEW_PROMPT_VERSION = 1;
/** Gaps per generation request. The request is the unit of caching. */
export const ITEMS_PER_REQUEST = 10;
/** Exercises per review request. */
export const REVIEWS_PER_REQUEST = 25;

export interface RequestTrigger {
  id: string;
  kind: string;
  /** A form of the trigger word to use, such as "do" or "pomáham". */
  word: string;
  meaning: string;
}

export interface RequestItem {
  slot: string;
  trigger: string;
  /** The exact words of the gap: "školu" or "novú školu". */
  gap: string;
  /** Each word of the gap with its lemma. */
  words: { form: string; lemma: string }[];
}

export interface ExerciseRequest {
  /** 'accusative singular, feminine nouns' */
  bucket: string;
  vocabularyLimit: number;
  /** Names the sentences may use. */
  names: string[];
  triggers: RequestTrigger[];
  items: RequestItem[];
}

export const ExerciseAnswerSchema = z.object({
  items: z.array(
    z.object({
      slot: z.string(),
      sentenceSk: z.string().trim().min(1).max(160),
      sentenceEn: z.string().trim().min(1).max(200),
      gap: z.string().trim().min(1).max(60),
    }),
  ),
});
export type ExerciseAnswer = z.infer<typeof ExerciseAnswerSchema>;

export const EXERCISES_SYSTEM = `You write practice sentences for a Slovak case trainer. The learners are English speakers at level A2. Each sentence becomes a gap exercise: the learner sees the sentence with one gap and types the missing word in the right case.

You receive a JSON request. "bucket" names the case, number and gender being practised. "triggers" lists the words that demand the case (prepositions, verbs, numerals, quantity words, question words), each with a form to use and its meaning. "items" lists the gaps: for each, a slot id, the trigger to use and the exact gap text, already in the right form.

For every item write one sentence:
- The gap text appears in the sentence exactly once, letter for letter. Do not change its form, its spelling or its word order. Capitalise it only if it starts the sentence.
- The given trigger demands the case of the gap. A preposition, numeral, quantity word, container noun or adjective trigger stands directly before the gap. A verb trigger is in the same clause as the gap, and no preposition stands right before the gap. A question word trigger opens a short question, and the gap is in the answer: "Komu pomáhaš? Bratovi."
- You may use another form of the trigger (another person or tense of a verb, zo for z, so for s, vo for v, ku for k) when Slovak needs it.
- 4 to 10 words, one or two short sentences, natural everyday Slovak that a learner could hear in daily life. Only very common words, within the most common Slovak words of the vocabulary limit. No other names than those in "names". No numbers written as digits.
- The sentence must make the case of the gap clear from the trigger alone: only one case fits.
- sentenceEn is a natural English translation of the whole sentence.

Return every slot of the request exactly once, with its sentence, its translation and the gap text as it appears in the sentence.`;

export const exercisesTask: BatchTask<ExerciseRequest, ExerciseAnswer> = {
  route: EXERCISES_ROUTE,
  promptVersion: EXERCISES_PROMPT_VERSION,
  effort: 'medium',
  maxTokens: 12000,
  system: EXERCISES_SYSTEM,
  schema: ExerciseAnswerSchema,
  user: (input) => JSON.stringify(input),
  check(input, output) {
    const asked = new Set(input.items.map((i) => i.slot));
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const item of output.items) {
      if (!asked.has(item.slot)) problems.push(`unknown slot "${item.slot}"`);
      else if (seen.has(item.slot)) problems.push(`slot "${item.slot}" answered twice`);
      seen.add(item.slot);
    }
    for (const s of asked) if (!seen.has(s)) problems.push(`slot "${s}" not answered`);
    return problems;
  },
  // About 80 tokens of JSON per sentence, plus thinking at medium effort.
  estimateOutputTokens: (input) => 1500 + 80 * input.items.length,
  mock: (input) => ({
    items: input.items.map((item) => {
      const t = input.triggers.find((x) => x.id === item.trigger);
      const word = t?.word ?? '';
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const sentenceSk =
        t?.kind === 'question' ? `${cap(word)}? ${cap(item.gap)}.` : `${cap(word)} ${item.gap}.`;
      return {
        slot: item.slot,
        sentenceSk,
        sentenceEn: `[mock] ${word} ${item.gap}`,
        gap: item.gap,
      };
    }),
  }),
};

export interface ReviewItem {
  id: string;
  sentenceSk: string;
  sentenceEn: string;
  /** The gap as it stands in the sentence. */
  gap: string;
  /** 'školu: accusative singular of škola' */
  expected: string;
  /** 'vidieť (to see)' */
  trigger: string;
}

export interface ReviewRequest {
  items: ReviewItem[];
}

export const ReviewAnswerSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      natural: z.boolean(),
      translationCorrect: z.boolean(),
      onlyThisCase: z.boolean(),
      problem: z.string().max(200).optional(),
    }),
  ),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const REVIEW_SYSTEM = `You review gap exercises of a Slovak case trainer for English-speaking learners at level A2. A machine wrote each sentence around a given word form, and rules have already checked that every word exists and that the gap has the expected case.

For each exercise you receive the Slovak sentence, its English translation, the gap text, the expected form with its case, and the trigger word that should demand that case. Judge it as a careful native speaker and teacher:
- natural: the Slovak sentence is grammatical, natural and plausible in everyday life, with correct agreement and word order. Mark false for anything odd, stilted, wrong in meaning, or unsuitable for learners.
- translationCorrect: the English sentence translates the Slovak one correctly and naturally.
- onlyThisCase: a learner who sees the sentence with the gap and the base form can tell that the expected case is the only right one, because of the trigger. Mark false if another case or form would also be correct in the gap.
- problem: when anything is false, say in a few words what is wrong; otherwise leave it out.

Return every id of the request exactly once.`;

export const reviewTask: BatchTask<ReviewRequest, ReviewAnswer> = {
  route: REVIEW_ROUTE,
  promptVersion: REVIEW_PROMPT_VERSION,
  effort: 'medium',
  maxTokens: 12000,
  system: REVIEW_SYSTEM,
  schema: ReviewAnswerSchema,
  user: (input) => JSON.stringify(input.items),
  check(input, output) {
    const asked = new Set(input.items.map((i) => i.id));
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const item of output.items) {
      if (!asked.has(item.id)) problems.push(`unknown id "${item.id}"`);
      else if (seen.has(item.id)) problems.push(`id "${item.id}" answered twice`);
      seen.add(item.id);
    }
    for (const s of asked) if (!seen.has(s)) problems.push(`id "${s}" not answered`);
    return problems;
  },
  estimateOutputTokens: (input) => 1200 + 30 * input.items.length,
  mock: (input) => ({
    items: input.items.map((i) => ({
      id: i.id,
      natural: true,
      translationCorrect: true,
      onlyThisCase: true,
    })),
  }),
};
