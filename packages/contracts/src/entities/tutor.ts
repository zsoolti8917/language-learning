// Tutor scenarios, conversations and the message stream (docs/contracts.md, "Tutor stream").
import { z } from 'zod';
import {
  CountSchema,
  ErrorBodySchema,
  LemmaIdSchema,
  LIMITS,
  page,
  TimestampSchema,
  UuidSchema,
} from '../common';
import {
  CaseSchema,
  ErrorSeveritySchema,
  ErrorTypeSchema,
  LevelSchema,
  MessageRoleSchema,
  PeekKindSchema,
  ReportTargetKindSchema,
  RunStatusSchema,
  ScenarioModeSchema,
  TutorErrorStatusSchema,
} from '../enums';

export const ScenarioSummarySchema = z.object({
  id: z.string().min(1),
  mode: ScenarioModeSchema,
  titleEn: z.string(),
  titleSk: z.string(),
  goalEn: z.string(),
  level: LevelSchema,
  targetCases: z.array(CaseSchema),
  timesDone: CountSchema,
});
export type ScenarioSummary = z.infer<typeof ScenarioSummarySchema>;

/** `GET /tutor/scenarios` */
export const ScenarioListSchema = z.object({ items: z.array(ScenarioSummarySchema) });

export const SuccessCriterionSchema = z.object({ id: z.string().min(1), textEn: z.string() });
export const VocabHintSchema = z.object({ sk: z.string().min(1), en: z.string() });

/** The part of a scenario the chat screen shows. */
export const ScenarioBriefSchema = z.object({
  id: z.string().min(1),
  mode: ScenarioModeSchema,
  titleEn: z.string(),
  titleSk: z.string(),
  goalEn: z.string(),
  settingSk: z.string(),
  level: LevelSchema,
  successCriteria: z.array(SuccessCriterionSchema),
  vocabHint: z.array(VocabHintSchema),
});
export type ScenarioBrief = z.infer<typeof ScenarioBriefSchema>;

export const GoalStateSchema = z.object({ criteriaMet: z.array(z.string()) });

export const ConversationSchema = z.object({
  id: UuidSchema,
  scenarioId: z.string().min(1),
  mode: ScenarioModeSchema,
  status: RunStatusSchema,
  goalState: GoalStateSchema,
  turnCount: CountSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationSummarySchema = z.object({
  id: UuidSchema,
  scenarioId: z.string().min(1),
  titleEn: z.string(),
  mode: ScenarioModeSchema,
  status: RunStatusSchema,
  turnCount: CountSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type ConversationSummary = z.infer<typeof ConversationSummarySchema>;

export const ConversationListSchema = page(ConversationSummarySchema);

/**
 * An error the tutor found, as the client sees it. While the status is `prompted` it carries
 * no `expected` form, so the client cannot reveal the answer by accident.
 */
export const TutorErrorSchema = z
  .object({
    id: UuidSchema,
    messageId: UuidSchema,
    start: z.int().nonnegative(),
    end: z.int().nonnegative(),
    given: z.string(),
    expected: z.string().optional(),
    correctedSentence: z.string().optional(),
    errorType: ErrorTypeSchema,
    caseExpected: CaseSchema.optional(),
    caseGiven: CaseSchema.optional(),
    lemmaId: LemmaIdSchema.optional(),
    triggerId: z.string().optional(),
    explanationEn: z.string().optional(),
    severity: ErrorSeveritySchema,
    verified: z.boolean(),
    status: TutorErrorStatusSchema,
    noteId: UuidSchema.nullable(),
  })
  .refine((e) => e.status !== 'prompted' || e.expected === undefined, {
    message: 'a prompted error carries no expected form',
    path: ['expected'],
  });
export type TutorError = z.infer<typeof TutorErrorSchema>;

export const MessageSchema = z.object({
  id: UuidSchema,
  seq: z.int().nonnegative(),
  role: MessageRoleSchema,
  content: z.string(),
  createdAt: TimestampSchema,
});
export type Message = z.infer<typeof MessageSchema>;

/** Conversation, scenario, messages and errors. */
export const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  scenario: ScenarioBriefSchema,
  messages: z.array(MessageSchema),
  errors: z.array(TutorErrorSchema),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

/** `POST /tutor/conversations` body */
export const StartConversationSchema = z.object({
  id: UuidSchema,
  scenarioId: z.string().min(1),
});

/** `POST /tutor/conversations/:id/messages` body */
export const SendMessageSchema = z.object({
  clientId: UuidSchema,
  content: z.string().trim().min(1).max(LIMITS.tutorMessageChars),
});
export type SendMessage = z.infer<typeof SendMessageSchema>;

// --- Stream events --------------------------------------------------------------

/** An error mark in the `analysis` event. `expected` arrives only once the status is `corrected`. */
export const StreamErrorSchema = z
  .object({
    id: UuidSchema,
    start: z.int().nonnegative(),
    end: z.int().nonnegative(),
    given: z.string(),
    errorType: ErrorTypeSchema,
    status: TutorErrorStatusSchema,
    expected: z.string().optional(),
    explanationEn: z.string().optional(),
  })
  .refine((e) => e.status !== 'prompted' || e.expected === undefined, {
    message: 'a prompted error carries no expected form',
    path: ['expected'],
  });

/** An earlier prompted error that this message resolved. */
export const ResolvedErrorSchema = z.object({
  id: UuidSchema,
  status: z.enum(['self_corrected', 'corrected']),
  expected: z.string().optional(),
  explanationEn: z.string().optional(),
});

export const AnalysisEventDataSchema = z.object({
  /** The id of the stored learner message. */
  messageId: UuidSchema,
  errors: z.array(StreamErrorSchema),
  resolved: z.array(ResolvedErrorSchema),
});

export const DeltaEventDataSchema = z.object({ text: z.string() });

export const DoneEventDataSchema = z.object({
  tutorMessage: z.object({ id: UuidSchema, seq: z.int().nonnegative(), content: z.string() }),
  /** Ids of the notes created from corrected errors. */
  cardsCreated: z.array(UuidSchema),
  goal: GoalStateSchema,
  budget: z.object({ remainingUsd: z.number() }),
});

/**
 * One server sent event of the tutor message stream: `event: <event>` and `data: <json>`.
 * Order: one `analysis`, many `delta`, one `done`. An `error` can replace any of them and ends it.
 */
export const TutorStreamEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('analysis'), data: AnalysisEventDataSchema }),
  z.object({ event: z.literal('delta'), data: DeltaEventDataSchema }),
  z.object({ event: z.literal('done'), data: DoneEventDataSchema }),
  z.object({ event: z.literal('error'), data: ErrorBodySchema }),
]);
export type TutorStreamEvent = z.infer<typeof TutorStreamEventSchema>;
export type TutorStreamEventName = TutorStreamEvent['event'];

/** Formats one event in the wire format of `text/event-stream`. */
export function formatSseEvent(e: TutorStreamEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}

// --- Peek, end, dispute, reports ---------------------------------------------------

/** `POST /tutor/conversations/:id/peek` body */
export const PeekSchema = z.object({
  kind: PeekKindSchema,
  messageId: UuidSchema.optional(),
  errorId: UuidSchema.optional(),
});
export const PeekResultSchema = z.object({ text: z.string() });

/** The end summary of a conversation (`app.conversation.summary`). */
export const TutorSummarySchema = z.object({
  textEn: z.string(),
  goalMet: z.boolean(),
  criteriaMet: z.array(z.string()),
  /** Every error of the conversation, including the `summary_only` ones. */
  errors: z.array(TutorErrorSchema),
});
export type TutorSummary = z.infer<typeof TutorSummarySchema>;

/** `POST /tutor/conversations/:id/end` response */
export const EndConversationResultSchema = z.object({
  summary: TutorSummarySchema,
  cardsCreated: CountSchema,
});

/** `POST /tutor/errors/:id/dispute` */
export const DisputeErrorSchema = z.object({ comment: z.string().max(1000).optional() });
export const DisputeResultSchema = z.object({ id: UuidSchema, status: z.literal('disputed') });

/** `POST /reports` body */
export const CreateReportSchema = z.object({
  id: UuidSchema,
  targetKind: ReportTargetKindSchema,
  targetRef: z.string().min(1),
  comment: z.string().max(1000).optional(),
});
export type CreateReport = z.infer<typeof CreateReportSchema>;
export const ReportCreatedSchema = z.object({ id: UuidSchema });
