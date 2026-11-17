// Review queue, answers and card state (docs/contracts.md, "Shared data shapes: Review").
import { z } from 'zod';
import { CountSchema, FormMapSchema, SpanSchema, TimestampSchema, UuidSchema } from '../common';
import {
  CardStateSchema,
  CaseSchema,
  GradeSchema,
  GrammaticalNumberSchema,
  NoteKindSchema,
  RatingSchema,
} from '../enums';

export const ReviewPromptSchema = z.object({
  /** The whole sentence. */
  sentenceSk: z.string().min(1),
  /** The part to hide. */
  blank: SpanSchema,
  sentenceEn: z.string(),
  /** Base form shown for a case sentence: 'nové mesto'. */
  cue: z.string().optional(),
  /** Word and phrase notes. */
  glossEn: z.string().optional(),
});
export type ReviewPrompt = z.infer<typeof ReviewPromptSchema>;

export const ReviewExplainSchema = z.object({
  case: CaseSchema.optional(),
  number: GrammaticalNumberSchema.optional(),
  triggerLabel: z.string().optional(),
  patternId: z.string().optional(),
});

export const ReviewItemSchema = z.object({
  cardId: UuidSchema,
  noteId: UuidSchema,
  kind: NoteKindSchema,
  state: CardStateSchema,
  dueAt: TimestampSchema.nullable(),
  prompt: ReviewPromptSchema,
  /** Accepted answers; the first is shown as the solution. */
  answers: z.array(z.string().min(1)).min(1),
  /** Every form of the target word mapped to its form tags, for diagnosis. */
  formMap: FormMapSchema,
  explain: ReviewExplainSchema.optional(),
  /** Which sentence of the note this is. */
  variant: z.int().nonnegative(),
  /** Opaque state for packages/srs. */
  scheduler: z.unknown(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

export const ReviewAnswerSchema = z.object({
  id: UuidSchema,
  cardId: UuidSchema,
  answeredAt: TimestampSchema,
  typed: z.string(),
  variant: z.int().nonnegative(),
  clientGrade: GradeSchema,
  rating: RatingSchema,
  overridden: z.boolean(),
  durationMs: z.int().nonnegative(),
});
export type ReviewAnswer = z.infer<typeof ReviewAnswerSchema>;

export const CardSnapshotSchema = z.object({
  cardId: UuidSchema,
  state: CardStateSchema,
  dueAt: TimestampSchema.nullable(),
  stability: z.number().nullable(),
  difficulty: z.number().nullable(),
  reps: CountSchema,
  lapses: CountSchema,
  scheduler: z.unknown(),
});
export type CardSnapshot = z.infer<typeof CardSnapshotSchema>;

export const QueueCountsSchema = z.object({
  due: CountSchema,
  new: CountSchema,
  learning: CountSchema,
});
export type QueueCounts = z.infer<typeof QueueCountsSchema>;

/** `GET /review/queue` */
export const ReviewQueueSchema = z.object({
  items: z.array(ReviewItemSchema),
  counts: QueueCountsSchema,
  serverTime: TimestampSchema,
});
export type ReviewQueue = z.infer<typeof ReviewQueueSchema>;

/** `POST /review/answers` body */
export const SubmitAnswersSchema = z.object({
  clientId: z.string().min(1),
  answers: z.array(ReviewAnswerSchema).min(1).max(200),
});
export type SubmitAnswers = z.infer<typeof SubmitAnswersSchema>;

export const AnswerResultSchema = z.object({
  id: UuidSchema,
  cardId: UuidSchema,
  grade: GradeSchema,
  rating: RatingSchema,
  card: CardSnapshotSchema,
});
export type AnswerResult = z.infer<typeof AnswerResultSchema>;

/** `POST /review/answers` response */
export const SubmitAnswersResultSchema = z.object({
  results: z.array(AnswerResultSchema),
  counts: QueueCountsSchema,
});
export type SubmitAnswersResult = z.infer<typeof SubmitAnswersResultSchema>;

/** One past review of a card, as the deck shows it. */
export const ReviewLogEntrySchema = z.object({
  id: UuidSchema,
  answeredAt: TimestampSchema,
  rating: RatingSchema,
  grade: GradeSchema,
  overridden: z.boolean(),
  typed: z.string().nullable(),
  expected: z.string().nullable(),
  variant: z.int().nonnegative().nullable(),
  durationMs: z.int().nonnegative().nullable(),
});
export type ReviewLogEntry = z.infer<typeof ReviewLogEntrySchema>;

/** A card as the deck shows it. */
export const CardSchema = CardSnapshotSchema.extend({
  noteId: UuidSchema,
  suspended: z.boolean(),
  lastReviewAt: TimestampSchema.nullable(),
});
export type Card = z.infer<typeof CardSchema>;
