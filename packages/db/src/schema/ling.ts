// Schema `ling`: reference data, 13 tables (docs/contracts.md, "Data model: schema ling").
// No row level security: the schema holds no personal data. Grants live in migration 0002.
import {
  ASPECTS,
  CASES,
  EXERCISE_KINDS,
  EXERCISE_SOURCES,
  GENDERS,
  LESSON_STEP_KINDS,
  LEVELS,
  type LemmaFlags,
  type LessonFocus,
  type LessonStepContent,
  LIBRARY_SOURCES,
  NUMBERS,
  PATTERN_POS,
  POS,
  SCENARIO_MODES,
  SENSE_SOURCES,
  SENTENCE_SOURCES,
  type TextAnalysis,
  type TopForm,
  TRIGGER_KINDS,
} from '@app/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { allOf, oneOf } from './helpers';

export const lingSchema = pgSchema('ling');

/** A token of `ling.sentence.tokens`: character span, lemma and form tag. */
export type SentenceToken = { s: number; e: number; lemmaId?: number; tag?: string };
/** `ling.exercise.target` */
export type ExerciseTarget = {
  start: number;
  end: number;
  lemmaIds: number[];
  cue: string;
  answers: string[];
};
export type ExerciseOption = { text: string; correct: boolean };
export type ContentSource = { name: string; url: string; checksum: string; license: string };

export const lemma = lingSchema.table(
  'lemma',
  {
    id: integer().primaryKey(),
    key: text().notNull().unique('lemma_key_unique'),
    lemma: text().notNull(),
    lemmaAscii: text('lemma_ascii').notNull(),
    pos: text().notNull(),
    gender: text(),
    pattern: text(),
    aspect: text(),
    freqRank: integer('freq_rank'),
    topForms: jsonb('top_forms').$type<TopForm[]>().notNull().default([]),
    flags: jsonb().$type<LemmaFlags>().notNull().default({}),
  },
  (t) => [
    index('lemma_lemma_ascii_idx').on(t.lemmaAscii),
    index('lemma_freq_rank_idx').on(t.freqRank).where(sql`"freq_rank" is not null`),
    oneOf('lemma', 'pos', POS),
    oneOf('lemma', 'gender', GENDERS),
    oneOf('lemma', 'aspect', ASPECTS),
  ],
);

export const form = lingSchema.table(
  'form',
  {
    lemmaId: integer('lemma_id')
      .notNull()
      .references(() => lemma.id),
    form: text().notNull(),
    formAscii: text('form_ascii').notNull(),
    tags: text().notNull(),
  },
  (t) => [
    primaryKey({ name: 'form_pkey', columns: [t.lemmaId, t.form] }),
    index('form_form_ascii_idx').on(t.formAscii),
  ],
);

export const sense = lingSchema.table(
  'sense',
  {
    lemmaId: integer('lemma_id')
      .notNull()
      .references(() => lemma.id),
    ord: smallint().notNull(),
    glossEn: text('gloss_en').notNull(),
    note: text(),
    source: text().notNull(),
    verified: boolean().notNull().default(false),
  },
  (t) => [
    primaryKey({ name: 'sense_pkey', columns: [t.lemmaId, t.ord] }),
    oneOf('sense', 'source', SENSE_SOURCES),
  ],
);

export const sentence = lingSchema.table(
  'sentence',
  {
    id: text().primaryKey(),
    textSk: text('text_sk').notNull(),
    textEn: text('text_en').notNull(),
    tokens: jsonb().$type<SentenceToken[]>().notNull(),
    difficulty: real().notNull(),
    source: text().notNull(),
    sourceRef: text('source_ref'),
    license: text().notNull(),
    audioPath: text('audio_path'),
    verified: boolean().notNull().default(false),
  },
  () => [oneOf('sentence', 'source', SENTENCE_SOURCES)],
);

export const lemmaSentence = lingSchema.table(
  'lemma_sentence',
  {
    lemmaId: integer('lemma_id')
      .notNull()
      .references(() => lemma.id),
    sentenceId: text('sentence_id')
      .notNull()
      .references(() => sentence.id),
    tokenIndex: smallint('token_index').notNull(),
    form: text().notNull(),
    tag: text().notNull(),
    ord: smallint().notNull(),
  },
  (t) => [
    primaryKey({ name: 'lemma_sentence_pkey', columns: [t.lemmaId, t.sentenceId, t.tokenIndex] }),
  ],
);

export const trigger = lingSchema.table(
  'trigger',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    lemma: text().notNull(),
    lemmaId: integer('lemma_id'),
    gCase: text('g_case').notNull(),
    meaningEn: text('meaning_en').notNull(),
    noteEn: text('note_en'),
    exampleSk: text('example_sk').notNull(),
    exampleEn: text('example_en').notNull(),
    contrastGroup: text('contrast_group'),
    freqRank: integer('freq_rank'),
  },
  () => [oneOf('trigger', 'kind', TRIGGER_KINDS), oneOf('trigger', 'g_case', CASES)],
);

export const pattern = lingSchema.table(
  'pattern',
  {
    id: text().primaryKey(),
    labelSk: text('label_sk').notNull(),
    pos: text().notNull(),
    gender: text(),
    modelLemmaId: integer('model_lemma_id'),
    everydayModelLemmaId: integer('everyday_model_lemma_id'),
    endings: jsonb().$type<Record<string, string>>().notNull(),
    notesEn: text('notes_en'),
  },
  () => [oneOf('pattern', 'pos', PATTERN_POS), oneOf('pattern', 'gender', GENDERS)],
);

export const lesson = lingSchema.table(
  'lesson',
  {
    id: text().primaryKey(),
    course: text().notNull().default('declension'),
    ord: smallint().notNull(),
    titleEn: text('title_en').notNull(),
    titleSk: text('title_sk').notNull(),
    gCase: text('g_case'),
    gNumber: text('g_number'),
    focus: jsonb().$type<LessonFocus>().notNull(),
    summaryMd: text('summary_md').notNull(),
    prerequisites: text().array().notNull().default(sql`'{}'::text[]`),
  },
  () => [oneOf('lesson', 'g_case', CASES), oneOf('lesson', 'g_number', NUMBERS)],
);

export const lessonStep = lingSchema.table(
  'lesson_step',
  {
    lessonId: text('lesson_id')
      .notNull()
      .references(() => lesson.id),
    ord: smallint().notNull(),
    kind: text().notNull(),
    content: jsonb().$type<LessonStepContent>().notNull(),
  },
  (t) => [
    primaryKey({ name: 'lesson_step_pkey', columns: [t.lessonId, t.ord] }),
    oneOf('lesson_step', 'kind', LESSON_STEP_KINDS),
  ],
);

export const exercise = lingSchema.table(
  'exercise',
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    sentenceSk: text('sentence_sk').notNull(),
    sentenceEn: text('sentence_en').notNull(),
    target: jsonb().$type<ExerciseTarget>().notNull(),
    gCase: text('g_case').notNull(),
    gNumber: text('g_number').notNull(),
    gGender: text('g_gender').notNull(),
    pattern: text(),
    triggerId: text('trigger_id'),
    options: jsonb().$type<ExerciseOption[]>(),
    lessonId: text('lesson_id'),
    difficulty: real().notNull(),
    source: text().notNull(),
    verified: boolean().notNull().default(false),
    flags: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('exercise_bucket_idx').on(t.gCase, t.gNumber, t.gGender),
    index('exercise_lesson_id_idx').on(t.lessonId),
    oneOf('exercise', 'kind', EXERCISE_KINDS),
    oneOf('exercise', 'g_case', CASES),
    oneOf('exercise', 'g_number', NUMBERS),
    oneOf('exercise', 'g_gender', GENDERS),
    oneOf('exercise', 'source', EXERCISE_SOURCES),
  ],
);

export const scenario = lingSchema.table(
  'scenario',
  {
    id: text().primaryKey(),
    mode: text().notNull(),
    titleEn: text('title_en').notNull(),
    titleSk: text('title_sk').notNull(),
    goalEn: text('goal_en').notNull(),
    settingSk: text('setting_sk').notNull(),
    tutorRole: text('tutor_role').notNull(),
    targetCases: text('target_cases').array().notNull(),
    targetTriggers: text('target_triggers').array().notNull(),
    level: text().notNull(),
    openingSk: text('opening_sk').notNull(),
    successCriteria: jsonb('success_criteria').$type<{ id: string; textEn: string }[]>().notNull(),
    vocabHint: jsonb('vocab_hint').$type<{ sk: string; en: string }[]>().notNull().default([]),
    ord: smallint().notNull(),
  },
  () => [
    oneOf('scenario', 'mode', SCENARIO_MODES),
    oneOf('scenario', 'level', LEVELS),
    allOf('scenario', 'target_cases', CASES),
  ],
);

export const libraryText = lingSchema.table(
  'library_text',
  {
    id: text().primaryKey(),
    title: text().notNull(),
    body: text().notNull(),
    level: text().notNull(),
    analysis: jsonb().$type<TextAnalysis>(),
    lemmaCounts: jsonb('lemma_counts').$type<Record<string, number>>(),
    source: text().notNull(),
    license: text().notNull(),
    ord: smallint().notNull(),
  },
  () => [oneOf('library_text', 'level', LEVELS), oneOf('library_text', 'source', LIBRARY_SOURCES)],
);

export const contentVersion = lingSchema.table('content_version', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  version: text().notNull(),
  builtAt: timestamp('built_at', { withTimezone: true }).notNull(),
  loadedAt: timestamp('loaded_at', { withTimezone: true }).notNull().defaultNow(),
  sources: jsonb().$type<ContentSource[]>().notNull(),
  counts: jsonb().$type<Record<string, number>>().notNull(),
});
