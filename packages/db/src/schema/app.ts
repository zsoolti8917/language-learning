// Schema `app`: learner data, 14 tables (docs/contracts.md, "Data model: schema app").
// Every table carries user_id and the owner policies; migration 0002 forces row level
// security and grants the role `authenticated` its rights.
import {
  AI_CALL_STATUSES,
  AI_ROUTES,
  ATTEMPT_SOURCES,
  CARD_STATES,
  CARD_TEMPLATES,
  CASES,
  DIAGNOSES,
  ERROR_SEVERITIES,
  ERROR_TYPES,
  GENDERS,
  GRADES,
  LEMMA_STATUS_SOURCES,
  LEMMA_STATUSES,
  LESSON_STATUSES,
  LEVELS,
  type LessonScore,
  MESSAGE_ROLES,
  NOTE_KINDS,
  NOTE_SOURCES,
  type NoteContent,
  NUMBERS,
  type PlacementResult,
  RATINGS,
  REPORT_STATUSES,
  REPORT_TARGET_KINDS,
  RUN_STATUSES,
  SCENARIO_MODES,
  TEXT_SOURCES,
  TEXT_STATUSES,
  type TextAnalysis,
  TUTOR_ERROR_STATUSES,
  type TutorSummary,
} from '@app/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { oneOf, ownerPolicies } from './helpers';

export const appSchema = pgSchema('app');

const tz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => tz('created_at').notNull().defaultNow();
const updatedAt = () => tz('updated_at').notNull().defaultNow();
/** `user_id uuid not null references app.profile on delete cascade` */
const owner = () =>
  uuid('user_id')
    .notNull()
    .references(() => profile.userId, { onDelete: 'cascade' });

export const profile = appSchema.table(
  'profile',
  {
    userId: uuid('user_id').primaryKey(),
    displayName: text('display_name'),
    uiLang: text('ui_lang').notNull().default('en'),
    explainLang: text('explain_lang').notNull().default('en'),
    level: text().notNull().default('A2'),
    timezone: text().notNull().default('Europe/Bratislava'),
    dayStartHour: smallint('day_start_hour').notNull().default(4),
    dailyNewLimit: smallint('daily_new_limit').notNull().default(10),
    dailyReviewLimit: smallint('daily_review_limit').notNull().default(80),
    desiredRetention: real('desired_retention').notNull().default(0.9),
    strictDiacritics: boolean('strict_diacritics').notNull().default(false),
    placementDoneAt: tz('placement_done_at'),
    currentLessonId: text('current_lesson_id'),
    wordsBandTarget: integer('words_band_target').notNull().default(1000),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [oneOf('profile', 'level', LEVELS), ...ownerPolicies('profile')],
);

export const userLemma = appSchema.table(
  'user_lemma',
  {
    userId: owner(),
    lemmaId: integer('lemma_id').notNull(),
    status: text().notNull(),
    source: text().notNull(),
    knownAt: tz('known_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'user_lemma_pkey', columns: [t.userId, t.lemmaId] }),
    oneOf('user_lemma', 'status', LEMMA_STATUSES),
    oneOf('user_lemma', 'source', LEMMA_STATUS_SOURCES),
    ...ownerPolicies('user_lemma'),
  ],
);

export const note = appSchema.table(
  'note',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    kind: text().notNull(),
    lemmaId: integer('lemma_id'),
    exerciseId: text('exercise_id'),
    textId: uuid('text_id'),
    content: jsonb().$type<NoteContent>().notNull(),
    source: text().notNull(),
    sourceRef: jsonb('source_ref').$type<Record<string, unknown>>(),
    suspended: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz('deleted_at'),
  },
  (t) => [
    uniqueIndex('note_user_word_idx')
      .on(t.userId, t.lemmaId)
      .where(sql`"kind" = 'word' and "deleted_at" is null`),
    uniqueIndex('note_user_exercise_idx')
      .on(t.userId, t.exerciseId)
      .where(sql`"exercise_id" is not null and "deleted_at" is null`),
    index('note_user_created_idx').on(t.userId, t.createdAt),
    oneOf('note', 'kind', NOTE_KINDS),
    oneOf('note', 'source', NOTE_SOURCES),
    ...ownerPolicies('note'),
  ],
);

export const card = appSchema.table(
  'card',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    noteId: uuid('note_id')
      .notNull()
      .references(() => note.id, { onDelete: 'cascade' }),
    template: text().notNull().default('recall'),
    state: text().notNull().default('new'),
    dueAt: tz('due_at'),
    newOrd: bigint('new_ord', { mode: 'number' }),
    stability: real(),
    difficulty: real(),
    reps: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    lastReviewAt: tz('last_review_at'),
    schedulerState: jsonb('scheduler_state').$type<Record<string, unknown>>(),
    schedulerVersion: text('scheduler_version'),
    variantCursor: smallint('variant_cursor').notNull().default(0),
    suspended: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('card_note_template_unique').on(t.noteId, t.template),
    index('card_user_state_due_idx').on(t.userId, t.state, t.dueAt),
    oneOf('card', 'template', CARD_TEMPLATES),
    oneOf('card', 'state', CARD_STATES),
    ...ownerPolicies('card'),
  ],
);

/** Append only. */
export const review = appSchema.table(
  'review',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    answeredAt: tz('answered_at').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
    rating: smallint().notNull(),
    grade: text().notNull(),
    overridden: boolean().notNull().default(false),
    typed: text(),
    expected: text(),
    variant: smallint(),
    durationMs: integer('duration_ms'),
    stateBefore: jsonb('state_before').$type<Record<string, unknown>>(),
    stateAfter: jsonb('state_after').$type<Record<string, unknown>>(),
    clientId: text('client_id'),
    diagnosis: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    index('review_user_answered_idx').on(t.userId, t.answeredAt),
    index('review_card_answered_idx').on(t.cardId, t.answeredAt),
    oneOf('review', 'rating', RATINGS),
    oneOf('review', 'grade', GRADES),
    ...ownerPolicies('review', { appendOnly: true }),
  ],
);

/** Append only. */
export const attempt = appSchema.table(
  'attempt',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    source: text().notNull(),
    sourceRef: text('source_ref'),
    exerciseId: text('exercise_id'),
    lemmaId: integer('lemma_id'),
    gCase: text('g_case').notNull(),
    gNumber: text('g_number').notNull(),
    gGender: text('g_gender'),
    pattern: text(),
    triggerId: text('trigger_id'),
    correct: boolean().notNull(),
    retry: boolean().notNull().default(false),
    diagnosis: text(),
    errorType: text('error_type'),
    given: text(),
    expected: text(),
    givenCase: text('given_case'),
    occurredAt: tz('occurred_at').notNull(),
    durationMs: integer('duration_ms'),
  },
  (t) => [
    index('attempt_user_bucket_idx').on(
      t.userId,
      t.gCase,
      t.gNumber,
      t.gGender,
      t.occurredAt.desc(),
    ),
    oneOf('attempt', 'source', ATTEMPT_SOURCES),
    oneOf('attempt', 'g_case', CASES),
    oneOf('attempt', 'g_number', NUMBERS),
    oneOf('attempt', 'g_gender', GENDERS),
    oneOf('attempt', 'diagnosis', DIAGNOSES),
    oneOf('attempt', 'error_type', ERROR_TYPES),
    oneOf('attempt', 'given_case', CASES),
    ...ownerPolicies('attempt', { appendOnly: true }),
  ],
);

export const lessonProgress = appSchema.table(
  'lesson_progress',
  {
    userId: owner(),
    lessonId: text('lesson_id').notNull(),
    status: text().notNull(),
    stepIndex: smallint('step_index').notNull().default(0),
    score: jsonb().$type<LessonScore>(),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'lesson_progress_pkey', columns: [t.userId, t.lessonId] }),
    oneOf('lesson_progress', 'status', LESSON_STATUSES),
    ...ownerPolicies('lesson_progress'),
  ],
);

/** `app.text`. Exported as `appText`, so it never shadows the `text` column builder. */
export const appText = appSchema.table(
  'text',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    title: text().notNull(),
    body: text().notNull(),
    source: text().notNull(),
    sourceRef: text('source_ref'),
    analysis: jsonb().$type<TextAnalysis>(),
    analysisVersion: smallint('analysis_version'),
    status: text().notNull().default('processing'),
    error: text(),
    tokenCount: integer('token_count'),
    uniqueLemmaCount: integer('unique_lemma_count'),
    coverage: real(),
    coverageAt: tz('coverage_at'),
    lastOpenedAt: tz('last_opened_at'),
    progress: jsonb().$type<{ sentence?: number }>().notNull().default({}),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('text_user_archived_opened_idx').on(t.userId, t.archived, t.lastOpenedAt.desc()),
    oneOf('text', 'source', TEXT_SOURCES),
    oneOf('text', 'status', TEXT_STATUSES),
    ...ownerPolicies('text'),
  ],
);

export const conversation = appSchema.table(
  'conversation',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    scenarioId: text('scenario_id').notNull(),
    mode: text().notNull(),
    status: text().notNull().default('active'),
    goalState: jsonb('goal_state').$type<{ criteriaMet?: string[] }>().notNull().default({}),
    turnCount: integer('turn_count').notNull().default(0),
    summary: jsonb().$type<TutorSummary>(),
    model: text(),
    promptVersion: text('prompt_version'),
    startedAt: tz('started_at').notNull().defaultNow(),
    endedAt: tz('ended_at'),
    updatedAt: updatedAt(),
  },
  () => [
    oneOf('conversation', 'mode', SCENARIO_MODES),
    oneOf('conversation', 'status', RUN_STATUSES),
    ...ownerPolicies('conversation'),
  ],
);

export const message = appSchema.table(
  'message',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    role: text().notNull(),
    content: text().notNull(),
    annotations: jsonb().$type<unknown>(),
    usage: jsonb().$type<Record<string, unknown>>(),
    clientId: uuid('client_id'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('message_conversation_seq_unique').on(t.conversationId, t.seq),
    unique('message_conversation_client_unique').on(t.conversationId, t.clientId),
    oneOf('message', 'role', MESSAGE_ROLES),
    ...ownerPolicies('message'),
  ],
);

export const tutorError = appSchema.table(
  'tutor_error',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversation.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .notNull()
      .references(() => message.id, { onDelete: 'cascade' }),
    spanStart: integer('span_start').notNull(),
    spanEnd: integer('span_end').notNull(),
    given: text().notNull(),
    expected: text().notNull(),
    correctedSentence: text('corrected_sentence'),
    errorType: text('error_type').notNull(),
    caseExpected: text('case_expected'),
    caseGiven: text('case_given'),
    lemmaId: integer('lemma_id'),
    triggerId: text('trigger_id'),
    explanationEn: text('explanation_en'),
    severity: text().notNull(),
    verified: boolean().notNull().default(false),
    status: text().notNull(),
    noteId: uuid('note_id').references(() => note.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    resolvedAt: tz('resolved_at'),
  },
  () => [
    oneOf('tutor_error', 'error_type', ERROR_TYPES),
    oneOf('tutor_error', 'case_expected', CASES),
    oneOf('tutor_error', 'case_given', CASES),
    oneOf('tutor_error', 'severity', ERROR_SEVERITIES),
    oneOf('tutor_error', 'status', TUTOR_ERROR_STATUSES),
    ...ownerPolicies('tutor_error'),
  ],
);

export const placement = appSchema.table(
  'placement',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    status: text().notNull().default('active'),
    items: jsonb().$type<unknown[]>().notNull().default([]),
    result: jsonb().$type<PlacementResult>(),
    startedAt: tz('started_at').notNull().defaultNow(),
    completedAt: tz('completed_at'),
  },
  () => [oneOf('placement', 'status', RUN_STATUSES), ...ownerPolicies('placement')],
);

/** Append only; counts and cost, never content. */
export const aiCall = appSchema.table(
  'ai_call',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    route: text().notNull(),
    model: text().notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms'),
    status: text().notNull(),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_call_user_created_idx').on(t.userId, t.createdAt),
    oneOf('ai_call', 'route', AI_ROUTES),
    oneOf('ai_call', 'status', AI_CALL_STATUSES),
    ...ownerPolicies('ai_call', { appendOnly: true }),
  ],
);

export const contentReport = appSchema.table(
  'content_report',
  {
    id: uuid().primaryKey(),
    userId: owner(),
    targetKind: text('target_kind').notNull(),
    targetRef: text('target_ref').notNull(),
    comment: text(),
    status: text().notNull().default('open'),
    createdAt: createdAt(),
  },
  () => [
    oneOf('content_report', 'target_kind', REPORT_TARGET_KINDS),
    oneOf('content_report', 'status', REPORT_STATUSES),
    ...ownerPolicies('content_report'),
  ],
);

/** The tables without an update policy: rows are never changed. */
export const APPEND_ONLY_TABLES = ['review', 'attempt', 'ai_call'] as const;
