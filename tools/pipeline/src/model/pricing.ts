// List prices per million tokens and the cost estimate the batch runner prints before it
// sends anything (docs/architecture.md, "Cost"). Batches are billed at half the list price.
// Prices change: check https://platform.claude.com/docs/en/about-claude/pricing before a run.

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens (thinking included). */
  output: number;
}

/** List prices as of 2026-11 (Claude API, first party). */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
};

/** The Message Batches API bills every token at half the list price. */
export const BATCH_DISCOUNT = 0.5;

/** The spend the runner allows without an explicit `maxSpendUsd` (`--max-spend`). */
export const DEFAULT_MAX_SPEND_USD = 5;

export function priceOf(model: string): ModelPrice {
  const p = MODEL_PRICES[model];
  if (!p) throw new Error(`no price known for model "${model}"; add it to model/pricing.ts`);
  return p;
}

/**
 * A rough token count for text: about three bytes of UTF-8 per token. Slovak with its
 * accents and JSON with its punctuation use more tokens per character than English prose,
 * so this errs on the high side for English and is close for Slovak.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

/** Tokens the API adds for structured outputs and message framing, per request. */
export const REQUEST_OVERHEAD_TOKENS = 400;

export interface CostEstimate {
  model: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated USD at batch prices. */
  usd: number;
  /** USD if every request used its whole `max_tokens` (an upper bound). */
  worstUsd: number;
}

export function batchCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = priceOf(model);
  return ((inputTokens * p.input + outputTokens * p.output) / 1e6) * BATCH_DISCOUNT;
}

export function formatUsd(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}
