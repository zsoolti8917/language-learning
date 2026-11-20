// The model calls of the sentences stage, run through C2's batch runner:
// - `content.sentences` v1 writes example sentences for a lemma in a given form, with only
//   the allowed vocabulary (the system prompt carries it, so it is cached and paid once
//   per batch of requests);
// - `content.review` v1 is the second pass: is the sentence natural, is the target form
//   right, and is the translation right (it returns a corrected one);
// - `content.translate` v1 translates the treebank sentences that are kept.
// The prompts live with the stage (it owns them); see docs/handoff/C3.md.
import type { Pos } from '@app/contracts';
import { tryParseTag } from '@app/ling';
import { z } from 'zod';
import { sha256 } from '../../lib/files';
import type { BatchTask } from '../../model/runner';

export const SENTENCES_ROUTE = 'content.sentences';
export const REVIEW_ROUTE = 'content.review';
export const TRANSLATE_ROUTE = 'content.translate';
export const SENTENCE_GROUP_SIZE = 40;
export const REVIEW_GROUP_SIZE = 40;
export const TRANSLATE_GROUP_SIZE = 25;

export const CASE_NAMES: Record<string, string> = {
  nom: 'nominative',
  gen: 'genitive',
  dat: 'dative',
  acc: 'accusative',
  voc: 'vocative',
  loc: 'locative',
  ins: 'instrumental',
};
export const GENDER_NAMES: Record<string, string> = {
  m_anim: 'masculine animate',
  m_inan: 'masculine inanimate',
  f: 'feminine',
  n: 'neuter',
};
const VERB_FORMS: Record<string, string> = {
  I: 'infinitive',
  K: 'present tense',
  M: 'imperative',
  H: 'transgressive',
  L: 'past participle (l-form)',
  B: 'future tense',
};
const PERSONS: Record<string, string> = { a: '1st person', b: '2nd person', c: '3rd person' };
const NUMBERS: Record<string, string> = { s: 'singular', p: 'plural' };

/** A form tag in words, for the prompt: `s2` → "genitive singular". */
export function describeTag(tag: string): string {
  const p = tryParseTag(tag);
  if (!p || p.kind === 'none') return 'the only form';
  if (p.kind === 'noun') return `${CASE_NAMES[p.case]} ${NUMBERS[p.number[0] as string]}`;
  if (p.kind === 'agree')
    return `${CASE_NAMES[p.case]} ${NUMBERS[p.number[0] as string]}, ${GENDER_NAMES[p.gender]}`;
  if (p.kind === 'pron') return CASE_NAMES[p.case] as string;
  // Verb: SNK letters after `v:` — form, aspect, then number and person (K, B, M) or
  // number, person and gender (L); a final + or - is the polarity.
  const d = p.detail;
  const parts = [VERB_FORMS[d[0] as string] ?? 'verb form'];
  const rest = d.slice(2);
  if (/^[KBM]/u.test(d)) {
    if (NUMBERS[rest[0] as string])
      parts.push(`${PERSONS[rest[1] as string] ?? ''} ${NUMBERS[rest[0] as string]}`.trim());
  } else if (d[0] === 'L' && NUMBERS[rest[0] as string]) {
    parts.push(NUMBERS[rest[0] as string] as string);
  }
  if (d.endsWith('-')) parts.push('negated');
  return parts.join(', ');
}

// --- content.sentences --------------------------------------------------------------------

export interface SentenceItem {
  /** Position in the request; the answer echoes it. */
  n: number;
  lemma: string;
  pos: Pos;
  gender?: string;
  /** The form the sentence must contain, exactly as written. */
  form: string;
  tag: string;
  /** The tag in words. */
  formIs: string;
  /** English glosses, to pick the meaning. */
  meaning?: string[];
}

export interface SentenceRequest {
  items: SentenceItem[];
}

export const SentenceAnswerSchema = z.object({
  items: z.array(
    z.object({
      n: z.int(),
      sk: z.string().trim().min(1).max(200),
      en: z.string().trim().min(1).max(250),
    }),
  ),
});
export type SentenceAnswer = z.infer<typeof SentenceAnswerSchema>;

export const SENTENCES_SYSTEM = `You write example sentences for a Slovak learner's dictionary. The learners are English speakers at levels A1 to B1. Each sentence appears on a flash card that teaches one word in one of its forms.

You receive a JSON list of items. Each item has a number n, a Slovak lemma with its part of speech, the exact form the sentence must contain, that form's grammar (formIs) and sometimes the English meaning. For every item return its n, one Slovak sentence (sk) and its English translation (en).

Rules for the Slovak sentence:
- It contains the given form exactly as written (the tag is the form's code in the dictionary; formIs says the same in words), once, used with the given grammar and the given meaning.
- It has 4 to 12 words. Short and simple is better: one clause, everyday situations, present or past tense.
- Every other word is a form of a word in the allowed vocabulary below. Use no other words, no names of people or places outside the list, and no numbers written in digits.
- It is correct, natural Slovak that a native speaker would say, with correct diacritics. It starts with a capital letter and ends with a full stop, a question mark or an exclamation mark. No quotation marks or brackets.
- It makes sense on its own, without context.

Rules for the English translation: natural English that keeps the meaning and the tense, not word for word.

Return every n of the list exactly once and no other n.`;

/** The system prompt with the allowed vocabulary: the lemmas, one per line, by rank. */
export function sentencesSystem(vocabulary: readonly string[]): string {
  return `${SENTENCES_SYSTEM}

Allowed vocabulary (lemmas; any form of them may be used):
${vocabulary.join('\n')}`;
}

function echoCheck<T extends { n: number }>(asked: readonly { n: number }[], items: readonly T[]) {
  const want = new Set(asked.map((i) => i.n));
  const seen = new Set<number>();
  const problems: string[] = [];
  for (const it of items) {
    if (!want.has(it.n)) problems.push(`unknown n ${it.n}`);
    else if (seen.has(it.n)) problems.push(`n ${it.n} answered twice`);
    seen.add(it.n);
  }
  for (const n of want) if (!seen.has(n)) problems.push(`n ${n} not answered`);
  return problems;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The task for one vocabulary. Its mock writes "<Form> <three allowed words>.", which
 * passes the rules but is not Slovak: mock rows never leave the build folder.
 */
export function sentencesTask(
  vocabulary: readonly string[],
): BatchTask<SentenceRequest, SentenceAnswer> {
  return {
    route: SENTENCES_ROUTE,
    promptVersion: 1,
    effort: 'medium',
    maxTokens: 16000,
    system: sentencesSystem(vocabulary),
    schema: SentenceAnswerSchema,
    user: (input) => JSON.stringify(input.items),
    check: (input, output) => echoCheck(input.items, output.items),
    // Medium effort thinks more; about 60 tokens of JSON per sentence.
    estimateOutputTokens: (input) => 1500 + 60 * input.items.length,
    mock: (input) => ({
      items: input.items.map((i) => {
        const seed = Number.parseInt(
          sha256(`${i.lemma}|${i.form}|${i.tag}|${i.n}`).slice(0, 8),
          16,
        );
        const others = vocabulary.filter((w) => w !== i.lemma);
        const pick = (k: number) => others[(seed + k * 7919) % Math.max(1, others.length)] ?? '';
        const words = [pick(0), pick(1), pick(2)];
        return {
          n: i.n,
          sk: `${capitalise(i.form)} ${words.join(' ')}.`,
          en: `[mock] ${i.lemma} (${i.formIs})`,
        };
      }),
    }),
  };
}

// --- content.review -----------------------------------------------------------------------

export interface ReviewItem {
  n: number;
  sk: string;
  en: string;
  lemma: string;
  form: string;
  formIs: string;
}

export interface ReviewRequest {
  items: ReviewItem[];
}

export const ReviewAnswerSchema = z.object({
  items: z.array(
    z.object({
      n: z.int(),
      natural: z.boolean(),
      formCorrect: z.boolean(),
      en: z.string().trim().min(1).max(250),
      problem: z.string().max(300),
    }),
  ),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const REVIEW_SYSTEM = `You are a native Slovak speaker and an English editor. You check example sentences that another writer made for a Slovak learner's dictionary, before learners see them.

You receive a JSON list of items. Each has a number n, a Slovak sentence (sk), its English translation (en), the lemma the sentence teaches, the form of it the sentence must contain and that form's grammar (formIs).

For every item return:
- n, unchanged.
- natural: true only if the sentence is correct Slovak (grammar, agreement, diacritics, word order) and something a native speaker would actually say. Odd, stilted or meaningless sentences are false.
- formCorrect: true only if the sentence contains the given form, used as the lemma with the given grammar and in a common meaning.
- en: the right English translation. Return the given one unchanged when it is right; otherwise a corrected natural translation.
- problem: an empty string when natural and formCorrect are both true; otherwise one short sentence naming what is wrong.

Return every n of the list exactly once and no other n.`;

export const reviewTask: BatchTask<ReviewRequest, ReviewAnswer> = {
  route: REVIEW_ROUTE,
  promptVersion: 1,
  effort: 'medium',
  maxTokens: 16000,
  system: REVIEW_SYSTEM,
  schema: ReviewAnswerSchema,
  user: (input) => JSON.stringify(input.items),
  check: (input, output) => echoCheck(input.items, output.items),
  estimateOutputTokens: (input) => 1500 + 50 * input.items.length,
  mock: (input) => ({
    items: input.items.map((i) => ({
      n: i.n,
      natural: true,
      formCorrect: true,
      en: i.en,
      problem: '',
    })),
  }),
};

// --- content.translate --------------------------------------------------------------------

export interface TranslateRequest {
  items: { n: number; sk: string }[];
}

export const TranslateAnswerSchema = z.object({
  items: z.array(z.object({ n: z.int(), en: z.string().trim().min(1).max(300) })),
});
export type TranslateAnswer = z.infer<typeof TranslateAnswerSchema>;

export const TRANSLATE_SYSTEM = `You translate Slovak example sentences into English for a learner's dictionary. The sentences come from a Slovak treebank of web and news texts; each is shown on its own, without context.

You receive a JSON list of items, each with a number n and a Slovak sentence (sk). For every item return its n and a natural English translation (en) that keeps the meaning, the tense and the sentence type, not word for word. Do not add explanations.

Return every n of the list exactly once and no other n.`;

export const translateTask: BatchTask<TranslateRequest, TranslateAnswer> = {
  route: TRANSLATE_ROUTE,
  promptVersion: 1,
  effort: 'low',
  maxTokens: 8000,
  system: TRANSLATE_SYSTEM,
  schema: TranslateAnswerSchema,
  user: (input) => JSON.stringify(input.items),
  check: (input, output) => echoCheck(input.items, output.items),
  estimateOutputTokens: (input) => 300 + 35 * input.items.length,
  mock: (input) => ({ items: input.items.map((i) => ({ n: i.n, en: `[mock] ${i.sk}` })) }),
};
