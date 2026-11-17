// Lemmas, the common words track and placement.
import { z } from 'zod';
import {
  CountSchema,
  FormReadingSchema,
  FormTagSchema,
  LemmaIdSchema,
  page,
  SpanSchema,
  TopFormSchema,
  UuidSchema,
} from '../common';
import {
  AspectSchema,
  CaseSchema,
  GenderSchema,
  LemmaStatusSchema,
  PosSchema,
  RunStatusSchema,
  SenseSourceSchema,
  TriageDecisionSchema,
} from '../enums';

export const LemmaFlagsSchema = z.object({
  proper: z.boolean().optional(),
  irregular: z.boolean().optional(),
  pluralOnly: z.boolean().optional(),
  indeclinable: z.boolean().optional(),
  /** Set instead of deleting a lemma that a card may point at. */
  retired: z.boolean().optional(),
  /** Prepositions only: the cases the preposition governs, from the morphology data. */
  cases: z.array(CaseSchema).optional(),
});
export type LemmaFlags = z.infer<typeof LemmaFlagsSchema>;

/** A row of `ling.lemma`, as the API returns it. */
export const LemmaSchema = z.object({
  id: LemmaIdSchema,
  /** 'mesto|noun|n|1' */
  key: z.string().min(1),
  lemma: z.string().min(1),
  pos: PosSchema,
  gender: GenderSchema.nullable(),
  pattern: z.string().nullable(),
  aspect: AspectSchema.nullable(),
  freqRank: z.int().positive().nullable(),
  topForms: z.array(TopFormSchema),
  flags: LemmaFlagsSchema,
});
export type Lemma = z.infer<typeof LemmaSchema>;

/** A row of `ling.sense`. */
export const SenseSchema = z.object({
  ord: z.int().nonnegative(),
  glossEn: z.string().min(1),
  note: z.string().nullable(),
  source: SenseSourceSchema,
  verified: z.boolean(),
});
export type Sense = z.infer<typeof SenseSchema>;

/** One form of a lemma with all its readings. */
export const FormEntrySchema = z.object({
  form: z.string().min(1),
  readings: z.array(FormReadingSchema),
});
export type FormEntry = z.infer<typeof FormEntrySchema>;

/** Every form of a lemma with its tags. */
export const ParadigmSchema = z.object({
  lemmaId: LemmaIdSchema,
  forms: z.array(FormEntrySchema),
});
export type Paradigm = z.infer<typeof ParadigmSchema>;

/** A lemma a written form can belong to, as `MorphologyPort.lookupForms` returns it. */
export const FormCandidateSchema = z.object({
  lemmaId: LemmaIdSchema,
  lemma: z.string().min(1),
  pos: PosSchema,
  form: z.string().min(1),
  readings: z.array(FormReadingSchema),
  freqRank: z.int().positive().nullable(),
});
export type FormCandidate = z.infer<typeof FormCandidateSchema>;

export const LemmaSentenceSchema = z.object({
  id: z.string().min(1),
  textSk: z.string().min(1),
  textEn: z.string(),
  form: z.string().min(1),
  tag: FormTagSchema,
  /** Where the lemma's form sits in `textSk`. */
  span: SpanSchema,
});
export type LemmaSentence = z.infer<typeof LemmaSentenceSchema>;

/** `GET /lemmas/:id` */
export const LemmaDetailSchema = z.object({
  lemma: LemmaSchema,
  senses: z.array(SenseSchema),
  forms: z.array(FormEntrySchema),
  sentences: z.array(LemmaSentenceSchema),
  status: LemmaStatusSchema,
  noteId: UuidSchema.nullable(),
});
export type LemmaDetail = z.infer<typeof LemmaDetailSchema>;

/** `PUT /lemmas/:id/status` body */
export const SetLemmaStatusSchema = z.object({ status: LemmaStatusSchema });
export const LemmaStatusResultSchema = z.object({
  lemmaId: LemmaIdSchema,
  status: LemmaStatusSchema,
});

// --- Words track --------------------------------------------------------------

export const WordBandSchema = z.object({
  band: z.int().nonnegative(),
  fromRank: z.int().positive(),
  toRank: z.int().positive(),
  total: CountSchema,
  known: CountSchema,
  learning: CountSchema,
  unknown: CountSchema,
});
export type WordBand = z.infer<typeof WordBandSchema>;

/** `GET /words/bands` */
export const WordBandsSchema = z.object({ bands: z.array(WordBandSchema) });

export const WordListItemSchema = z.object({
  lemmaId: LemmaIdSchema,
  lemma: z.string().min(1),
  pos: PosSchema,
  rank: z.int().positive(),
  glossEn: z.string().nullable(),
  status: LemmaStatusSchema,
  topForms: z.array(TopFormSchema),
});
export type WordListItem = z.infer<typeof WordListItemSchema>;

/** `GET /words` */
export const WordListSchema = page(WordListItemSchema);

/** `POST /words/triage` body */
export const TriageSchema = z.object({
  decisions: z
    .array(z.object({ lemmaId: LemmaIdSchema, decision: TriageDecisionSchema }))
    .min(1)
    .max(200),
});
export type Triage = z.infer<typeof TriageSchema>;

export const TriageResultSchema = z.object({ updated: CountSchema, notesCreated: CountSchema });

// --- Placement ----------------------------------------------------------------

export const VocabPlacementItemSchema = z.object({
  itemId: z.string().min(1),
  kind: z.literal('vocab'),
  lemmaId: LemmaIdSchema,
  lemma: z.string().min(1),
  /** English meanings; the last is "I don't know". */
  options: z.array(z.string().min(1)).min(2),
});

export const CasePlacementItemSchema = z.object({
  itemId: z.string().min(1),
  kind: z.literal('case'),
  /** The sentence with the gap written as `___`, which `blank` points at; it holds no answer. */
  sentenceSk: z.string().min(1),
  sentenceEn: z.string(),
  blank: SpanSchema,
  cue: z.string().min(1),
});

/** Placement items carry no answers; the server grades every round. */
export const PlacementItemSchema = z.discriminatedUnion('kind', [
  VocabPlacementItemSchema,
  CasePlacementItemSchema,
]);
export type PlacementItem = z.infer<typeof PlacementItemSchema>;

export const PlacementRoundSchema = z.object({
  round: z.int().positive(),
  items: z.array(PlacementItemSchema).min(1),
});
export type PlacementRound = z.infer<typeof PlacementRoundSchema>;

export const PlacementResultSchema = z.object({
  /** 0, 500, 1000 ... 3000 */
  knownUpToRank: z.int().nonnegative().max(3000).multipleOf(500),
  lessonsTestedOut: z.array(z.string()),
  startLessonId: z.string().min(1),
  buckets: z.array(
    z.object({ lessonId: z.string().min(1), correct: CountSchema, total: CountSchema }),
  ),
});
export type PlacementResult = z.infer<typeof PlacementResultSchema>;

export const PlacementRunSchema = z.object({
  id: UuidSchema,
  status: RunStatusSchema,
  round: PlacementRoundSchema.optional(),
  result: PlacementResultSchema.optional(),
});
export type PlacementRun = z.infer<typeof PlacementRunSchema>;

/** `POST /placement` body */
export const StartPlacementSchema = z.object({ id: UuidSchema });

/** `POST /placement/:id/answers` body. `choice` is the index of the option picked. */
export const PlacementAnswersSchema = z.object({
  round: z.int().positive(),
  answers: z
    .array(
      z.object({
        itemId: z.string().min(1),
        choice: z.int().nonnegative().optional(),
        typed: z.string().optional(),
      }),
    )
    .min(1),
});
export type PlacementAnswers = z.infer<typeof PlacementAnswersSchema>;

/** The next round, or the result after the last one. */
export const PlacementAnswersResultSchema = z.object({
  status: RunStatusSchema,
  round: PlacementRoundSchema.optional(),
  result: PlacementResultSchema.optional(),
});
export type PlacementAnswersResult = z.infer<typeof PlacementAnswersResultSchema>;
