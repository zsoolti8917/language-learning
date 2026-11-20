// A gateway that answers from files, for code of apps/api that the pipeline runs with
// `--fill offline`: the analyzer's `reader.disambiguate` and the dictionary's `reader.gloss`.
// A call with a valid answer file returns that answer. A call without one writes its request
// beside the other requests of the offline fill and fails like an outage, which both callers
// survive: the analyzer guesses, the dictionary leaves the gloss out. The caller reruns after
// the answers are written, until no call is open.
//
// A wrong answer file (not JSON, not the schema, or refused by `check`) stops the run with a
// plain error: a writer mends the file; it never turns into a silent guess.
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type AiGateway,
  AiGatewayError,
  promptFor,
  ROUTE_DEFAULTS,
  type StructuredRequest,
  type Usage,
} from '@app/ai';
import { z } from 'zod';
import { existsSync, sha256, stableJson, writeFileAtomic } from '../lib/files';
import { OFFLINE_MODEL, type OfflineRequest, offlinePath } from '../model/runner';

export interface OfflineCall {
  route: string;
  hash: string;
  /** The job named when the call was made. */
  job: string;
  /** The user message of the call. */
  user: string;
  /** The parsed answer; undefined while the request is open. */
  data?: unknown;
  /** Who answered: the model the gateway reports, or the writer of an offline answer. */
  model?: string;
}

export interface OfflineGatewayOptions {
  /** `<requestsDir>/<route>/<hash>.json` holds each open request. */
  requestsDir: string;
  /** `<answersDir>/<route>/<hash>.json` is where a writer places the answer. */
  answersDir: string;
  /** Recorded as the model of every answer. Default `offline`. */
  answeredBy?: string;
  /** Problems of an answer beyond its schema; any problem stops the run. */
  check?(route: string, user: string, data: unknown): string[];
  /** Count the calls but write no request file (a dry run). */
  dry?: boolean;
}

export interface OfflineGateway extends AiGateway {
  /** Names the calls that follow; the name becomes a job of their requests (`lib-003`). */
  job(name: string): void;
  /** Every call so far, in order. */
  readonly calls: readonly OfflineCall[];
  /** The calls without an answer. */
  open(): OfflineCall[];
  /**
   * Leaves in the request folders of `routes` exactly the requests that are open, as the
   * model runner does, so `offline list` shows what is left to write.
   */
  close(routes: readonly string[]): Promise<void>;
}

/** What identifies a request: the route, the prompt, the message and the answer's shape. */
export function gatewayRequest(req: StructuredRequest<unknown>): Omit<OfflineRequest, 'jobs'> {
  const system = req.system.map((b) => b.text).join('\n\n');
  const user = req.messages.map((m) => m.content).join('\n\n');
  let schema: unknown = {};
  try {
    schema = z.toJSONSchema(req.schema as z.ZodType);
  } catch {
    // A schema with no JSON form still validates the answer; the request then shows none.
  }
  const hash = sha256(stableJson({ route: req.route, system, messages: req.messages, schema }));
  return {
    hash,
    route: req.route,
    promptVersion: promptFor(req.route).version,
    effort: ROUTE_DEFAULTS[req.route].effort,
    system,
    user,
    schema,
  };
}

const NO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  latencyMs: 0,
  requestId: null,
} satisfies Omit<Usage, 'model'>;

export function createOfflineGateway(opts: OfflineGatewayOptions): OfflineGateway {
  const model = opts.answeredBy ?? OFFLINE_MODEL;
  const calls: OfflineCall[] = [];
  const requests = new Map<string, OfflineRequest>();
  let job = 'call';

  return {
    job(name) {
      job = name;
    },
    get calls() {
      return calls;
    },
    open() {
      return calls.filter((c) => c.data === undefined);
    },

    async structured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: Usage }> {
      const request = gatewayRequest(req as StructuredRequest<unknown>);
      const call: OfflineCall = {
        route: request.route,
        hash: request.hash,
        job,
        user: request.user,
      };
      calls.push(call);
      const apath = offlinePath(opts.answersDir, request.route, request.hash);
      if (!existsSync(apath)) {
        const known = requests.get(request.hash);
        if (known) {
          if (!known.jobs.includes(job)) known.jobs.push(job);
        } else requests.set(request.hash, { ...request, jobs: [job] });
        throw new AiGatewayError('upstream_failed', 'No offline answer for this request yet.', {
          route: request.route,
          reason: 'offline_open',
          hash: request.hash,
        });
      }
      let value: unknown;
      try {
        value = JSON.parse(await readFile(apath, 'utf8'));
      } catch (e) {
        throw new Error(`${apath}: not JSON: ${(e as Error).message}`);
      }
      const parsed = req.schema.safeParse(value);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ');
        throw new Error(`${apath}: schema: ${issues}`);
      }
      const problems = opts.check?.(request.route, request.user, parsed.data) ?? [];
      if (problems.length > 0) throw new Error(`${apath}: ${problems.slice(0, 5).join('; ')}`);
      call.data = parsed.data;
      call.model = model;
      return { data: parsed.data, usage: { model, ...NO_USAGE } };
    },

    async stream() {
      throw new Error('the offline gateway answers structured calls only');
    },

    async close(routes) {
      if (opts.dry) return;
      for (const route of new Set([...routes, ...[...requests.values()].map((r) => r.route)])) {
        const dir = join(opts.requestsDir, route);
        const keep = new Set(
          [...requests.values()].filter((r) => r.route === route).map((r) => `${r.hash}.json`),
        );
        if (existsSync(dir))
          for (const f of await readdir(dir)) if (!keep.has(f)) await rm(join(dir, f));
      }
      for (const r of requests.values())
        await writeFileAtomic(offlinePath(opts.requestsDir, r.route, r.hash), stableJson(r));
    },
  };
}
