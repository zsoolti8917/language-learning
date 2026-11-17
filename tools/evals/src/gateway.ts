// The eval gateway: wraps a gateway with a cache of model answers on disk, so every run can
// be repeated from the answers the model gave, and logs the usage of every call.
//
// Modes:
// - `record`: a cached answer is returned without a call; a miss goes to `inner` and its
//   answer is stored (the live run, and the mock run in tests).
// - `replay`: cached answers only; a miss stops the run (a plain Error, which no fallback in
//   the analyzer or the tutor swallows).
// - `estimate` (dry run): cached answers count as free; for a miss the request is priced from
//   its size and the route's expected output, `inner` (a mock) answers so the pipeline can go
//   on, and nothing is stored. No request leaves the machine.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AiGateway,
  AiGatewayError,
  costOf,
  isAiGatewayError,
  modelFor,
  type PromptBlock,
  ROUTE_DEFAULTS,
  type StreamRequest,
  type StructuredRequest,
  type Usage,
} from '@app/ai';
import type { AiRoute } from '@app/contracts';
import { type ZodType, z } from 'zod';

export type GatewayMode = 'record' | 'replay' | 'estimate';

/** One call of a run, as the report counts it. */
export interface CallRecord {
  route: AiRoute;
  model: string;
  /** Answered from the cache: no model call in this run. */
  cached: boolean;
  /** Priced from the request size, not measured (dry run). */
  estimated: boolean;
  status: 'ok' | 'refused' | 'truncated' | 'error';
  usage: Usage;
  /** Cost if every call used its whole `max_tokens` and no cache (dry run only). */
  worstUsd?: number;
}

type CachedAnswer =
  | { data: unknown }
  | { text: string }
  | { error: 'refused' | 'truncated' | 'upstream_failed'; message: string; reason?: string };

interface CacheEntry {
  key: string;
  route: AiRoute;
  model: string;
  kind: 'structured' | 'stream';
  answer: CachedAnswer;
  usage: Usage;
}

export interface EvalGatewayOptions {
  mode: GatewayMode;
  /** The gateway behind the cache: the real one (live), or a mock. */
  inner: AiGateway;
  /** Folder of cached answers: one JSON Lines file per route. */
  cacheDir: string;
  /** Model per route, as the inner gateway uses them. */
  models?: Partial<Record<AiRoute, string>>;
}

export interface EvalGateway extends AiGateway {
  readonly log: readonly CallRecord[];
}

/**
 * The minimum prefix the model caches. The prompts in use are below it (about 600 to 1,700
 * tokens), so the estimate counts no cache reads for them. Assumption for Opus-class models:
 * check it against the prompt caching documentation when the key exists.
 */
export const CACHE_MIN_TOKENS = 4096;

/** Tokens of a text, estimated as the batch runner does: UTF-8 bytes / 3. */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

/**
 * Expected output tokens per call (thinking included), the basis of the dry run's estimate.
 * Assumptions until the first live run measures them: analysis at medium effort thinks before
 * it answers; a reply is short; disambiguation names one index per word.
 */
export const EXPECTED_OUTPUT: Record<AiRoute, (req: { messages: string }) => number> = {
  'tutor.analyze': () => 900,
  'tutor.reply': () => 250,
  'tutor.summary': () => 600,
  'reader.disambiguate': (r) => 150 + 20 * ((r.messages.match(/"w":/g) ?? []).length || 1),
  'reader.gloss': () => 300,
  'reader.translate': () => 120,
};

/** The schema as JSON, part of the cache key: a changed schema is a changed request. */
function schemaJson(schema: ZodType | undefined): unknown {
  if (!schema) return null;
  try {
    return z.toJSONSchema(schema);
  } catch {
    return String(schema);
  }
}

export function requestKey(
  kind: 'structured' | 'stream',
  route: AiRoute,
  model: string,
  req: {
    system: readonly PromptBlock[];
    messages: readonly { role: string; content: string }[];
    maxTokens?: number | undefined;
  },
  schema?: ZodType,
): string {
  const body = JSON.stringify({
    kind,
    route,
    model,
    maxTokens: req.maxTokens ?? null,
    system: req.system.map((b) => ({ text: b.text, cache: b.cache === true })),
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    schema: schemaJson(schema),
  });
  return createHash('sha256').update(body).digest('hex');
}

/**
 * The answers of one route: `<cacheDir>/<route>.jsonl`, one request per line, appended as
 * answers arrive (an interrupted live run keeps what it paid for). One file per route keeps
 * the cache easy to commit and to read.
 */
class AnswerStore {
  private readonly loaded = new Map<AiRoute, Map<string, CacheEntry>>();
  constructor(private readonly dir: string) {}

  private fileOf(route: AiRoute): string {
    return join(this.dir, `${route}.jsonl`);
  }

  private entries(route: AiRoute): Map<string, CacheEntry> {
    let m = this.loaded.get(route);
    if (m) return m;
    m = new Map();
    const file = this.fileOf(route);
    if (existsSync(file))
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (line.trim() === '') continue;
        const e = JSON.parse(line) as CacheEntry;
        m.set(e.key, e);
      }
    this.loaded.set(route, m);
    return m;
  }

  get(route: AiRoute, key: string): CacheEntry | undefined {
    return this.entries(route).get(key);
  }

  put(e: CacheEntry): void {
    const m = this.entries(e.route);
    if (m.has(e.key)) return;
    m.set(e.key, e);
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.fileOf(e.route), `${JSON.stringify(e)}\n`);
  }
}

/** Model errors are kept (the same request gets the same answer); outages are not. */
function cacheableError(e: AiGatewayError): boolean {
  if (e.code === 'refused' || e.code === 'truncated') return true;
  return e.code === 'upstream_failed' && e.details.reason === 'invalid_output';
}

function errorOf(a: Extract<CachedAnswer, { error: unknown }>, route: AiRoute): AiGatewayError {
  return new AiGatewayError(a.error, a.message, {
    route,
    ...(a.reason ? { reason: a.reason } : {}),
  });
}

function statusOf(code: string): CallRecord['status'] {
  return code === 'refused' ? 'refused' : code === 'truncated' ? 'truncated' : 'error';
}

const ZERO_USAGE = (model: string): Usage => ({
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  requestId: null,
});

export function createEvalGateway(opts: EvalGatewayOptions): EvalGateway {
  const log: CallRecord[] = [];
  const store = new AnswerStore(opts.cacheDir);
  /** Cache prefixes seen in this dry run: the first call writes, later ones read. */
  const prefixes = new Set<string>();

  function estimateUsage(
    route: AiRoute,
    model: string,
    req: { system: readonly PromptBlock[]; messages: readonly { content: string }[] },
    maxTokens: number | undefined,
    schema?: ZodType,
  ): { usage: Usage; worstUsd: number } {
    let mark = -1;
    req.system.forEach((b, i) => {
      if (b.cache) mark = i;
    });
    const prefixText = req.system
      .slice(0, mark + 1)
      .map((b) => b.text)
      .join('\n');
    const restText = [
      ...req.system.slice(mark + 1).map((b) => b.text),
      ...req.messages.map((m) => m.content),
      schema ? JSON.stringify(schemaJson(schema)) : '',
    ].join('\n');
    const prefix = estimateTokens(prefixText);
    const rest = estimateTokens(restText) + 20 * req.messages.length + 50;
    const messages = req.messages.map((m) => m.content).join('\n');
    const limit = maxTokens ?? ROUTE_DEFAULTS[route].maxTokens;
    const output = Math.min(limit, EXPECTED_OUTPUT[route]({ messages }));
    let cacheRead = 0;
    let cacheWrite = 0;
    let input = prefix + rest;
    if (prefix >= CACHE_MIN_TOKENS) {
      const k = `${route}|${model}|${prefixText}`;
      if (prefixes.has(k)) cacheRead = prefix;
      else {
        cacheWrite = prefix;
        prefixes.add(k);
      }
      input = rest;
    }
    const counts = {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
    };
    return {
      usage: { ...ZERO_USAGE(model), ...counts, costUsd: costOf(model, counts) },
      worstUsd: costOf(model, {
        inputTokens: prefix + rest,
        outputTokens: limit,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    };
  }

  async function call<R>(
    kind: 'structured' | 'stream',
    req: StructuredRequest<unknown> | StreamRequest,
    schema: ZodType | undefined,
    fromCache: (a: Exclude<CachedAnswer, { error: unknown }>, usage: Usage) => R,
    run: () => Promise<{
      result: R;
      answer: Exclude<CachedAnswer, { error: unknown }>;
      usage: Usage;
    }>,
  ): Promise<R> {
    const model = modelFor(req.route, opts.models);
    const key = requestKey(kind, req.route, model, req, schema);
    const hit = store.get(req.route, key);
    if (hit) {
      const base = { route: req.route, model, cached: true, estimated: false };
      if ('error' in hit.answer) {
        log.push({ ...base, status: statusOf(hit.answer.error), usage: hit.usage });
        throw errorOf(hit.answer, req.route);
      }
      log.push({ ...base, status: 'ok', usage: hit.usage });
      return fromCache(hit.answer, hit.usage);
    }
    if (opts.mode === 'replay')
      throw new Error(
        `No cached answer for a ${req.route} request (${key.slice(0, 12)}) in ${opts.cacheDir}. Run the same command in live mode, or check that the prompts and datasets did not change.`,
      );
    if (opts.mode === 'estimate') {
      const { usage, worstUsd } = estimateUsage(req.route, model, req, req.maxTokens, schema);
      try {
        const { result } = await run();
        log.push({
          route: req.route,
          model,
          cached: false,
          estimated: true,
          status: 'ok',
          usage,
          worstUsd,
        });
        return result;
      } catch (e) {
        log.push({
          route: req.route,
          model,
          cached: false,
          estimated: true,
          status: isAiGatewayError(e) ? statusOf(e.code) : 'error',
          usage,
          worstUsd,
        });
        throw e;
      }
    }
    try {
      const { result, answer, usage } = await run();
      store.put({ key, route: req.route, model, kind, answer, usage });
      log.push({ route: req.route, model, cached: false, estimated: false, status: 'ok', usage });
      return result;
    } catch (e) {
      if (isAiGatewayError(e) && cacheableError(e)) {
        const usage = ZERO_USAGE(model);
        const reason = typeof e.details.reason === 'string' ? e.details.reason : undefined;
        store.put({
          key,
          route: req.route,
          model,
          kind,
          answer: {
            error: e.code as 'refused' | 'truncated' | 'upstream_failed',
            message: e.message,
            ...(reason ? { reason } : {}),
          },
          usage,
        });
        log.push({
          route: req.route,
          model,
          cached: false,
          estimated: false,
          status: statusOf(e.code),
          usage,
        });
      }
      throw e;
    }
  }

  return {
    get log() {
      return log;
    },
    structured<T>(req: StructuredRequest<T>) {
      return call(
        'structured',
        req as StructuredRequest<unknown>,
        req.schema,
        (a, usage) => {
          if (!('data' in a)) throw new Error('cached answer of a structured call has no data');
          const parsed = req.schema.safeParse(a.data);
          if (!parsed.success)
            throw new AiGatewayError(
              'upstream_failed',
              'The cached answer does not match the schema.',
              { route: req.route, reason: 'invalid_output' },
            );
          return { data: parsed.data, usage };
        },
        async () => {
          const res = await opts.inner.structured(req);
          return { result: res, answer: { data: res.data }, usage: res.usage };
        },
      );
    },
    stream(req: StreamRequest) {
      return call(
        'stream',
        req,
        undefined,
        (a, usage) => {
          if (!('text' in a)) throw new Error('cached answer of a stream has no text');
          req.onText(a.text);
          return { text: a.text, usage };
        },
        async () => {
          const res = await opts.inner.stream(req);
          return { result: res, answer: { text: res.text }, usage: res.usage };
        },
      );
    },
  };
}
