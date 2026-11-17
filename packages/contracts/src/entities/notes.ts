// Notes: what the learner keeps, and the deck endpoints (docs/contracts.md, "Notes").
import { z } from 'zod';
import {
  FeaturesSchema,
  FormTagSchema,
  LemmaIdSchema,
  page,
  SpanSchema,
  TimestampSchema,
  UuidSchema,
} from '../common';
import { CardStateSchema, NoteKindSchema, NoteSourceSchema } from '../enums';
import { CardSchema, ReviewLogEntrySchema } from './review';

export const WordVariantSchema = z.object({
  sentenceId: z.string().optional(),
  sentenceSk: z.string().min(1),
  sentenceEn: z.string(),
  blank: SpanSchema,
  answer: z.string().min(1),
  tag: FormTagSchema,
});
export type WordVariant = z.infer<typeof WordVariantSchema>;

export const WordContentSchema = z.object({
  kind: z.literal('word'),
  lemmaId: LemmaIdSchema,
  lemma: z.string().min(1),
  glossEn: z.string(),
  variants: z.array(WordVariantSchema).min(1),
});
export type WordContent = z.infer<typeof WordContentSchema>;

export const PhraseContextSchema = z.object({
  sentenceSk: z.string().min(1),
  sentenceEn: z.string(),
  blank: SpanSchema,
});

export const PhraseContentSchema = z.object({
  kind: z.literal('phrase'),
  textSk: z.string().min(1),
  glossEn: z.string(),
  context: PhraseContextSchema,
});
export type PhraseContent = z.infer<typeof PhraseContentSchema>;

export const CaseSentenceContentSchema = z.object({
  kind: z.literal('case_sentence'),
  exerciseId: z.string().optional(),
  sentenceSk: z.string().min(1),
  sentenceEn: z.string(),
  blank: SpanSchema,
  cue: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1),
  features: FeaturesSchema,
  lemmaId: LemmaIdSchema.optional(),
  triggerId: z.string().optional(),
});
export type CaseSentenceContent = z.infer<typeof CaseSentenceContentSchema>;

/** `app.note.content` */
export const NoteContentSchema = z.discriminatedUnion('kind', [
  WordContentSchema,
  PhraseContentSchema,
  CaseSentenceContentSchema,
]);
export type NoteContent = z.infer<typeof NoteContentSchema>;

export const NoteSchema = z.object({
  id: UuidSchema,
  kind: NoteKindSchema,
  lemmaId: LemmaIdSchema.nullable(),
  exerciseId: z.string().nullable(),
  textId: UuidSchema.nullable(),
  content: NoteContentSchema,
  source: NoteSourceSchema,
  sourceRef: z.unknown(),
  suspended: z.boolean(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Note = z.infer<typeof NoteSchema>;

/** One row of the deck list. */
export const NoteSummarySchema = z.object({
  id: UuidSchema,
  kind: NoteKindSchema,
  /** What the deck shows: the lemma, the phrase or the cue. */
  label: z.string(),
  glossEn: z.string().nullable(),
  lemmaId: LemmaIdSchema.nullable(),
  source: NoteSourceSchema,
  suspended: z.boolean(),
  state: CardStateSchema,
  dueAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});
export type NoteSummary = z.infer<typeof NoteSummarySchema>;

export const NoteListSchema = page(NoteSummarySchema);

/** The note, its card and its last reviews. */
export const NoteDetailSchema = z.object({
  note: NoteSchema,
  card: CardSchema.nullable(),
  reviews: z.array(ReviewLogEntrySchema),
});
export type NoteDetail = z.infer<typeof NoteDetailSchema>;

// --- POST /notes ------------------------------------------------------------

/** Where a word was captured; the server adds sentences that cover the lemma's top forms. */
export const CaptureContextSchema = z.object({
  sentenceSk: z.string().min(1),
  sentenceEn: z.string().optional(),
  blank: SpanSchema,
  tag: FormTagSchema.optional(),
});

export const CreateWordNoteSchema = z.object({
  id: UuidSchema,
  kind: z.literal('word'),
  source: NoteSourceSchema,
  lemmaId: LemmaIdSchema,
  textId: UuidSchema.optional(),
  context: CaptureContextSchema.optional(),
});

export const CreatePhraseNoteSchema = z.object({
  id: UuidSchema,
  kind: z.literal('phrase'),
  source: NoteSourceSchema,
  textId: UuidSchema.optional(),
  content: PhraseContentSchema,
});

export const CreateCaseSentenceNoteSchema = z.object({
  id: UuidSchema,
  kind: z.literal('case_sentence'),
  source: NoteSourceSchema,
  content: CaseSentenceContentSchema,
});

/** `POST /notes` body: a word with its reader context, a phrase, or a manual case sentence. */
export const CreateNoteSchema = z.discriminatedUnion('kind', [
  CreateWordNoteSchema,
  CreatePhraseNoteSchema,
  CreateCaseSentenceNoteSchema,
]);
export type CreateNote = z.infer<typeof CreateNoteSchema>;

/** `PATCH /notes/:id` body */
export const UpdateNoteSchema = z.object({
  suspended: z.boolean().optional(),
  content: NoteContentSchema.optional(),
});
export type UpdateNote = z.infer<typeof UpdateNoteSchema>;
