// The config loader with the start up guards (docs/contracts.md, "Environment and run modes").
import { AI_ROUTES, type AiRoute } from '@app/contracts';
import { z } from 'zod';

/** The app version that `GET /health` reports. Raise it with each release. */
export const API_VERSION = '0.1.0';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export interface Config {
  appEnv: 'local' | 'preview' | 'production';
  dbMode: 'postgres' | 'pglite';
  /** Postgres connection string (dbMode postgres). Never logged. */
  databaseUrl: string | null;
  /** PGlite data folder (dbMode pglite); null keeps the database in memory. */
  pgliteDir: string | null;
  authMode: 'supabase' | 'dev';
  supabaseUrl: string | null;
  supabaseSecretKey: string | null;
  aiMode: 'anthropic' | 'mock';
  anthropicApiKey: string | null;
  /** `AI_MODEL_<ROUTE>` overrides, e.g. `AI_MODEL_TUTOR_REPLY`. */
  aiModels: Partial<Record<AiRoute, string>>;
  aiDailyBudgetUsd: number;
  /** Validate every response against its contract schema (local mode and tests). */
  validateResponses: boolean;
  /** HTTP port of the plain Node server. */
  port: number;
  version: string;
}

const empty = (v: unknown) => (v === '' ? undefined : v);
const opt = z.preprocess(empty, z.string().optional());

const EnvSchema = z.object({
  APP_ENV: z.preprocess(empty, z.enum(['local', 'preview', 'production']).default('local')),
  DB_MODE: z.preprocess(empty, z.enum(['postgres', 'pglite']).default('postgres')),
  DATABASE_URL: opt,
  PGLITE_DIR: opt,
  AUTH_MODE: z.preprocess(empty, z.enum(['supabase', 'dev']).default('supabase')),
  SUPABASE_URL: z.preprocess(empty, z.url().optional()),
  SUPABASE_SECRET_KEY: opt,
  AI_MODE: z.preprocess(empty, z.enum(['anthropic', 'mock']).default('anthropic')),
  ANTHROPIC_API_KEY: opt,
  AI_DAILY_BUDGET_USD: z.preprocess(empty, z.coerce.number().nonnegative().default(1)),
  VALIDATE_RESPONSES: z.preprocess(empty, z.stringbool().optional()),
  PORT: z.preprocess(empty, z.coerce.number().int().min(0).max(65535).default(8787)),
});

/** `tutor.reply` → `AI_MODEL_TUTOR_REPLY` */
export function modelVariable(route: AiRoute): string {
  return `AI_MODEL_${route.replace('.', '_').toUpperCase()}`;
}

/**
 * Reads the server variables. The defaults are the production ones (Postgres, Supabase,
 * Anthropic); local mode sets the stand ins explicitly. Throws ConfigError when a value is
 * missing or when a stand in is asked for in production.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`Invalid server variables: ${names}`);
  }
  const e = parsed.data;
  if (e.APP_ENV === 'production') {
    if (e.AUTH_MODE === 'dev')
      throw new ConfigError('Refusing to start: AUTH_MODE=dev (the dev login) in production.');
    if (e.AI_MODE === 'mock')
      throw new ConfigError('Refusing to start: AI_MODE=mock in production.');
  }
  if (e.DB_MODE === 'postgres' && !e.DATABASE_URL)
    throw new ConfigError('DATABASE_URL is required when DB_MODE=postgres.');
  if (e.AUTH_MODE === 'supabase' && !e.SUPABASE_URL)
    throw new ConfigError('SUPABASE_URL is required when AUTH_MODE=supabase.');
  if (e.AI_MODE === 'anthropic' && !e.ANTHROPIC_API_KEY)
    throw new ConfigError('ANTHROPIC_API_KEY is required when AI_MODE=anthropic.');

  const aiModels: Partial<Record<AiRoute, string>> = {};
  for (const route of AI_ROUTES) {
    const v = env[modelVariable(route)];
    if (v) aiModels[route] = v;
  }
  return {
    appEnv: e.APP_ENV,
    dbMode: e.DB_MODE,
    databaseUrl: e.DATABASE_URL ?? null,
    pgliteDir: e.PGLITE_DIR ?? null,
    authMode: e.AUTH_MODE,
    supabaseUrl: e.SUPABASE_URL ? e.SUPABASE_URL.replace(/\/+$/, '') : null,
    supabaseSecretKey: e.SUPABASE_SECRET_KEY ?? null,
    aiMode: e.AI_MODE,
    anthropicApiKey: e.ANTHROPIC_API_KEY ?? null,
    aiModels,
    aiDailyBudgetUsd: e.AI_DAILY_BUDGET_USD,
    validateResponses: e.VALIDATE_RESPONSES ?? e.APP_ENV === 'local',
    port: e.PORT,
    version: API_VERSION,
  };
}

/** The variables of local mode (`pnpm dev`); explicit values in `env` win. */
export const LOCAL_DEFAULTS = {
  APP_ENV: 'local',
  DB_MODE: 'pglite',
  AUTH_MODE: 'dev',
  AI_MODE: 'mock',
} as const;
