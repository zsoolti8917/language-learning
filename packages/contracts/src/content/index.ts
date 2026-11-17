// One row of every content file, and the manifest (docs/contracts.md, "Content files").
// Fields that are null in the database are simply left out of a row.
import { z } from 'zod';
import {
  CountSchema,
  FormTagSchema,
  FormTagsSchema,
  LemmaIdSchema,
  ShareSchema,
  TimestampSchema,
  TopFormSchema,
} from '../common';
import {
  ChoiceOptionSchema,
  LessonFocusSchema,
  LessonStepContentSchema,
} from '../entities/declension';
import { TextAnalysisSchema } from '../entities/reader';
import { SuccessCriterionSchema, VocabHintSchema } from '../entities/tutor';
import { LemmaFlagsSchema } from '../entities/words';
import {
  AspectSchema,
  CaseSchema,
  ExerciseKindSchema,
  ExerciseSourceSchema,
  GenderSchema,
  GrammaticalNumberSchema,
  LessonStepKindSchema,
  LevelSchema,
  LibrarySourceSchema,
  PatternPosSchema,
  PosSchema,
  ScenarioModeSchema,
  SenseSourceSchema,
  SentenceSourceSchema,
  TriggerKindSchema,
} from '../enums';

/** `lemmas.jsonl` → `ling.lemma`. The loader computes `lemma_ascii` with foldAscii. */
export const LemmaRowSchema = z.object({
  id: LemmaIdSchema,
  key: z.string().regex(/^[^|]+\|[a-z]+\|[^|]*\|\d+$/u, "a key like 'mesto|noun|n|1'"),
  lemma: z.string().min(1),
  pos: PosSchema,
  gender: GenderSchema.optional(),
  pattern: z.string().min(1).optional(),
  aspect: AspectSchema.optional(),
  freqRank: z.int().positive().optional(),
  topForms: z.array(TopFormSchema).default([]),
  flags: LemmaFlagsSchema.default({}),
});
export type LemmaRow = z.infer<typeof LemmaRowSchema>;

/** `forms.jsonl` → `ling.form`. The loader computes `form_ascii` with foldAscii. */
export const FormRowSchema = z.object({
  lemmaId: LemmaIdSchema,
  /** As written, capitals kept. */
  form: z.string().min(1),
  /** Form tags separated by spaces: 'p1 p4 p5'. Empty for words without a tag. */
  tags: FormTagsSchema,
});
export type FormRow = z.infer<typeof FormRowSchema>;

/** `senses.jsonl` → `ling.sense` */
export const SenseRowSchema = z.object({
  lemmaId: LemmaIdSchema,
  ord: z.int().nonnegative(),
  glossEn: z.string().min(1),
  note: z.string().optional(),
  source: SenseSourceSchema,
  verified: z.boolean().default(false),
});
export type SenseRow = z.infer<typeof SenseRowSchema>;

export const SentenceTokenSchema = z.object({
  s: z.int().nonnegative(),
  e: z.int().nonnegative(),
  lemmaId: LemmaIdSchema.optional(),
  tag: FormTagSchema.optional(),
});

/** A link from a sentence to a lemma it shows (`ling.lemma_sentence`). */
export const LemmaSentenceLinkSchema = z.object({
  lemmaId: LemmaIdSchema,
  tokenIndex: z.int().nonnegative(),
  form: z.string().min(1),
  tag: FormTagSchema,
  /** Display order for this lemma. */
  ord: z.int().nonnegative(),
});

/** `sentences.jsonl` → `ling.sentence` and `ling.lemma_sentence` */
export const SentenceRowSchema = z.object({
  id: z.string().regex(/^(?:tat|ud|gen)-[\w-]+$/u, "an id like 'tat-8214994' or 'gen-9f2c1a7b'"),
  textSk: z.string().min(1),
  textEn: z.string().min(1),
  tokens: z.array(SentenceTokenSchema),
  difficulty: ShareSchema,
  source: SentenceSourceSchema,
  sourceRef: z.string().optional(),
  license: z.string().min(1),
  audioPath: z.string().optional(),
  verified: z.boolean().default(false),
  links: z.array(LemmaSentenceLinkSchema),
});
export type SentenceRow = z.infer<typeof SentenceRowSchema>;

/** `triggers.jsonl` → `ling.trigger` */
export const TriggerRowSchema = z.object({
  id: z.string().min(1),
  kind: TriggerKindSchema,
  lemma: z.string().min(1),
  lemmaId: LemmaIdSchema.optional(),
  case: CaseSchema,
  meaningEn: z.string().min(1),
  noteEn: z.string().optional(),
  exampleSk: z.string().min(1),
  exampleEn: z.string().min(1),
  contrastGroup: z.string().optional(),
  freqRank: z.int().positive().optional(),
});
export type TriggerRow = z.infer<typeof TriggerRowSchema>;

/** `patterns.jsonl` → `ling.pattern` */
export const PatternRowSchema = z.object({
  id: z.string().regex(/^[a-z]+$/u, 'the model word without accents'),
  labelSk: z.string().min(1),
  pos: PatternPosSchema,
  gender: GenderSchema.optional(),
  modelLemmaId: LemmaIdSchema.optional(),
  everydayModelLemmaId: LemmaIdSchema.optional(),
  /** Keyed by form tag: { "s1": "", "s2": "a" }. */
  endings: z.record(FormTagSchema, z.string()),
  notesEn: z.string().optional(),
});
export type PatternRow = z.infer<typeof PatternRowSchema>;

export const LessonStepRowSchema = z
  .object({
    ord: z.int().nonnegative(),
    kind: LessonStepKindSchema,
    content: LessonStepContentSchema,
  })
  .refine((s) => s.kind === s.content.kind, {
    message: 'kind must match content.kind',
    path: ['content', 'kind'],
  });

/** `lessons.jsonl` → `ling.lesson` and `ling.lesson_step` */
export const LessonRowSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/u, "a slug like 'gen-sg'"),
  course: z.string().min(1).default('declension'),
  ord: z.int().nonnegative(),
  titleEn: z.string().min(1),
  titleSk: z.string().min(1),
  case: CaseSchema.optional(),
  number: GrammaticalNumberSchema.optional(),
  focus: LessonFocusSchema,
  summaryMd: z.string().min(1),
  prerequisites: z.array(z.string()).default([]),
  steps: z.array(LessonStepRowSchema),
});
export type LessonRow = z.infer<typeof LessonRowSchema>;

/** `ling.exercise.target` */
export const ExerciseTargetSchema = z.object({
  start: z.int().nonnegative(),
  end: z.int().nonnegative(),
  lemmaIds: z.array(LemmaIdSchema).min(1),
  cue: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1),
});

/** `exercises.jsonl` → `ling.exercise` */
export const ExerciseRowSchema = z.object({
  id: z.string().regex(/^ex-[0-9a-f]+$/u, "an id like 'ex-3fa94c21d0'"),
  kind: ExerciseKindSchema,
  sentenceSk: z.string().min(1),
  sentenceEn: z.string().min(1),
  target: ExerciseTargetSchema,
  case: CaseSchema,
  number: GrammaticalNumberSchema,
  gender: GenderSchema,
  pattern: z.string().optional(),
  triggerId: z.string().optional(),
  /** Choice kinds: [{ text, correct }]. */
  options: z.array(ChoiceOptionSchema).optional(),
  lessonId: z.string().optional(),
  difficulty: ShareSchema,
  source: ExerciseSourceSchema,
  verified: z.boolean().default(false),
  flags: z.record(z.string(), z.unknown()).default({}),
});
export type ExerciseRow = z.infer<typeof ExerciseRowSchema>;

/** `scenarios.jsonl` → `ling.scenario` */
export const ScenarioRowSchema = z.object({
  id: z.string().regex(/^scn-[a-z0-9-]+$/u, "an id like 'scn-cafe-order'"),
  mode: ScenarioModeSchema,
  titleEn: z.string().min(1),
  titleSk: z.string().min(1),
  goalEn: z.string().min(1),
  settingSk: z.string().min(1),
  tutorRole: z.string().min(1),
  targetCases: z.array(CaseSchema),
  targetTriggers: z.array(z.string()),
  level: LevelSchema,
  openingSk: z.string().min(1),
  successCriteria: z.array(SuccessCriterionSchema),
  vocabHint: z.array(VocabHintSchema).default([]),
  ord: z.int().nonnegative(),
});
export type ScenarioRow = z.infer<typeof ScenarioRowSchema>;

/** `library.jsonl` → `ling.library_text` */
export const LibraryRowSchema = z.object({
  id: z.string().regex(/^lib-[a-z0-9-]+$/u, "an id like 'lib-003'"),
  title: z.string().min(1),
  body: z.string().min(1),
  level: LevelSchema,
  /** Present once analysed. */
  analysis: TextAnalysisSchema.optional(),
  /** { lemmaId: count } */
  lemmaCounts: z.record(z.string().regex(/^\d+$/u), CountSchema).optional(),
  source: LibrarySourceSchema,
  license: z.string().min(1),
  ord: z.int().nonnegative(),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

/** `manifest.json` → `ling.content_version` */
export const ManifestSchema = z.object({
  /** '2026-12-01.1' */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}\.\d+$/u, "a version like '2026-12-01.1'"),
  builtAt: TimestampSchema,
  sources: z.array(
    z.object({
      name: z.string().min(1),
      url: z.string(),
      checksum: z.string(),
      license: z.string().min(1),
    }),
  ),
  /** Rows per file, keyed by file name without extension: { lemmas: 72 }. */
  counts: z.record(z.string(), CountSchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** The row schema of every `.jsonl` file of a content set. */
export const CONTENT_FILES = {
  'lemmas.jsonl': LemmaRowSchema,
  'forms.jsonl': FormRowSchema,
  'senses.jsonl': SenseRowSchema,
  'sentences.jsonl': SentenceRowSchema,
  'triggers.jsonl': TriggerRowSchema,
  'patterns.jsonl': PatternRowSchema,
  'lessons.jsonl': LessonRowSchema,
  'exercises.jsonl': ExerciseRowSchema,
  'scenarios.jsonl': ScenarioRowSchema,
  'library.jsonl': LibraryRowSchema,
} as const;
export type ContentFileName = keyof typeof CONTENT_FILES;
export const MANIFEST_FILE = 'manifest.json';

/** A whole content set in memory, keyed like the files without extension. */
export type ContentSet = {
  lemmas: LemmaRow[];
  forms: FormRow[];
  senses: SenseRow[];
  sentences: SentenceRow[];
  triggers: TriggerRow[];
  patterns: PatternRow[];
  lessons: LessonRow[];
  exercises: ExerciseRow[];
  scenarios: ScenarioRow[];
  library: LibraryRow[];
  manifest: Manifest;
};
