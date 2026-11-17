// The route table: per live route its model, effort, token limit and timeout
// (docs/architecture.md, "AI integration"). The model comes from `GatewayConfig.models`
// (`AI_MODEL_<ROUTE>`); effort, token limit and timeout can be overridden from the
// environment with `AI_EFFORT_<ROUTE>`, `AI_MAX_TOKENS_<ROUTE>` and `AI_TIMEOUT_MS_<ROUTE>`.
import { AI_ROUTES, type AiRoute } from '@app/contracts';
import { modelFor } from './types';

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type Effort = (typeof EFFORTS)[number];

export interface RouteSettings {
  model: string;
  /** `output_config.effort`. Claude Opus 5.5 defaults to `medium`, so every route sets it. */
  effort: Effort;
  /** `max_tokens`: covers thinking and the answer. A request's `maxTokens` wins over it. */
  maxTokens: number;
  /** Time limit of one HTTP attempt in milliseconds; the SDK retries short outages twice. */
  timeoutMs: number;
}

export type RouteDefaults = Omit<RouteSettings, 'model'>;

/**
 * The defaults. Thinking is adaptive on Claude Opus 5.5 and cannot be turned off, so the token
 * limits leave room for it on top of the answer.
 */
export const ROUTE_DEFAULTS: Readonly<Record<AiRoute, RouteDefaults>> = {
  'tutor.analyze': { effort: 'medium', maxTokens: 8000, timeoutMs: 60_000 },
  'tutor.reply': { effort: 'low', maxTokens: 4000, timeoutMs: 60_000 },
  'tutor.summary': { effort: 'medium', maxTokens: 8000, timeoutMs: 90_000 },
  // The analyzer sends no maxTokens of its own: 8000 covers 150 picks plus thinking.
  'reader.disambiguate': { effort: 'low', maxTokens: 8000, timeoutMs: 60_000 },
  'reader.gloss': { effort: 'low', maxTokens: 8000, timeoutMs: 60_000 },
  'reader.translate': { effort: 'low', maxTokens: 2000, timeoutMs: 30_000 },
};

export type RouteOverrides = Partial<Record<AiRoute, Partial<RouteDefaults>>>;

/** `tutor.reply` → `TUTOR_REPLY` */
function envKey(route: AiRoute): string {
  return route.replace('.', '_').toUpperCase();
}

function positiveInt(name: string, raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer.`);
  return n;
}

/**
 * Reads `AI_EFFORT_<ROUTE>`, `AI_MAX_TOKENS_<ROUTE>` and `AI_TIMEOUT_MS_<ROUTE>`. Empty values
 * are ignored; an invalid value throws, so a typo stops the start up instead of being ignored.
 */
export function routeOverridesFromEnv(env: Record<string, string | undefined>): RouteOverrides {
  const out: RouteOverrides = {};
  for (const route of AI_ROUTES) {
    const key = envKey(route);
    const o: Partial<RouteDefaults> = {};
    const effort = env[`AI_EFFORT_${key}`]?.trim();
    if (effort) {
      if (!(EFFORTS as readonly string[]).includes(effort))
        throw new Error(`AI_EFFORT_${key} must be one of ${EFFORTS.join(', ')}.`);
      o.effort = effort as Effort;
    }
    const max = env[`AI_MAX_TOKENS_${key}`]?.trim();
    if (max) o.maxTokens = positiveInt(`AI_MAX_TOKENS_${key}`, max);
    const timeout = env[`AI_TIMEOUT_MS_${key}`]?.trim();
    if (timeout) o.timeoutMs = positiveInt(`AI_TIMEOUT_MS_${key}`, timeout);
    if (Object.keys(o).length > 0) out[route] = o;
  }
  return out;
}

/** The settings of one route: defaults, then the overrides, then the model of the config. */
export function routeSettings(
  route: AiRoute,
  models?: Partial<Record<AiRoute, string>>,
  overrides?: RouteOverrides,
): RouteSettings {
  const d = ROUTE_DEFAULTS[route];
  const o = overrides?.[route] ?? {};
  return {
    model: modelFor(route, models),
    effort: o.effort ?? d.effort,
    maxTokens: o.maxTokens ?? d.maxTokens,
    timeoutMs: o.timeoutMs ?? d.timeoutMs,
  };
}
