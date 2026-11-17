// The batch runner (docs/work-packages.md, C2): builds one Messages request per job from a
// task (prompt + zod schema), sends the requests it has not seen through the Message
// Batches API, polls, validates every answer and caches the valid ones on disk by request
// hash, so a rerun sends nothing twice.
//
// Safety switches:
// - `dry-run` builds the requests and prints their count and estimated cost; nothing is sent.
// - `mock` answers from a scripted client (tests, local runs); nothing reaches the network.
// - `live` refuses to send requests estimated above `maxSpendUsd` (default $5).
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { z } from 'zod';
import { existsSync, sha256, stableJson, writeFileAtomic } from '../lib/files';
import {
  anthropicBatchClient,
  type BatchClient,
  type BatchRequest,
  type Message,
  MockBatchClient,
} from './client';
import {
  batchCost,
  type CostEstimate,
  DEFAULT_MAX_SPEND_USD,
  estimateTokens,
  formatUsd,
  REQUEST_OVERHEAD_TOKENS,
} from './pricing';

export const DEFAULT_MODEL = 'claude-opus-5-5';

/** One kind of model call: a versioned prompt, an output schema and limits. */
export interface BatchTask<I, O> {
  /** The route name, such as `content.glosses`. Also the cache folder. */
  route: string;
  promptVersion: number;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens: number;
  /** The stable system prompt. It is marked for caching. */
  system: string;
  /** The answer's shape. Sent as the JSON schema of the output and checked on return. */
  schema: z.ZodType<O>;
  /** The user message for one job. */
  user(input: I): string;
  /** Checks beyond the schema, such as "every requested word is answered". Empty is fine. */
  check?(input: I, output: O): string[];
  /** Expected output tokens of one job (thinking included), for the cost estimate. */
  estimateOutputTokens(input: I): number;
  /** The answer mock mode gives when no client is passed. */
  mock?(input: I): O;
}

export interface BatchJob<I> {
  /** The caller's id for this job, unique within one run. */
  id: string;
  input: I;
}

export type RunMode = 'dry-run' | 'mock' | 'live';
export const RUN_MODES: readonly RunMode[] = ['dry-run', 'mock', 'live'];

export interface RunOptions {
  mode: RunMode;
  /** Root folder of the answer cache; each route has a folder below it. */
  cacheDir: string;
  /** The Batches API client. Defaults: the SDK in live mode, `task.mock` in mock mode. */
  client?: BatchClient;
  /** Refuse to send when the estimate is above this. Default $5. */
  maxSpendUsd?: number;
  log?: (message: string) => void;
  pollIntervalMs?: number;
  /** Requests per batch (the API takes up to 100,000 or 256 MB). Default 5,000. */
  maxPerBatch?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface JobResult<I, O> {
  id: string;
  input: I;
  output: O;
  hash: string;
  cached: boolean;
}

export interface JobFailure {
  id: string;
  hash: string;
  reason: string;
}

export interface BatchOutcome<I, O> {
  mode: RunMode;
  route: string;
  results: JobResult<I, O>[];
  failures: JobFailure[];
  /** Distinct requests (identical jobs share one). */
  requests: number;
  cached: number;
  /** Requests sent in this run. */
  sent: number;
  /** Estimate for the requests not cached (what this run sends or would send). */
  estimate: CostEstimate;
  /** Cost from the usage the API reported, at batch prices. */
  actualUsd: number;
  batchIds: string[];
}

export class SpendLimitError extends Error {
  constructor(
    readonly estimate: CostEstimate,
    readonly limit: number,
  ) {
    super(
      `refusing to send ${estimate.requests} requests: the estimate ${formatUsd(estimate.usd)} is above the limit ${formatUsd(limit)}. Rerun with a higher --max-spend after checking the dry run.`,
    );
  }
}

/** The request for one input, exactly as it is sent and hashed. */
export function buildRequest<I, O>(
  task: BatchTask<I, O>,
  input: I,
): MessageCreateParamsNonStreaming {
  const { type, schema } = zodOutputFormat(task.schema as z.ZodType);
  return {
    model: task.model ?? DEFAULT_MODEL,
    max_tokens: task.maxTokens,
    system: [{ type: 'text', text: task.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: task.user(input) }],
    output_config: { effort: task.effort ?? 'low', format: { type, schema } },
  };
}

/** The cache key: sha256 of the request's stable JSON. Any change to prompt, schema or model changes it. */
export function requestHash(params: MessageCreateParamsNonStreaming): string {
  return sha256(stableJson(params));
}

interface CacheEntry {
  hash: string;
  route: string;
  promptVersion: number;
  model: string;
  output: unknown;
  usage?: Message['usage'];
  at: string;
  /** Written in mock mode: never reused by a dry run or a live run. */
  mock?: boolean;
}

interface PendingBatch {
  batchId: string;
  hashes: string[];
  at: string;
}

const routeDir = (cacheDir: string, route: string) => join(cacheDir, route);
const entryPath = (cacheDir: string, route: string, hash: string) =>
  join(routeDir(cacheDir, route), hash.slice(0, 2), `${hash}.json`);
const pendingDir = (cacheDir: string, route: string) => join(routeDir(cacheDir, route), 'pending');

async function readEntry(path: string): Promise<CacheEntry | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CacheEntry;
  } catch {
    return null;
  }
}

/** Parses and checks an answer. Returns the output or the reasons it was rejected. */
export function validateAnswer<I, O>(
  task: BatchTask<I, O>,
  input: I,
  value: unknown,
): { ok: true; output: O } | { ok: false; reason: string } {
  const parsed = task.schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return { ok: false, reason: `schema: ${issues}` };
  }
  const problems = task.check?.(input, parsed.data) ?? [];
  if (problems.length > 0)
    return { ok: false, reason: `check: ${problems.slice(0, 5).join('; ')}` };
  return { ok: true, output: parsed.data };
}

function textOf(message: Message): string {
  return message.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function costOfUsage(model: string, usage: Message['usage'] | undefined): number {
  if (!usage) return 0;
  const input =
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * 0.1;
  return batchCost(model, input, usage.output_tokens);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs a task over jobs. Cached answers are reused; the rest are estimated, then sent
 * (live, mock) or only counted (dry-run). Invalid answers are reported in `failures` and not
 * cached, so the next run asks again.
 */
export async function runBatch<I, O>(
  task: BatchTask<I, O>,
  jobs: readonly BatchJob<I>[],
  opts: RunOptions,
): Promise<BatchOutcome<I, O>> {
  const log = opts.log ?? (() => undefined);
  const model = task.model ?? DEFAULT_MODEL;
  const ids = new Set<string>();
  for (const j of jobs) {
    if (ids.has(j.id)) throw new Error(`${task.route}: job id "${j.id}" is used twice`);
    ids.add(j.id);
  }

  // Build every request; identical requests are sent once.
  const byHash = new Map<
    string,
    { params: MessageCreateParamsNonStreaming; jobs: BatchJob<I>[] }
  >();
  for (const job of jobs) {
    const params = buildRequest(task, job.input);
    const hash = requestHash(params);
    const slot = byHash.get(hash);
    if (slot) slot.jobs.push(job);
    else byHash.set(hash, { params, jobs: [job] });
  }

  const results: JobResult<I, O>[] = [];
  const failures: JobFailure[] = [];
  const accept = (hash: string, value: unknown, cached: boolean): string | null => {
    const slot = byHash.get(hash);
    if (!slot) return 'unknown request';
    const outs: JobResult<I, O>[] = [];
    for (const job of slot.jobs) {
      const v = validateAnswer(task, job.input, value);
      if (!v.ok) return v.reason;
      outs.push({ id: job.id, input: job.input, output: v.output, hash, cached });
    }
    results.push(...outs);
    return null;
  };
  const fail = (hash: string, reason: string) => {
    for (const job of byHash.get(hash)?.jobs ?? []) failures.push({ id: job.id, hash, reason });
  };

  // Answers already on disk.
  const todo: string[] = [];
  let cached = 0;
  for (const hash of byHash.keys()) {
    const entry = await readEntry(entryPath(opts.cacheDir, task.route, hash));
    const usable = entry && (opts.mode === 'mock' || !entry.mock);
    if (usable && accept(hash, entry.output, true) === null) cached++;
    else todo.push(hash);
  }

  // The estimate for what is left.
  let inputTokens = 0;
  let outputTokens = 0;
  let worstOutput = 0;
  for (const hash of todo) {
    const slot = byHash.get(hash);
    if (!slot) continue;
    const first = slot.jobs[0] as BatchJob<I>;
    const schemaText = JSON.stringify(slot.params.output_config?.format?.schema ?? {});
    inputTokens +=
      estimateTokens(task.system) +
      estimateTokens(task.user(first.input)) +
      estimateTokens(schemaText) +
      REQUEST_OVERHEAD_TOKENS;
    outputTokens += task.estimateOutputTokens(first.input);
    worstOutput += task.maxTokens;
  }
  const estimate: CostEstimate = {
    model,
    requests: todo.length,
    inputTokens,
    outputTokens,
    usd: batchCost(model, inputTokens, outputTokens),
    worstUsd: batchCost(model, inputTokens, worstOutput),
  };
  log(
    `${task.route}: ${byHash.size} requests for ${jobs.length} jobs, ${cached} cached, ${todo.length} to send; ` +
      `estimate ${estimate.inputTokens.toLocaleString('en')} input and ${estimate.outputTokens.toLocaleString('en')} output tokens, ` +
      `${formatUsd(estimate.usd)} at batch prices (at most ${formatUsd(estimate.worstUsd)}) on ${model}`,
  );

  const outcome: BatchOutcome<I, O> = {
    mode: opts.mode,
    route: task.route,
    results,
    failures,
    requests: byHash.size,
    cached,
    sent: 0,
    estimate,
    actualUsd: 0,
    batchIds: [],
  };
  if (opts.mode === 'dry-run' || todo.length === 0) {
    if (opts.mode === 'dry-run') log(`${task.route}: dry run, nothing sent`);
    return outcome;
  }

  const limit = opts.maxSpendUsd ?? DEFAULT_MAX_SPEND_USD;
  if (opts.mode === 'live' && estimate.usd > limit) throw new SpendLimitError(estimate, limit);

  let client = opts.client;
  if (!client && opts.mode === 'mock') {
    const mock = task.mock;
    if (!mock) throw new Error(`${task.route}: mock mode needs a client or task.mock`);
    client = new MockBatchClient((_params, customId) => {
      const job = byHash.get(customId)?.jobs[0];
      if (!job) return { error: `unknown request ${customId}` };
      return { json: mock(job.input) };
    });
  }
  if (!client) client = anthropicBatchClient();

  const sleep = opts.sleep ?? defaultSleep;
  const poll = opts.pollIntervalMs ?? (opts.mode === 'live' ? 60_000 : 0);
  const left = new Set(todo);

  const collect = async (batchId: string) => {
    for (;;) {
      const b = await client.retrieve(batchId);
      if (b.processing_status === 'ended') break;
      const c = b.request_counts;
      log(`${task.route}: batch ${batchId} ${b.processing_status}, ${c.processing} processing`);
      await sleep(poll);
    }
    for await (const r of client.results(batchId)) {
      const hash = r.custom_id;
      if (!left.has(hash)) continue;
      left.delete(hash);
      const res = r.result;
      if (res.type !== 'succeeded') {
        fail(hash, res.type === 'errored' ? `errored: ${res.error.error.message}` : res.type);
        continue;
      }
      const msg = res.message;
      outcome.actualUsd += costOfUsage(model, msg.usage);
      if (msg.stop_reason === 'refusal') {
        fail(hash, 'refused');
        continue;
      }
      if (msg.stop_reason === 'max_tokens') {
        fail(hash, 'cut off at max_tokens');
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(textOf(msg));
      } catch {
        fail(hash, 'answer is not JSON');
        continue;
      }
      const problem = accept(hash, value, false);
      if (problem) {
        fail(hash, problem);
        continue;
      }
      const entry: CacheEntry = {
        hash,
        route: task.route,
        promptVersion: task.promptVersion,
        model: msg.model,
        output: value,
        usage: msg.usage,
        at: new Date().toISOString(),
        ...(opts.mode === 'mock' ? { mock: true } : {}),
      };
      await writeFileAtomic(entryPath(opts.cacheDir, task.route, hash), stableJson(entry));
    }
  };

  // A batch left from an interrupted run is collected first instead of being sent again.
  const pdir = pendingDir(opts.cacheDir, task.route);
  if (existsSync(pdir)) {
    for (const f of (await readdir(pdir)).sort()) {
      const p = JSON.parse(await readFile(join(pdir, f), 'utf8')) as PendingBatch;
      if (!p.hashes.some((h) => left.has(h))) continue;
      log(`${task.route}: collecting batch ${p.batchId} from an earlier run`);
      await collect(p.batchId);
      outcome.batchIds.push(p.batchId);
      await rm(join(pdir, f), { force: true });
    }
  }

  const size = opts.maxPerBatch ?? 5000;
  const queue = todo.filter((h) => left.has(h));
  for (let i = 0; i < queue.length; i += size) {
    const chunk = queue.slice(i, i + size);
    const requests: BatchRequest[] = chunk.map((hash) => ({
      custom_id: hash.slice(0, 64),
      params: (byHash.get(hash) as { params: MessageCreateParamsNonStreaming }).params,
    }));
    const batch = await client.create(requests);
    outcome.sent += requests.length;
    outcome.batchIds.push(batch.id);
    const pfile = join(pdir, `${batch.id}.json`);
    const pending: PendingBatch = {
      batchId: batch.id,
      hashes: chunk,
      at: new Date().toISOString(),
    };
    await writeFileAtomic(pfile, stableJson(pending));
    log(`${task.route}: sent batch ${batch.id} with ${requests.length} requests`);
    await collect(batch.id);
    await rm(pfile, { force: true });
  }
  for (const hash of left) fail(hash, 'no result returned');

  log(
    `${task.route}: ${results.length} answers (${cached} cached), ${failures.length} failed, ` +
      `${outcome.sent} sent, ${formatUsd(outcome.actualUsd)} reported by the API`,
  );
  for (const f of failures.slice(0, 20)) log(`${task.route}: rejected ${f.id}: ${f.reason}`);
  return outcome;
}
