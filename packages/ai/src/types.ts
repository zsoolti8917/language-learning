// The gateway's types (docs/contracts.md, "Internal ports"). Package F5 wrote them, B8 builds
// the real gateway on them, and `apps/api/src/ports.ts` exports them again. Keep them stable:
// the API and every route owner build on these names.
import type { AiCallStatus, AiRoute } from '@app/contracts';
import type { ZodType } from 'zod';

/** The default model of every route. */
export const DEFAULT_MODEL = 'claude-opus-5-5';

/**
 * One block of a system prompt. Blocks are sent in order; `cache: true` marks the end of the
 * stable part, which the real gateway caches. Blocks up to the cache mark hold no dates, names
 * or other values that change per request.
 */
export interface PromptBlock {
  text: string;
  cache?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Token counts and cost of one model call. */
export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  /** The provider's request id, when there is one. */
  requestId: string | null;
}

export interface StructuredRequest<T> {
  route: AiRoute;
  /** The learner the call is made for: the budget and the usage row are theirs. */
  userId: string;
  system: PromptBlock[];
  messages: ChatMessage[];
  /** The answer must match this schema; the result is the parsed value. */
  schema: ZodType<T>;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface StreamRequest {
  route: AiRoute;
  userId: string;
  system: PromptBlock[];
  messages: ChatMessage[];
  maxTokens?: number;
  /** Called with each piece of text as it arrives. */
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

/** The one door to the model. No other code calls the Claude API. */
export interface AiGateway {
  structured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: Usage }>;
  stream(req: StreamRequest): Promise<{ text: string; usage: Usage }>;
}

/** What the gateway writes after each model call; the platform stores it in `app.ai_call`. */
export interface UsageRow {
  userId: string;
  route: AiRoute;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  latencyMs: number;
  status: AiCallStatus;
  requestId: string | null;
}

/** A learner's model spend in the current learner day. */
export interface DailySpend {
  spentUsd: number;
  /** ISO 8601 UTC: when the learner's next day starts and the spend starts again at 0. */
  resetsAt: string;
}

/** The two usage functions; `apps/api/src/platform/usage.ts` implements them on `app.ai_call`. */
export interface UsageFunctions {
  /** The learner's spend of the current learner day (their time zone and day start hour). */
  spendToday(userId: string): Promise<DailySpend>;
  /** Writes one usage row. */
  recordUsage(row: UsageRow): Promise<void>;
}

export interface GatewayConfig extends UsageFunctions {
  /** `anthropic` for the real gateway (B8), `mock` for scripted answers. */
  mode: 'anthropic' | 'mock';
  /** Needed only in `anthropic` mode. Never logged. */
  apiKey?: string;
  /** The daily budget per learner in US dollars (`AI_DAILY_BUDGET_USD`, default 1.00). */
  dailyBudgetUsd: number;
  /** Model per route; routes not listed use DEFAULT_MODEL (`AI_MODEL_<ROUTE>`). */
  models?: Partial<Record<AiRoute, string>>;
}

/**
 * The typed failures of a gateway call.
 * - `budget_exceeded`: the daily budget is used up; `details.resetsAt` says when it returns.
 * - `upstream_failed`: the model failed, or its output does not match the schema.
 * - `refused`: the model refused to answer.
 * - `truncated`: the answer was cut off at the token limit.
 */
export type AiErrorCode = 'budget_exceeded' | 'upstream_failed' | 'refused' | 'truncated';

export class AiGatewayError extends Error {
  override readonly name = 'AiGatewayError';
  readonly code: AiErrorCode;
  readonly details: Record<string, unknown>;
  constructor(code: AiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function isAiGatewayError(e: unknown): e is AiGatewayError {
  return e instanceof AiGatewayError;
}

/** The status of the usage row of a failed call. */
export function usageStatusOf(code: AiErrorCode): AiCallStatus {
  if (code === 'refused') return 'refused';
  if (code === 'truncated') return 'truncated';
  return 'error';
}

/** The model of a route under a config. */
export function modelFor(route: AiRoute, models?: Partial<Record<AiRoute, string>>): string {
  return models?.[route] ?? DEFAULT_MODEL;
}
