// The model calls of the audit stage: a second pass over a random sample of the finished
// content, the "review reports" of work package I2. Three routes share one answer shape:
// - `content.audit.sentences` v1 reads example sentences with their translation and the
//   forms they teach;
// - `content.audit.exercises` v1 reads exercises with their key, as a learner meets them;
// - `content.audit.glosses` v1 reads the English glosses of a lemma.
// A verdict changes nothing in the set: the stage only reports it.
import { z } from 'zod';
import type { BatchTask } from '../../model/runner';

export const AUDIT_KINDS = ['sentences', 'exercises', 'glosses'] as const;
export type AuditKind = (typeof AUDIT_KINDS)[number];

export const AUDIT_ROUTES: Record<AuditKind, string> = {
  sentences: 'content.audit.sentences',
  exercises: 'content.audit.exercises',
  glosses: 'content.audit.glosses',
};
export const AUDIT_PROMPT_VERSION = 1;
/** Items per request. */
export const AUDIT_GROUP_SIZE = 25;

export const AUDIT_VERDICTS = ['ok', 'minor', 'wrong'] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

export const AuditAnswerSchema = z.object({
  items: z.array(
    z.object({
      n: z.int(),
      verdict: z.enum(AUDIT_VERDICTS),
      /** What is wrong, in English; empty for `ok`. */
      problem: z.string().max(500),
      /** The corrected text; empty for `ok` and when the item should go. */
      fix: z.string().max(500),
    }),
  ),
});
export type AuditAnswer = z.infer<typeof AuditAnswerSchema>;

export interface AuditRequest<I extends { n: number }> {
  items: I[];
}

/** A word a sentence teaches: one of its links to the dictionary. */
export interface TaughtWord {
  lemma: string;
  pos: string;
  gender?: string;
  /** English glosses of the lemma, the most common first. */
  meaning?: string[];
  form: string;
  /** The grammar of the form in words: "genitive singular". */
  formIs: string;
}

export interface SentenceAuditItem {
  n: number;
  sk: string;
  en: string;
  /** `tatoeba` (a sentence collection), `ud` (a treebank) or `generated` (a writer). */
  source: string;
  teaches: TaughtWord[];
}

export interface ExerciseAuditItem {
  n: number;
  kind: string;
  sk: string;
  en: string;
  /** The form the learner must give, as it stands in the sentence. */
  answer: string;
  /** The dictionary form the learner is shown. */
  cue: string;
  /** Case, number and gender of the answer in words. */
  asks: string;
  /** What governs the case: "k + dative: to, towards". */
  trigger?: string;
  /** The choices of a choice exercise, the right one marked. */
  options?: { text: string; correct: boolean }[];
}

export interface GlossAuditItem {
  n: number;
  lemma: string;
  pos: string;
  gender?: string;
  aspect?: string;
  /** The glosses in the order the app shows them, each with its note when it has one. */
  glosses: string[];
}

const VERDICT_RULES = `- problem: an empty string for "ok"; otherwise one or two short English sentences that name what is wrong.
- fix: an empty string for "ok"; otherwise the corrected text, or an empty string when the item should be removed.

Do not report matters of taste: a simple, ordinary item is what a learner needs. Return every n of the list exactly once and no other n.`;

export const AUDIT_SENTENCES_SYSTEM = `You are a native Slovak speaker and an English editor. You audit a random sample of the example sentences of a Slovak learning app, after they were written and checked once. Learners at levels A1 to B1 meet each sentence on a flash card and trust it.

You receive a JSON list of items. Each has a number n, a Slovak sentence (sk), its English translation (en), its source (tatoeba: a public sentence collection; ud: a treebank of web and news texts; generated: a writer) and the words it teaches. Each taught word has its lemma, part of speech, gender where it has one, English meaning where the dictionary has one, the form that stands in the sentence and that form's grammar (formIs).

For every item return:
- n, unchanged.
- verdict: "wrong" when a learner would learn something false: a mistake in the Slovak (grammar, agreement, case government, verb form, word order, spelling, diacritics), a translation that says something else, or a taught form that is not a form of that lemma, does not have that grammar in this sentence or is used in a meaning of another word. "minor" when nothing is false but the item should be better: Slovak that is correct but stiff or odd, a translation that is loose or unnatural English. "ok" otherwise.
${VERDICT_RULES}`;

export const AUDIT_EXERCISES_SYSTEM = `You are a native Slovak speaker and a teacher of Slovak as a foreign language. You audit a random sample of the declension exercises of a Slovak learning app, after they were written and checked once. The learners struggle most with declension, so an exercise that is wrong or has two right answers does harm.

You receive a JSON list of items. Each has a number n, the kind of exercise, a Slovak sentence (sk), its English translation (en), the answer (the form the learner must give, as it stands in the sentence), the cue (the dictionary form the learner is shown), what the answer is (asks: its case, number and gender) and, where the exercise practises a rule, the trigger: the word that governs the case, with the case and its meaning. The kinds:
- cloze: the learner sees the sentence with the answer blanked out, the translation and the cue, and types the form.
- choice_form: the same, and the learner picks the form among the options.
- choice_meaning: the learner sees the whole sentence and picks what the trigger means with this case, among the options.

For every item return:
- n, unchanged.
- verdict: "wrong" when a learner would learn something false or be marked wrong unfairly: a mistake in the Slovak, a translation that says something else, an answer that is not the stated case, number and gender of the cue in this sentence, a trigger that does not govern the answer here, an option marked wrong that is also right, or another form of the cue that fits the blank as well as the answer while neither the sentence nor the translation decides. "minor" when nothing is false but the item should be better: a correct but stiff or odd sentence, a loose translation. "ok" otherwise.
${VERDICT_RULES}`;

export const AUDIT_GLOSSES_SYSTEM = `You are a lexicographer of Slovak and English. You audit a random sample of the dictionary of a Slovak learning app for English speakers. The app shows the glosses of a word on its flash card and when the learner taps the word in a text.

You receive a JSON list of items. Each has a number n, a Slovak lemma, its part of speech, its gender or aspect where it has one, and its English glosses in the order the app shows them; a gloss can carry a note in brackets.

For every item return:
- n, unchanged.
- verdict: "wrong" when a learner would learn something false: a gloss that is not a meaning of this lemma in this part of speech (a meaning of another word with the same spelling, of another part of speech, or simply not what the word means), or a first gloss that hides the main meaning behind a rare one. "minor" when nothing is false but the entry should be better: a common meaning is missing, a gloss is vague, cut off or too long to read on a card, the same gloss is repeated. "ok" otherwise.
${VERDICT_RULES.replace('the corrected text', 'the glosses the entry should have, separated by "; "')}`;

function auditProblems(asked: readonly { n: number }[], output: AuditAnswer): string[] {
  const want = new Set(asked.map((i) => i.n));
  const seen = new Set<number>();
  const problems: string[] = [];
  for (const it of output.items) {
    if (!want.has(it.n)) problems.push(`unknown n ${it.n}`);
    else if (seen.has(it.n)) problems.push(`n ${it.n} answered twice`);
    seen.add(it.n);
    const said = it.problem.trim().length > 0;
    if (it.verdict === 'ok' && said) problems.push(`n ${it.n}: verdict "ok" with a problem`);
    if (it.verdict !== 'ok' && !said)
      problems.push(`n ${it.n}: verdict "${it.verdict}" without a problem`);
  }
  for (const n of want) if (!seen.has(n)) problems.push(`n ${n} not answered`);
  return problems;
}

function auditTask<I extends { n: number }>(
  kind: AuditKind,
  system: string,
): BatchTask<AuditRequest<I>, AuditAnswer> {
  return {
    route: AUDIT_ROUTES[kind],
    promptVersion: AUDIT_PROMPT_VERSION,
    effort: 'high',
    maxTokens: 16000,
    system,
    schema: AuditAnswerSchema,
    user: (input) => JSON.stringify(input.items),
    check: (input, output) => auditProblems(input.items, output),
    // High effort reads every item closely; about 60 tokens of JSON per item.
    estimateOutputTokens: (input) => 2500 + 200 * input.items.length,
    mock: (input) => ({
      items: input.items.map((i) => ({ n: i.n, verdict: 'ok' as const, problem: '', fix: '' })),
    }),
  };
}

export const auditSentencesTask = auditTask<SentenceAuditItem>('sentences', AUDIT_SENTENCES_SYSTEM);
export const auditExercisesTask = auditTask<ExerciseAuditItem>('exercises', AUDIT_EXERCISES_SYSTEM);
export const auditGlossesTask = auditTask<GlossAuditItem>('glosses', AUDIT_GLOSSES_SYSTEM);
