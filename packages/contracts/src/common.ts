// Small building blocks used by many schemas.
import { z } from 'zod';
import {
  CaseSchema,
  ErrorCodeSchema,
  GenderSchema,
  GrammaticalNumberSchema,
  LemmaStatusSchema,
} from './enums';

/** UUID made on the client (version 7 for learner rows). */
export const UuidSchema = z.uuid();

/** ISO 8601 timestamp in UTC, for example `2026-11-17T08:30:00.000Z`. */
export const TimestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

/** Calendar date of the learner's day, `YYYY-MM-DD`. */
export const DateSchema = z.iso.date();

/** Lemma id from `content/registry/lemma-ids.tsv`. */
export const LemmaIdSchema = z.int().positive();

/** A count. */
export const CountSchema = z.int().nonnegative();

/** A share from 0 to 1. */
export const ShareSchema = z.number().min(0).max(1);

/** Character offsets, end exclusive. */
export const SpanSchema = z
  .object({ start: z.int().nonnegative(), end: z.int().nonnegative() })
  .refine((s) => s.end >= s.start, { message: 'end must not be before start' });
export type Span = z.infer<typeof SpanSchema>;

/**
 * A form tag (docs/contracts.md, "Form tags"): `s2`, `p4f`, `x3`, `v:Kesc+`, or empty.
 * Only `ling` parses tags; this checks the shape.
 */
export const FormTagSchema = z
  .string()
  .regex(/^(?:|[sp][1-7][mifn]?|x[1-7]|v:\S*)$/u, 'not a form tag');

/** Several form tags separated by spaces, as stored in `ling.form.tags`. Empty for no tag. */
export const FormTagsSchema = z
  .string()
  .regex(/^(?:(?:[sp][1-7][mifn]?|x[1-7]|v:\S+)(?: (?:[sp][1-7][mifn]?|x[1-7]|v:\S+))*)?$/u, {
    message: 'not a list of form tags',
  });

/** Every form of a target word mapped to its form tags, for diagnosis. */
export const FormMapSchema = z.record(z.string(), z.array(FormTagSchema));
export type FormMap = z.infer<typeof FormMapSchema>;

/** The decoded grammar of a form, as JSON payloads carry it. */
export const FeaturesSchema = z.object({
  case: CaseSchema,
  number: GrammaticalNumberSchema,
  gender: GenderSchema.optional(),
});
export type Features = z.infer<typeof FeaturesSchema>;

/** One reading of a form: the raw tag and its decoded values. Verbs keep only the tag. */
export const FormReadingSchema = z.object({
  tag: FormTagSchema,
  case: CaseSchema.optional(),
  number: GrammaticalNumberSchema.optional(),
  gender: GenderSchema.optional(),
});
export type FormReading = z.infer<typeof FormReadingSchema>;

/** One of a lemma's most used forms (`ling.lemma.top_forms`). */
export const TopFormSchema = z.object({
  form: z.string().min(1),
  tag: FormTagSchema,
  share: ShareSchema,
});
export type TopForm = z.infer<typeof TopFormSchema>;

export const LemmaStatusMapSchema = z.record(z.string(), LemmaStatusSchema);

// --- Paging -----------------------------------------------------------------

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** `cursor` and `limit` of every list endpoint. Query values arrive as strings. */
export const PageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});

/** `nextCursor` is null at the end of the list. */
export const NextCursorSchema = z.string().min(1).nullable();

/** Wraps an item schema into `{ items, nextCursor }`. */
export function page<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), nextCursor: NextCursorSchema });
}

// --- Errors -----------------------------------------------------------------

export const ErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/** `{ "error": { "code", "message", "details" } }`, the body of every error response. */
export const ErrorResponseSchema = z.object({ error: ErrorBodySchema });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// --- Limits (docs/contracts.md, "API conventions") ----------------------------

export const LIMITS = {
  requestBodyBytes: 256 * 1024,
  textImportChars: 20_000,
  tutorMessageChars: 1_000,
  tutorMessagesPerMinute: 20,
  textImportsPerHour: 10,
  batchItems: 200,
} as const;
