// The shared vocabulary (docs/contracts.md, "Shared vocabulary").
// Each list is a constant array, so the database can build its check constraints
// from it, and a zod enum built from that array. Types carry the list's name.
import { z } from 'zod';

export const CASES = ['nom', 'gen', 'dat', 'acc', 'voc', 'loc', 'ins'] as const;
export const CaseSchema = z.enum(CASES);
export type Case = z.infer<typeof CaseSchema>;

/** Grammatical number. Called `Number` in the docs; renamed so it never shadows the global. */
export const NUMBERS = ['sg', 'pl'] as const;
export const GrammaticalNumberSchema = z.enum(NUMBERS);
export type GrammaticalNumber = z.infer<typeof GrammaticalNumberSchema>;

export const GENDERS = ['m_anim', 'm_inan', 'f', 'n'] as const;
export const GenderSchema = z.enum(GENDERS);
export type Gender = z.infer<typeof GenderSchema>;

export const POS = [
  'noun',
  'adj',
  'pron',
  'num',
  'verb',
  'adv',
  'prep',
  'conj',
  'part',
  'intj',
  'other',
] as const;
export const PosSchema = z.enum(POS);
export type Pos = z.infer<typeof PosSchema>;

/** 1 again, 2 hard, 3 good, 4 easy. */
export const RATINGS = [1, 2, 3, 4] as const;
export const RatingSchema = z.literal(RATINGS);
export type Rating = z.infer<typeof RatingSchema>;

export const GRADES = ['correct', 'close', 'wrong', 'revealed'] as const;
export const GradeSchema = z.enum(GRADES);
export type Grade = z.infer<typeof GradeSchema>;

export const CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;
export const CardStateSchema = z.enum(CARD_STATES);
export type CardState = z.infer<typeof CardStateSchema>;

export const NOTE_KINDS = ['word', 'phrase', 'case_sentence'] as const;
export const NoteKindSchema = z.enum(NOTE_KINDS);
export type NoteKind = z.infer<typeof NoteKindSchema>;

export const LEMMA_STATUSES = ['unknown', 'learning', 'known', 'ignored'] as const;
export const LemmaStatusSchema = z.enum(LEMMA_STATUSES);
export type LemmaStatus = z.infer<typeof LemmaStatusSchema>;

export const DIAGNOSES = [
  'correct',
  'other_case',
  'diacritics',
  'wrong_pattern',
  'not_a_form',
] as const;
export const DiagnosisSchema = z.enum(DIAGNOSES);
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/** Error types the tutor corrects during the chat. */
export const CASE_ERROR_TYPES = [
  'case_after_preposition',
  'case_after_verb',
  'case_after_numeral',
  'case_other',
  'agreement_gender',
  'agreement_number',
  'agreement_case',
  'animacy',
  'genitive_plural',
  'pattern_ending',
  'pronoun_form',
] as const;
/** Error types that appear only in the end summary. */
export const OTHER_ERROR_TYPES = [
  'verb_form',
  'aspect',
  'word_order',
  'vocabulary',
  'spelling',
  'other',
] as const;
export const ERROR_TYPES = [...CASE_ERROR_TYPES, ...OTHER_ERROR_TYPES] as const;
export const ErrorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;
export const CaseErrorTypeSchema = z.enum(CASE_ERROR_TYPES);
export type CaseErrorType = z.infer<typeof CaseErrorTypeSchema>;
export function isCaseErrorType(t: ErrorType): t is CaseErrorType {
  return (CASE_ERROR_TYPES as readonly string[]).includes(t);
}

export const TUTOR_ERROR_STATUSES = [
  'prompted',
  'self_corrected',
  'corrected',
  'summary_only',
  'disputed',
] as const;
export const TutorErrorStatusSchema = z.enum(TUTOR_ERROR_STATUSES);
export type TutorErrorStatus = z.infer<typeof TutorErrorStatusSchema>;

export const LESSON_STATUSES = [
  'locked',
  'available',
  'in_progress',
  'completed',
  'tested_out',
] as const;
export const LessonStatusSchema = z.enum(LESSON_STATUSES);
export type LessonStatus = z.infer<typeof LessonStatusSchema>;

export const LESSON_STEP_KINDS = [
  'explain',
  'triggers',
  'comprehension',
  'production',
  'checkpoint',
] as const;
export const LessonStepKindSchema = z.enum(LESSON_STEP_KINDS);
export type LessonStepKind = z.infer<typeof LessonStepKindSchema>;

export const TEXT_STATUSES = ['processing', 'ready', 'failed'] as const;
export const TextStatusSchema = z.enum(TEXT_STATUSES);
export type TextStatus = z.infer<typeof TextStatusSchema>;

export const TRIGGER_KINDS = [
  'preposition',
  'verb',
  'numeral',
  'quantifier',
  'question',
  'adjective',
  'noun',
  'function',
] as const;
export const TriggerKindSchema = z.enum(TRIGGER_KINDS);
export type TriggerKind = z.infer<typeof TriggerKindSchema>;

export const EXERCISE_KINDS = ['cloze', 'choice_meaning', 'choice_form'] as const;
export const ExerciseKindSchema = z.enum(EXERCISE_KINDS);
export type ExerciseKind = z.infer<typeof ExerciseKindSchema>;

export const READING_METHODS = ['single', 'rule', 'model', 'guess'] as const;
export const ReadingMethodSchema = z.enum(READING_METHODS);
export type ReadingMethod = z.infer<typeof ReadingMethodSchema>;

export const AI_ROUTES = [
  'tutor.analyze',
  'tutor.reply',
  'tutor.summary',
  'reader.disambiguate',
  'reader.gloss',
  'reader.translate',
] as const;
export const AiRouteSchema = z.enum(AI_ROUTES);
export type AiRoute = z.infer<typeof AiRouteSchema>;

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation_failed',
  'conflict',
  'rate_limited',
  'budget_exceeded',
  'upstream_failed',
  'internal',
] as const;
export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** HTTP status of each error code (docs/contracts.md, "Errors"). */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  budget_exceeded: 429,
  upstream_failed: 502,
  internal: 500,
};

// ---------------------------------------------------------------------------
// Value lists of single columns. They are not in the vocabulary table, but the
// table comments fix them, and the database builds check constraints from them.

/** `app.user_lemma.source` */
export const LEMMA_STATUS_SOURCES = ['placement', 'triage', 'reader', 'review', 'manual'] as const;
export const LemmaStatusSourceSchema = z.enum(LEMMA_STATUS_SOURCES);
export type LemmaStatusSource = z.infer<typeof LemmaStatusSourceSchema>;

/** `app.note.source` */
export const NOTE_SOURCES = ['reader', 'words', 'declension', 'tutor', 'manual'] as const;
export const NoteSourceSchema = z.enum(NOTE_SOURCES);
export type NoteSource = z.infer<typeof NoteSourceSchema>;

/** `app.attempt.source` */
export const ATTEMPT_SOURCES = ['trainer', 'lesson', 'review', 'placement', 'tutor'] as const;
export const AttemptSourceSchema = z.enum(ATTEMPT_SOURCES);
export type AttemptSource = z.infer<typeof AttemptSourceSchema>;

/** `app.text.source` */
export const TEXT_SOURCES = ['paste', 'library', 'generated', 'url'] as const;
export const TextSourceSchema = z.enum(TEXT_SOURCES);
export type TextSource = z.infer<typeof TextSourceSchema>;

/** `ling.scenario.mode`, `app.conversation.mode` */
export const SCENARIO_MODES = ['scenario', 'case_coach'] as const;
export const ScenarioModeSchema = z.enum(SCENARIO_MODES);
export type ScenarioMode = z.infer<typeof ScenarioModeSchema>;

/** `app.conversation.status`, `app.placement.status` */
export const RUN_STATUSES = ['active', 'completed', 'abandoned'] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** `app.message.role` */
export const MESSAGE_ROLES = ['tutor', 'learner', 'system_note'] as const;
export const MessageRoleSchema = z.enum(MESSAGE_ROLES);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** `app.tutor_error.severity` */
export const ERROR_SEVERITIES = ['case', 'other'] as const;
export const ErrorSeveritySchema = z.enum(ERROR_SEVERITIES);
export type ErrorSeverity = z.infer<typeof ErrorSeveritySchema>;

/** `app.ai_call.status` */
export const AI_CALL_STATUSES = ['ok', 'refused', 'truncated', 'error'] as const;
export const AiCallStatusSchema = z.enum(AI_CALL_STATUSES);
export type AiCallStatus = z.infer<typeof AiCallStatusSchema>;

/** `app.content_report.target_kind` */
export const REPORT_TARGET_KINDS = [
  'exercise',
  'sense',
  'sentence',
  'lesson',
  'tutor_error',
  'analysis_token',
] as const;
export const ReportTargetKindSchema = z.enum(REPORT_TARGET_KINDS);
export type ReportTargetKind = z.infer<typeof ReportTargetKindSchema>;

/** `app.content_report.status` */
export const REPORT_STATUSES = ['open', 'resolved'] as const;
export const ReportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/** `ling.sense.source` */
export const SENSE_SOURCES = ['wiktionary', 'generated', 'manual', 'runtime'] as const;
export const SenseSourceSchema = z.enum(SENSE_SOURCES);
export type SenseSource = z.infer<typeof SenseSourceSchema>;

/** `ling.sentence.source` */
export const SENTENCE_SOURCES = ['tatoeba', 'ud', 'generated'] as const;
export const SentenceSourceSchema = z.enum(SENTENCE_SOURCES);
export type SentenceSource = z.infer<typeof SentenceSourceSchema>;

/** `ling.exercise.source` */
export const EXERCISE_SOURCES = ['authored', 'generated', 'ud', 'tatoeba'] as const;
export const ExerciseSourceSchema = z.enum(EXERCISE_SOURCES);
export type ExerciseSource = z.infer<typeof ExerciseSourceSchema>;

/** `ling.library_text.source` */
export const LIBRARY_SOURCES = ['authored', 'generated', 'public_domain'] as const;
export const LibrarySourceSchema = z.enum(LIBRARY_SOURCES);
export type LibrarySource = z.infer<typeof LibrarySourceSchema>;

/** `ling.lemma.aspect`, verbs only */
export const ASPECTS = ['ipf', 'pf', 'both'] as const;
export const AspectSchema = z.enum(ASPECTS);
export type Aspect = z.infer<typeof AspectSchema>;

/** `ling.pattern.pos` */
export const PATTERN_POS = ['noun', 'adj'] as const;
export const PatternPosSchema = z.enum(PATTERN_POS);
export type PatternPos = z.infer<typeof PatternPosSchema>;

/** CEFR level: `app.profile.level`, `ling.scenario.level`, `ling.library_text.level` */
export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

/** Token type in a text analysis and in `ling/tokenize` */
export const TOKEN_TYPES = ['word', 'num', 'punct'] as const;
export const TokenTypeSchema = z.enum(TOKEN_TYPES);
export type TokenType = z.infer<typeof TokenTypeSchema>;

/** `BucketMastery.level` */
export const MASTERY_LEVELS = ['unseen', 'weak', 'ok', 'strong'] as const;
export const MasteryLevelSchema = z.enum(MASTERY_LEVELS);
export type MasteryLevel = z.infer<typeof MasteryLevelSchema>;

/** `POST /declension/sessions` mode */
export const SESSION_MODES = ['lesson', 'mixed', 'weak'] as const;
export const SessionModeSchema = z.enum(SESSION_MODES);
export type SessionMode = z.infer<typeof SessionModeSchema>;

/** `POST /words/triage` decision */
export const TRIAGE_DECISIONS = ['known', 'learn', 'ignored'] as const;
export const TriageDecisionSchema = z.enum(TRIAGE_DECISIONS);
export type TriageDecision = z.infer<typeof TriageDecisionSchema>;

/** `POST /tutor/conversations/:id/peek` kind */
export const PEEK_KINDS = ['translate', 'hint', 'answer'] as const;
export const PeekKindSchema = z.enum(PEEK_KINDS);
export type PeekKind = z.infer<typeof PeekKindSchema>;

/** `app.card.template` */
export const CARD_TEMPLATES = ['recall'] as const;
export const CardTemplateSchema = z.enum(CARD_TEMPLATES);
export type CardTemplate = z.infer<typeof CardTemplateSchema>;
