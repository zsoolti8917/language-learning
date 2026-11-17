// System, profile, today and stats.
import { z } from 'zod';
import { CountSchema, DateSchema, ShareSchema, TimestampSchema, UuidSchema } from '../common';
import { LessonStatusSchema, LevelSchema, ScenarioModeSchema } from '../enums';
import { BucketMasterySchema } from './declension';
import { TextProgressSchema } from './reader';
import { QueueCountsSchema } from './review';

/** `GET /health` */
export const HealthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  /** Null until content is loaded. */
  contentVersion: z.string().nullable(),
});
export type Health = z.infer<typeof HealthSchema>;

/** The columns of `app.profile` a learner may change. */
export const ProfileSettingsSchema = z.object({
  displayName: z.string().max(100).nullable(),
  uiLang: z.string().min(2).max(10),
  explainLang: z.string().min(2).max(10),
  level: LevelSchema,
  /** IANA time zone, for example 'Europe/Bratislava'. */
  timezone: z.string().min(1),
  /** The learner's day starts at this hour; daily caps count from there. */
  dayStartHour: z.int().min(0).max(23),
  dailyNewLimit: z.int().min(0).max(1000),
  dailyReviewLimit: z.int().min(0).max(10000),
  desiredRetention: z.number().min(0.7).max(0.99),
  strictDiacritics: z.boolean(),
  wordsBandTarget: z.int().positive(),
  settings: z.record(z.string(), z.unknown()),
});

/** `GET /me`, `PATCH /me` */
export const ProfileSchema = ProfileSettingsSchema.extend({
  userId: UuidSchema,
  placementDoneAt: TimestampSchema.nullable(),
  currentLessonId: z.string().nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

/** `PATCH /me` body: any of the settings columns. */
export const UpdateProfileSchema = ProfileSettingsSchema.partial();
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

/** `GET /me/export`: all learner rows as one JSON file, keyed by table name (camelCase rows). */
export const ExportSchema = z.object({
  version: z.literal(1),
  exportedAt: TimestampSchema,
  profile: ProfileSchema,
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});
export type Export = z.infer<typeof ExportSchema>;

/** `GET /today` */
export const TodaySchema = z.object({
  /** The learner's day, which starts at `dayStartHour` in the profile's time zone. */
  date: DateSchema,
  review: QueueCountsSchema,
  continueText: z
    .object({
      id: UuidSchema,
      title: z.string(),
      coverage: ShareSchema.nullable(),
      progress: TextProgressSchema,
    })
    .nullable(),
  nextLesson: z
    .object({
      id: z.string().min(1),
      titleEn: z.string(),
      titleSk: z.string(),
      status: LessonStatusSchema,
    })
    .nullable(),
  weakBuckets: z.array(BucketMasterySchema),
  tutorSuggestion: z
    .object({
      scenarioId: z.string().min(1),
      mode: ScenarioModeSchema,
      titleEn: z.string(),
      titleSk: z.string(),
    })
    .nullable(),
  words: z.object({
    band: z.int().nonnegative(),
    fromRank: z.int().positive(),
    toRank: z.int().positive(),
    total: CountSchema,
    known: CountSchema,
    learning: CountSchema,
    /** `app.profile.words_band_target` */
    target: z.int().positive(),
  }),
});
export type Today = z.infer<typeof TodaySchema>;

/** `GET /stats/summary` */
export const StatsSummarySchema = z.object({
  /** Seven days, oldest first. */
  reviewsPerDay: z
    .array(z.object({ date: DateSchema, reviews: CountSchema, correct: CountSchema }))
    .length(7),
  /** Share of reviews of mature cards answered correctly over 30 days; null without data. */
  retention30d: ShareSchema.nullable(),
  words: z.object({ known: CountSchema, learning: CountSchema }),
  mastery: z.array(BucketMasterySchema),
});
export type StatsSummary = z.infer<typeof StatsSummarySchema>;
