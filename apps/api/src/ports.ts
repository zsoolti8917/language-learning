// Port interfaces (docs/contracts.md, "Internal ports"). A module reaches another module's
// logic only through these. Each provider module's `port.ts` returns an implementation;
// `container.ts` wires them. Changing this file is a shared surface change.
import type { AiGateway } from '@app/ai';
import type {
  AttemptSource,
  BucketMastery,
  CaptureContextSchema,
  Case,
  CaseSentenceContent,
  Diagnosis,
  ErrorType,
  FormCandidate,
  Gender,
  GrammaticalNumber,
  Lemma,
  LemmaStatus,
  LemmaStatusSource,
  NoteSource,
  Paradigm,
  PhraseContent,
  Pos,
  Sense,
  TextAnalysis,
  Timestamp,
} from '@app/contracts';
import type { Database, Tx } from '@app/db';
import type { z } from 'zod';
import type { Config } from './platform/config';

export type {
  AiErrorCode,
  AiGateway,
  ChatMessage,
  DailySpend,
  GatewayConfig,
  PromptBlock,
  StreamRequest,
  StructuredRequest,
  Usage,
  UsageFunctions,
  UsageRow,
} from '@app/ai';
export { AiGatewayError, isAiGatewayError } from '@app/ai';
export type { Tx } from '@app/db';

// --- Lexicon (B2) -----------------------------------------------------------------

export interface MorphologyPort {
  /**
   * Every lemma each form can belong to. The map is keyed by `lookupKey(form)` (lower case,
   * accents folded) and holds a key for every input form; an unknown form has an empty list.
   * The candidates of one key are all forms that fold to it (`mesta` and `mestá` share a key),
   * exact matches of the input first; filter by `candidate.form` to tell them apart.
   */
  lookupForms(forms: string[]): Promise<Map<string, FormCandidate[]>>;
  /** Every form with its tags. Throws for an unknown lemma. */
  getParadigm(lemmaId: number): Promise<Paradigm>;
  /** The readings of `form` that match `want`; empty when the form is not such a form. */
  verifyForm(
    form: string,
    want: { lemmaId?: number; case?: Case; number?: GrammaticalNumber },
  ): Promise<FormCandidate[]>;
  getLemma(lemmaId: number): Promise<Lemma | null>;
  /** Lemmas whose base form is `text` (case and accents ignored), optionally of one part of speech. */
  findLemma(text: string, pos?: Pos): Promise<Lemma[]>;
}

export interface DictionaryPort {
  getSenses(lemmaIds: number[]): Promise<Map<number, Sense[]>>;
  /** Glosses of every lemma; missing ones are asked from the model once and stored. */
  ensureGlosses(
    lemmaIds: number[],
    ctx?: { sentenceSk: string; userId?: string },
  ): Promise<Map<number, string[]>>;
}

/** The key of `MorphologyPort.lookupForms`: lower case with accents folded. */
export { foldAscii as lookupKey } from '@app/contracts';

// --- Notes (B1) -------------------------------------------------------------------

export type CaptureContext = z.infer<typeof CaptureContextSchema>;

/** One word note per lemma: a second call for the same lemma returns the existing note. */
export interface WordNoteInput {
  /** The id to use when the note is new; generated when omitted. */
  id?: string;
  lemmaId: number;
  source: NoteSource;
  textId?: string;
  /** Where the word was captured; becomes a variant when it fits. */
  context?: CaptureContext;
}

export interface PhraseNoteInput {
  id?: string;
  source: NoteSource;
  textId?: string;
  content: PhraseContent;
}

/** One note per exercise: a second call with the same `content.exerciseId` returns it. */
export interface CaseSentenceNoteInput {
  id?: string;
  source: NoteSource;
  content: CaseSentenceContent;
  sourceRef?: Record<string, unknown>;
}

export interface NotesPort {
  createWordNote(tx: Tx, input: WordNoteInput): Promise<{ noteId: string; created: boolean }>;
  createPhraseNote(tx: Tx, input: PhraseNoteInput): Promise<{ noteId: string; created: boolean }>;
  createCaseSentenceNote(
    tx: Tx,
    input: CaseSentenceNoteInput,
  ): Promise<{ noteId: string; created: boolean }>;
  suspendNote(tx: Tx, noteId: string): Promise<void>;
  /** One statement for the whole list. */
  setLemmaStatus(
    tx: Tx,
    lemmaIds: number[],
    status: LemmaStatus,
    source: LemmaStatusSource,
  ): Promise<void>;
}

// --- Attempts (B5) ----------------------------------------------------------------

/** One case attempt, as `app.attempt` stores it. A repeated id is skipped. */
export interface AttemptRecord {
  id: string;
  source: AttemptSource;
  sourceRef?: string;
  exerciseId?: string;
  lemmaId?: number;
  case: Case;
  number: GrammaticalNumber;
  gender?: Gender;
  pattern?: string;
  triggerId?: string;
  correct: boolean;
  retry?: boolean;
  diagnosis?: Diagnosis;
  errorType?: ErrorType;
  given?: string;
  expected?: string;
  givenCase?: Case;
  occurredAt: Timestamp;
  durationMs?: number;
}

export interface AttemptsPort {
  record(tx: Tx, attempts: AttemptRecord[]): Promise<void>;
  /** Mastery of every bucket the learner has attempted (more buckets may be listed). */
  getMastery(tx: Tx): Promise<BucketMastery[]>;
}

// --- Analyzer (B3) ----------------------------------------------------------------

export interface AnalyzerPort {
  analyzeText(
    body: string,
    opts: { userId: string },
  ): Promise<{ analysis: TextAnalysis; tokenCount: number; lemmaCounts: Record<number, number> }>;
}

// --- Platform (F5) ----------------------------------------------------------------

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  /** A new UUID (v7 in production, so ids sort by time). */
  uuid(): string;
}

/** Work that outlives the response: `waitUntil` on Vercel, a tracked promise elsewhere. */
export interface Background {
  runInBackground(task: Promise<unknown>): void;
  /** Waits until every task started so far has settled (tests, shutdown). */
  drain(): Promise<void>;
}

/** The ports that modules provide to each other. */
export interface Ports {
  morphology: MorphologyPort;
  dictionary: DictionaryPort;
  notes: NotesPort;
  attempts: AttemptsPort;
  analyzer: AnalyzerPort;
}

/**
 * What a port factory (`modules/<m>/port.ts`) receives. `ports` is filled while the container
 * is built: a factory may keep the reference but must use other ports only inside its
 * methods, never while it is being constructed.
 */
export interface PortContext {
  config: Config;
  database: Database;
  clock: Clock;
  ids: IdGenerator;
  ai: AiGateway;
  background: Background;
  ports: Ports;
}
