// Exercises, attempts, mastery and the course (docs/contracts.md, "Exercises, attempts and mastery").
import { z } from 'zod';
import {
  CountSchema,
  FormMapSchema,
  LemmaIdSchema,
  ShareSchema,
  SpanSchema,
  TimestampSchema,
  UuidSchema,
} from '../common';
import {
  CaseSchema,
  DiagnosisSchema,
  ExerciseKindSchema,
  GenderSchema,
  GrammaticalNumberSchema,
  LessonStatusSchema,
  MasteryLevelSchema,
  PatternPosSchema,
  SessionModeSchema,
  TriggerKindSchema,
} from '../enums';

export const ChoiceOptionSchema = z.object({ text: z.string().min(1), correct: z.boolean() });

export const ExerciseItemSchema = z.object({
  exerciseId: z.string().min(1),
  kind: ExerciseKindSchema,
  sentenceSk: z.string().min(1),
  sentenceEn: z.string(),
  blank: SpanSchema,
  /** Base form: 'nový dom'. */
  cue: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1),
  /** Choice kinds only. */
  options: z.array(ChoiceOptionSchema).optional(),
  features: z.object({
    case: CaseSchema,
    number: GrammaticalNumberSchema,
    gender: GenderSchema,
    pattern: z.string().optional(),
  }),
  trigger: z
    .object({ id: z.string().min(1), kind: TriggerKindSchema, label: z.string().min(1) })
    .optional(),
  /** Every form of the target word mapped to its form tags. */
  formMap: FormMapSchema,
  /** Pattern id mapped to the ending that pattern has for this tag. */
  siblingEndings: z.record(z.string(), z.string()).optional(),
});
export type ExerciseItem = z.infer<typeof ExerciseItemSchema>;

export const AttemptInputSchema = z.object({
  id: UuidSchema,
  sessionId: UuidSchema.optional(),
  source: z.enum(['trainer', 'lesson']),
  exerciseId: z.string().min(1),
  typed: z.string(),
  correct: z.boolean(),
  retry: z.boolean(),
  clientDiagnosis: DiagnosisSchema,
  occurredAt: TimestampSchema,
  durationMs: z.int().nonnegative(),
});
export type AttemptInput = z.infer<typeof AttemptInputSchema>;

export const BucketMasterySchema = z.object({
  case: CaseSchema,
  number: GrammaticalNumberSchema,
  gender: GenderSchema,
  attempts: CountSchema,
  /** 0 to 1 */
  mastery: ShareSchema,
  level: MasteryLevelSchema,
});
export type BucketMastery = z.infer<typeof BucketMasterySchema>;

export const ExplainStepSchema = z.object({
  kind: z.literal('explain'),
  md: z.string().min(1),
  examples: z.array(z.object({ sk: z.string().min(1), en: z.string(), highlight: SpanSchema })),
});
export const TriggersStepSchema = z.object({
  kind: z.literal('triggers'),
  triggerIds: z.array(z.string().min(1)),
});
export const ExerciseStepSchema = z.object({
  kind: z.enum(['comprehension', 'production', 'checkpoint']),
  exerciseIds: z.array(z.string().min(1)),
  passShare: ShareSchema.optional(),
});

/** `ling.lesson_step.content` */
export const LessonStepContentSchema = z.discriminatedUnion('kind', [
  ExplainStepSchema,
  TriggersStepSchema,
  ExerciseStepSchema,
]);
export type LessonStepContent = z.infer<typeof LessonStepContentSchema>;

/** `ling.lesson.focus` */
export const LessonFocusSchema = z.object({
  buckets: z.array(
    z.object({
      case: CaseSchema,
      number: GrammaticalNumberSchema,
      gender: GenderSchema,
      weight: z.number().nonnegative(),
    }),
  ),
  triggerIds: z.array(z.string().min(1)),
});
export type LessonFocus = z.infer<typeof LessonFocusSchema>;

/** `app.lesson_progress.score` */
export const LessonScoreSchema = z.object({ correct: CountSchema, total: CountSchema });
export type LessonScore = z.infer<typeof LessonScoreSchema>;

export const LessonProgressSchema = z.object({
  lessonId: z.string().min(1),
  status: LessonStatusSchema,
  stepIndex: z.int().nonnegative(),
  score: LessonScoreSchema.nullable(),
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  updatedAt: TimestampSchema,
});
export type LessonProgress = z.infer<typeof LessonProgressSchema>;

/** A row of `ling.trigger`, as the API returns it. */
export const TriggerSchema = z.object({
  id: z.string().min(1),
  kind: TriggerKindSchema,
  lemma: z.string().min(1),
  lemmaId: LemmaIdSchema.nullable(),
  case: CaseSchema,
  meaningEn: z.string(),
  noteEn: z.string().nullable(),
  exampleSk: z.string(),
  exampleEn: z.string(),
  contrastGroup: z.string().nullable(),
});
export type Trigger = z.infer<typeof TriggerSchema>;

export const CourseLessonSchema = z.object({
  id: z.string().min(1),
  ord: z.int().nonnegative(),
  titleEn: z.string(),
  titleSk: z.string(),
  case: CaseSchema.nullable(),
  number: GrammaticalNumberSchema.nullable(),
  status: LessonStatusSchema,
  score: LessonScoreSchema.nullable(),
});
export type CourseLesson = z.infer<typeof CourseLessonSchema>;

/** `GET /declension/course` */
export const CourseSchema = z.object({
  lessons: z.array(CourseLessonSchema),
  mastery: z.array(BucketMasterySchema),
});
export type Course = z.infer<typeof CourseSchema>;

export const LessonSchema = z.object({
  id: z.string().min(1),
  ord: z.int().nonnegative(),
  titleEn: z.string(),
  titleSk: z.string(),
  case: CaseSchema.nullable(),
  number: GrammaticalNumberSchema.nullable(),
  focus: LessonFocusSchema,
  summaryMd: z.string(),
  prerequisites: z.array(z.string()),
});
export type Lesson = z.infer<typeof LessonSchema>;

export const LessonStepSchema = z.object({
  ord: z.int().nonnegative(),
  content: LessonStepContentSchema,
  /** The step's exercises, resolved from `content.exerciseIds`. Empty for other steps. */
  exercises: z.array(ExerciseItemSchema),
});
export type LessonStep = z.infer<typeof LessonStepSchema>;

/** `GET /declension/lessons/:id` */
export const LessonDetailSchema = z.object({
  lesson: LessonSchema,
  steps: z.array(LessonStepSchema),
  triggers: z.array(TriggerSchema),
  progress: LessonProgressSchema.nullable(),
});
export type LessonDetail = z.infer<typeof LessonDetailSchema>;

/** `PUT /declension/lessons/:id/progress` body */
export const SaveLessonProgressSchema = z.object({
  stepIndex: z.int().nonnegative(),
  status: LessonStatusSchema.optional(),
  score: LessonScoreSchema.optional(),
});
export type SaveLessonProgress = z.infer<typeof SaveLessonProgressSchema>;

/** `POST /declension/sessions` body */
export const CreateSessionSchema = z.object({
  mode: SessionModeSchema,
  lessonId: z.string().min(1).optional(),
  size: z.int().min(1).max(50),
  seed: z.int().nonnegative().optional(),
});
export type CreateSession = z.infer<typeof CreateSessionSchema>;

export const TrainerSessionSchema = z.object({
  sessionId: UuidSchema,
  seed: z.int().nonnegative(),
  items: z.array(ExerciseItemSchema),
});
export type TrainerSession = z.infer<typeof TrainerSessionSchema>;

/** `POST /declension/attempts` body */
export const SubmitAttemptsSchema = z.object({
  attempts: z.array(AttemptInputSchema).min(1).max(200),
});
export type SubmitAttempts = z.infer<typeof SubmitAttemptsSchema>;

export const SubmitAttemptsResultSchema = z.object({
  accepted: CountSchema,
  cardsCreated: CountSchema,
  mastery: z.array(BucketMasterySchema),
});
export type SubmitAttemptsResult = z.infer<typeof SubmitAttemptsResultSchema>;

export const ModelWordSchema = z.object({ lemmaId: LemmaIdSchema, lemma: z.string().min(1) });

/** `GET /declension/patterns/:id` */
export const PatternDetailSchema = z.object({
  id: z.string().min(1),
  labelSk: z.string().min(1),
  pos: PatternPosSchema,
  gender: GenderSchema.nullable(),
  /** The traditional model word: 'chlap'. */
  model: ModelWordSchema.nullable(),
  /** The everyday word shown beside it: 'muž'. */
  everydayModel: ModelWordSchema.nullable(),
  /** Keyed by form tag: { "s1": "", "s2": "a" }. */
  endings: z.record(z.string(), z.string()),
  notesEn: z.string().nullable(),
});
export type PatternDetail = z.infer<typeof PatternDetailSchema>;
