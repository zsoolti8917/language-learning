// The shapes of the three eval datasets (`tools/evals/data/*.jsonl`).
import type { Case, GrammaticalNumber } from '@app/contracts';

/**
 * What governs the case of a phrase, read from the treebank's tree: a preposition (`case`
 * dependent), a numeral (`nummod`), a verb (object or oblique of a verb), the subject
 * (nominative), a noun (attribute of a noun, mostly genitive), or anything else.
 */
export const TRIGGER_CLASSES = [
  'preposition',
  'verb',
  'numeral',
  'subject',
  'noun',
  'other',
] as const;
export type TriggerClass = (typeof TRIGGER_CLASSES)[number];

/** A correct sentence of the treebank: the tutor must find no case error in it. */
export interface CorrectCase {
  id: string;
  sentId: string;
  text: string;
}

/** One word the injection changed. */
export interface ChangedWord {
  start: number;
  end: number;
  given: string;
  expected: string;
}

/** The label of an injected case error. Offsets are UTF-16 units of `InjectedCase.text`. */
export interface InjectedLabel {
  /** From the first to the last changed word. */
  start: number;
  end: number;
  /** The wrong words as the sentence now has them. */
  given: string;
  /** The words as the treebank has them: the expected correction. */
  expected: string;
  caseExpected: Case;
  caseGiven: Case;
  number: GrammaticalNumber;
  /** The head noun's lemma. */
  lemma: string;
  triggerClass: TriggerClass;
  /** The governing word (the preposition as written, or the verb's lemma), when there is one. */
  trigger?: string | undefined;
  words: ChangedWord[];
}

/** A treebank sentence with one noun phrase swapped into another case. */
export interface InjectedCase {
  id: string;
  sentId: string;
  /** The sentence with the error. */
  text: string;
  /** The original sentence. */
  original: string;
  label: InjectedLabel;
}

/** One word of an analyzer sentence with the treebank's checked lemma and case. */
export interface GoldWord {
  s: number;
  e: number;
  form: string;
  /** The treebank lemma (lower case for proper names, as UD has it). */
  lemma: string;
  upos: string;
  case?: Case | undefined;
  number?: GrammaticalNumber | undefined;
}

export interface AnalyzerCase {
  id: string;
  sentId: string;
  text: string;
  words: GoldWord[];
}

export interface DatasetManifest {
  /** The seed the selection and the injection used. */
  seed: number;
  sources: string[];
  morphology: string;
  counts: { correct: number; injected: number; analyzer: number };
  /** Sentences the injection tried and could not change (no form, no lemma, no phrase). */
  injectionSkipped: number;
}
