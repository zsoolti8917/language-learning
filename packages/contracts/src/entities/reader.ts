// Texts, their analysis and the library (docs/contracts.md, "Text analysis").
import { z } from 'zod';
import {
  CountSchema,
  FormTagSchema,
  LemmaIdSchema,
  LemmaStatusMapSchema,
  LIMITS,
  page,
  ShareSchema,
  SpanSchema,
  TimestampSchema,
  UuidSchema,
} from '../common';
import {
  GenderSchema,
  LevelSchema,
  PosSchema,
  ReadingMethodSchema,
  TextSourceSchema,
  TextStatusSchema,
  TokenTypeSchema,
  TriggerKindSchema,
} from '../enums';

export const AnalysisTokenSchema = z.object({
  s: z.int().nonnegative(),
  e: z.int().nonnegative(),
  t: TokenTypeSchema,
  /** Lemma id. */
  l: LemmaIdSchema.optional(),
  /** The form tag of the chosen reading. */
  tag: FormTagSchema.optional(),
  /** How the reading was chosen. */
  m: ReadingMethodSchema.optional(),
  /** i: index of the trigger token in this sentence. */
  trig: z
    .object({
      i: z.int().nonnegative().optional(),
      kind: TriggerKindSchema,
      id: z.string().optional(),
    })
    .optional(),
});
export type AnalysisToken = z.infer<typeof AnalysisTokenSchema>;

export const AnalysisSentenceSchema = z.object({
  /** Character offsets in the body. */
  s: z.int().nonnegative(),
  e: z.int().nonnegative(),
  /** Translation, filled on request. */
  en: z.string().optional(),
  tokens: z.array(AnalysisTokenSchema),
});
export type AnalysisSentence = z.infer<typeof AnalysisSentenceSchema>;

export const AnalysisLemmaSchema = z.object({
  lemma: z.string().min(1),
  pos: PosSchema,
  gender: GenderSchema.optional(),
  gloss: z.array(z.string()),
});

/** `app.text.analysis`, `ling.library_text.analysis`. Short names: a text holds hundreds of tokens. */
export const TextAnalysisSchema = z.object({
  v: z.literal(1),
  sentences: z.array(AnalysisSentenceSchema),
  /** Keyed by lemma id. */
  lemmas: z.record(z.string(), AnalysisLemmaSchema),
});
export type TextAnalysis = z.infer<typeof TextAnalysisSchema>;

export const TextProgressSchema = z.object({
  /** Index of the sentence the learner reached. */
  sentence: z.int().nonnegative().optional(),
});
export type TextProgress = z.infer<typeof TextProgressSchema>;

export const TextSummarySchema = z.object({
  id: UuidSchema,
  title: z.string(),
  source: TextSourceSchema,
  sourceRef: z.string().nullable(),
  status: TextStatusSchema,
  tokenCount: CountSchema.nullable(),
  uniqueLemmaCount: CountSchema.nullable(),
  coverage: ShareSchema.nullable(),
  progress: TextProgressSchema,
  archived: z.boolean(),
  lastOpenedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type TextSummary = z.infer<typeof TextSummarySchema>;

export const TextListSchema = page(TextSummarySchema);

/** A phrase note saved from this text. */
export const SavedPhraseSchema = z.object({
  noteId: UuidSchema,
  textSk: z.string().min(1),
  glossEn: z.string(),
  /** Where the phrase sits in the body, when it was found there. */
  span: SpanSchema.nullable(),
});

/** `GET /texts/:id` */
export const TextDetailSchema = TextSummarySchema.extend({
  body: z.string(),
  analysis: TextAnalysisSchema.nullable(),
  /** Set when the status is `failed`. */
  error: z.string().nullable(),
  /** The learner's status of every lemma in the text, keyed by lemma id. */
  lemmaStatus: LemmaStatusMapSchema,
  phrases: z.array(SavedPhraseSchema),
});
export type TextDetail = z.infer<typeof TextDetailSchema>;

/** `POST /texts` body */
export const CreateTextSchema = z.object({
  id: UuidSchema,
  title: z.string().max(200).optional(),
  body: z.string().trim().min(1).max(LIMITS.textImportChars),
});
export type CreateText = z.infer<typeof CreateTextSchema>;

/** `POST /texts` and `POST /library/:id/add` response */
export const TextStatusResultSchema = z.object({ id: UuidSchema, status: TextStatusSchema });

/** `PATCH /texts/:id` body */
export const UpdateTextSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  progress: TextProgressSchema.optional(),
  archived: z.boolean().optional(),
});
export type UpdateText = z.infer<typeof UpdateTextSchema>;

/** `POST /texts/:id/sentences/:n/translation` response */
export const SentenceTranslationSchema = z.object({ n: z.int().nonnegative(), en: z.string() });

export const LibraryItemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  level: LevelSchema,
  tokenCount: CountSchema,
  coverage: ShareSchema.nullable(),
  /** The learner's copy, once added. */
  textId: UuidSchema.optional(),
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

/** `GET /library` */
export const LibraryListSchema = z.object({ items: z.array(LibraryItemSchema) });

/** `POST /library/:id/add` body: the id of the new text. */
export const AddLibraryTextSchema = z.object({ id: UuidSchema });
