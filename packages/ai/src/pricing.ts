// The one price table. Usage rows and the budget take their cost from here.
//
// List prices in US dollars per million tokens, as of 2026-11 (Claude API documentation
// bundled with Claude Code: Claude Opus 5.5 $4 input, $20 output, $0.20 cache read). The cache
// write prices are derived from the documented multipliers (1.25 × input for the 5 minute
// cache, 2 × input for the 1 hour cache) and are marked as such. Check them against
// https://platform.claude.com/docs/en/about-claude/pricing before relying on them.

export interface ModelPrice {
  input: number;
  output: number;
  /** 5 minute cache write. */
  cacheWrite5m: number;
  /** 1 hour cache write. */
  cacheWrite1h: number;
  cacheRead: number;
  /** True where a value is derived from a multiplier rather than read from a price list. */
  derived?: readonly (keyof Omit<ModelPrice, 'derived'>)[];
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': {
    input: 4,
    output: 20,
    cacheWrite5m: 5,
    cacheWrite1h: 8,
    cacheRead: 0.2,
    derived: ['cacheWrite5m', 'cacheWrite1h'],
  },
  'claude-sonnet-5-5': {
    input: 2,
    output: 10,
    cacheWrite5m: 2.5,
    cacheWrite1h: 4,
    cacheRead: 0.1,
    derived: ['cacheWrite5m', 'cacheWrite1h'],
  },
  'claude-opus-5': {
    input: 5,
    output: 25,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10,
    cacheRead: 0.5,
    derived: ['cacheWrite5m', 'cacheWrite1h', 'cacheRead'],
  },
};

/** A model missing from the table is priced at the most expensive row, so the budget holds. */
export const FALLBACK_PRICE: ModelPrice = Object.values(PRICES).reduce((a, b) =>
  b.output > a.output ? b : a,
);

export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? FALLBACK_PRICE;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** All cache writes; `cacheWrite1hTokens` of them were written for one hour. */
  cacheWriteTokens: number;
  cacheWrite1hTokens?: number;
}

/** Cost in US dollars, rounded to the 6 decimals that `app.ai_call.cost_usd` stores. */
export function costOf(model: string, t: TokenCounts): number {
  const p = priceOf(model);
  const write1h = Math.min(t.cacheWrite1hTokens ?? 0, t.cacheWriteTokens);
  const write5m = t.cacheWriteTokens - write1h;
  const micro =
    t.inputTokens * p.input +
    t.outputTokens * p.output +
    t.cacheReadTokens * p.cacheRead +
    write5m * p.cacheWrite5m +
    write1h * p.cacheWrite1h;
  // micro is in dollars per million tokens × tokens = micro dollars.
  return Math.round(micro) / 1e6;
}
